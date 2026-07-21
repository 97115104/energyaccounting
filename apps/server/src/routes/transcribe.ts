import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Elysia } from "elysia";
import { eq, and } from "drizzle-orm";
import { dataDir } from "../db/index.ts";
import { db } from "../db/index.ts";
import { dayTable } from "../db/schema.ts";
import { assertIsoDate, requireFullUser } from "../lib/session.ts";

async function toWavIfNeeded(inputPath: string): Promise<string> {
  if (inputPath.endsWith(".wav")) return inputPath;
  const out = inputPath.replace(/\.[^.]+$/, "") + ".wav";
  const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
  const proc = Bun.spawn(
    [ffmpeg, "-y", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", out],
    { stdout: "pipe", stderr: "pipe" },
  );
  const code = await Promise.race([
    proc.exited,
    new Promise<number>((resolve) => setTimeout(() => resolve(124), 60_000)),
  ]);
  if (code === 124) {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    throw new Error("Audio conversion timed out.");
  }
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(
      err.trim() ||
        "Could not convert audio to WAV. Install ffmpeg, or type the journal entry instead.",
    );
  }
  return out;
}

async function runWhisper(wavPath: string): Promise<{ text: string } | { error: string }> {
  const bin = process.env.WHISPER_BIN ?? "whisper-cli";
  const model = process.env.WHISPER_MODEL ?? join(dataDir, "models", "ggml-tiny.bin");
  const proc = Bun.spawn([bin, "-m", model, "-f", wavPath, "-nt", "-np"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const timed = Promise.race([
    proc.exited,
    new Promise<number>((resolve) => setTimeout(() => resolve(124), 120_000)),
  ]);
  const code = await timed;
  if (code === 124) {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
    return { error: "Whisper timed out. Try a shorter recording or type instead." };
  }
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  if (code !== 0) {
    return {
      error:
        err.trim() ||
        `Whisper exited with code ${code}. Install whisper.cpp and ffmpeg, set WHISPER_BIN / WHISPER_MODEL, or type the journal entry.`,
    };
  }
  const text = out.trim();
  if (!text) {
    return { error: "Whisper returned empty transcript. Try speaking again or type instead." };
  }
  return { text };
}

async function rmQuiet(path: string) {
  try {
    await Bun.$`rm -f ${path}`.quiet();
  } catch {
    /* best-effort */
  }
}

export const transcribeRoutes = new Elysia({ prefix: "/api" }).post(
  "/transcribe",
  async ({ request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) {
      set.status = 400;
      return { error: "Missing audio file field." };
    }
    if (file.size > 25 * 1024 * 1024) {
      set.status = 400;
      return { error: "Audio too large (25MB max)." };
    }

    const tmpDir = join(dataDir, "tmp");
    mkdirSync(tmpDir, { recursive: true });
    const id = crypto.randomUUID();
    const tmpPath = join(tmpDir, `upload-${id}.webm`);
    let wavPath = tmpPath;
    await Bun.write(tmpPath, file);

    try {
      try {
        wavPath = await toWavIfNeeded(tmpPath);
      } catch (e) {
        set.status = 503;
        return { error: e instanceof Error ? e.message : "Audio conversion failed." };
      }
      const result = await runWhisper(wavPath);
      if ("error" in result) {
        set.status = 503;
        return result;
      }
      return { text: result.text };
    } finally {
      await rmQuiet(tmpPath);
      if (wavPath !== tmpPath) await rmQuiet(wavPath);
    }
  },
);

export const audioRoutes = new Elysia({ prefix: "/api" }).post(
  "/days/:date/audio",
  async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    let date: string;
    try {
      date = assertIsoDate(params.date);
    } catch {
      set.status = 400;
      return { error: "Invalid date." };
    }

    const day = await db.query.dayTable.findFirst({
      where: and(eq(dayTable.userId, user.id), eq(dayTable.date, date)),
    });
    if (!day) {
      set.status = 404;
      return { error: "Day not found." };
    }
    if (day.phase === "closed") {
      set.status = 400;
      return { error: "Day is closed." };
    }

    const form = await request.formData();
    const file = form.get("ciphertext");
    const iv = form.get("iv");
    if (!(file instanceof File) || typeof iv !== "string") {
      set.status = 400;
      return { error: "ciphertext file and iv required." };
    }
    const audioDir = join(dataDir, "audio");
    mkdirSync(audioDir, { recursive: true });
    const name = `${date}-${crypto.randomUUID()}.bin`;
    const path = join(audioDir, name);
    await Bun.write(path, file);
    return { audioPath: name, audioIv: iv };
  },
);
