/**
 * Home Screen / apple-touch icons. iOS Add to Home Screen fetches a real URL
 * (blob: and data: are ignored), so we rasterize the person's mark server-side.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

// Client identity/favicon builders are pure TS (no React). Reuse them so the
// Home Screen icon matches the tab favicon exactly.
import { normalizeIdentity } from "../../../web/src/lib/identity.ts";
import { identityFaviconSvg } from "../../../web/src/lib/identityFaviconSvg.ts";

const DAY_BG = "#fff6c8";

function brandTouchIconPath(): string | null {
  const candidates = [
    join(import.meta.dir, "../../../web/dist/apple-touch-icon.png"),
    join(import.meta.dir, "../../../web/public/apple-touch-icon.png"),
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

/** PNG bytes for the Home Screen icon, or null to fall back to the static brand file. */
export function renderIdentityTouchIcon(
  identityRaw: unknown,
  seed: string,
): Uint8Array {
  const identity = normalizeIdentity(identityRaw, seed);
  const svg = identityFaviconSvg(identity, DAY_BG, 180);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 180 },
  });
  return resvg.render().asPng();
}

export async function brandTouchIconBytes(): Promise<Uint8Array | null> {
  const path = brandTouchIconPath();
  if (!path) return null;
  return new Uint8Array(await Bun.file(path).arrayBuffer());
}
