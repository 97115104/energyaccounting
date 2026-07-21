import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Elysia } from "elysia";
import { eq, and } from "drizzle-orm";
import { dataDir } from "../db/index.ts";
import { db } from "../db/index.ts";
import { dayTable } from "../db/schema.ts";
import { assertIsoDate, requireFullUser } from "../lib/session.ts";

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
