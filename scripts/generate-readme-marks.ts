/**
 * README gift: animated NeuroMe marks cycling wing families and symbols.
 *
 * Renders identity tiles with Resvg, then assembles an animated GIF via
 * ImageMagick (`convert`). Output: apps/web/public/readme-marks.gif
 *
 * Usage: bun scripts/generate-readme-marks.ts
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Resvg } from "../apps/server/node_modules/@resvg/resvg-js";
import {
  ARCHETYPES,
  normalizeIdentity,
  type IdentityConfig,
  type IdentitySymbol,
} from "../apps/web/src/lib/identity";
import { identityFaviconSvg } from "../apps/web/src/lib/identityFaviconSvg";

const root = join(import.meta.dir, "..");
const outGif = join(root, "apps/web/public/readme-marks.gif");
const frameDir = join(root, ".tmp-readme-marks");
const SIZE = 160;

/** Soft sky tiles that echo the app's day/dawn/dusk/night atmosphere. */
const SKIES = ["#fff6c8", "#f5d9a8", "#c9b8e8", "#12182e", "#e8f0ff", "#ffe8d6"];

type FrameSpec = {
  label: string;
  identity: IdentityConfig;
  background: string;
};

function frameFor(
  symbol: IdentitySymbol,
  seed: string,
  background: string,
  archetypeId?: string,
): FrameSpec {
  const raw: Record<string, unknown> = { symbol, seed };
  if (archetypeId) {
    const arch = ARCHETYPES.find((a) => a.id === archetypeId);
    raw.archetype = archetypeId;
    if (arch) raw.palette = { ...arch.palette };
  }
  if (symbol === "rainbow-pride" || symbol === "rainbow-infinity") {
    raw.palette = {
      primary: "#d1273b",
      secondary: "#7a4a9e",
      accent: "#2a1226",
      rainbow: true,
    };
  }
  if (symbol === "gold-infinity") {
    raw.palette = {
      primary: "#f0b429",
      secondary: "#c98a1a",
      accent: "#3a2a08",
    };
  }
  return {
    label: `${symbol}-${archetypeId ?? "mark"}`,
    identity: normalizeIdentity(raw, seed),
    background,
  };
}

function buildFrames(): FrameSpec[] {
  const frames: FrameSpec[] = [];
  let sky = 0;
  // One butterfly per wing family, then the three external pride marks.
  for (const arch of ARCHETYPES) {
    frames.push(
      frameFor("butterfly", `readme-${arch.id}`, SKIES[sky++ % SKIES.length]!, arch.id),
    );
  }
  frames.push(frameFor("rainbow-infinity", "readme-ri", SKIES[sky++ % SKIES.length]!));
  frames.push(frameFor("gold-infinity", "readme-gi", SKIES[sky++ % SKIES.length]!));
  frames.push(frameFor("rainbow-pride", "readme-rp", SKIES[sky++ % SKIES.length]!));
  return frames;
}

await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });

const frames = buildFrames();
const pngPaths: string[] = [];

for (let i = 0; i < frames.length; i++) {
  const frame = frames[i]!;
  const svg = identityFaviconSvg(frame.identity, frame.background, SIZE);
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE },
  })
    .render()
    .asPng();
  const path = join(frameDir, `frame-${String(i).padStart(2, "0")}.png`);
  await Bun.write(path, png);
  pngPaths.push(path);
  console.log(`frame ${i + 1}/${frames.length}: ${frame.label}`);
}

// Prefer ImageMagick v7 `magick`; fall back to legacy `convert`.
const magickBin = (await Bun.which("magick")) ?? (await Bun.which("convert"));
if (!magickBin) {
  throw new Error("ImageMagick is required (magick or convert on PATH)");
}

const convert = Bun.spawn(
  [
    magickBin,
    "-delay",
    "90",
    "-loop",
    "0",
    ...pngPaths,
    "-layers",
    "Optimize",
    outGif,
  ],
  { stdout: "inherit", stderr: "inherit" },
);
const code = await convert.exited;
if (code !== 0) {
  throw new Error(`ImageMagick convert failed with exit ${code}`);
}

await rm(frameDir, { recursive: true, force: true });

const stat = await Bun.file(outGif).size;
console.log(`wrote ${outGif} (${stat} bytes, ${frames.length} frames)`);
