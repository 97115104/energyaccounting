/**
 * Rasterize apps/web/public/icon.svg into the PNG sizes we need for
 * apple-touch-icon, the web manifest, and Open Graph share previews.
 *
 * Usage: bun scripts/generate-icons.ts
 */
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = join(import.meta.dir, "..");
const svgPath = join(root, "apps/web/public/icon.svg");
const outDir = join(root, "apps/web/public");

const svg = await Bun.file(svgPath).text();

const targets: { file: string; size: number }[] = [
  { file: "apple-touch-icon.png", size: 180 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "og-image.png", size: 1024 },
];

for (const { file, size } of targets) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
  });
  const png = resvg.render().asPng();
  const out = join(outDir, file);
  await Bun.write(out, png);
  console.log(`wrote ${file} (${size}×${size})`);
}
