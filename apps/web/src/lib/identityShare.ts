/**
 * Share payloads and local file exports for the NeuroMe identity.
 *
 * A share payload is the frozen plaintext a person deliberately publishes:
 * their identity config, optional display name, and only the You sections they
 * ticked. The same shape feeds the public share page, so what the person
 * previews is exactly what a visitor sees.
 */

import type { AcceptedTrait } from "./butterflyTraits";
import { normalizeIdentity, type IdentityConfig } from "./identity";
import type { ColorMeaning, ShareSections, YouProfile } from "./youProfile";
import { selectShareContent } from "./youProfile";

export type SharePayload = {
  version: 1;
  name: string | null;
  identity: IdentityConfig;
  about?: string;
  communication?: string;
  support?: string;
  traits?: AcceptedTrait[];
  colorMeanings?: ColorMeaning[];
};

export function buildSharePayload(
  identity: IdentityConfig,
  name: string | null,
  profile: YouProfile,
  sections: ShareSections,
): SharePayload {
  return {
    version: 1,
    name: name?.trim() || null,
    identity,
    ...selectShareContent(profile, sections),
  };
}

/** Parse an untrusted payload from the public endpoint into a safe shape. */
export function parseSharePayload(input: unknown): SharePayload | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const identity = normalizeIdentity(raw.identity, "shared");
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const traits = Array.isArray(raw.traits)
    ? raw.traits.flatMap((t): AcceptedTrait[] => {
        if (!t || typeof t !== "object") return [];
        const r = t as Record<string, unknown>;
        if (typeof r.label !== "string") return [];
        const kind =
          r.kind === "interest" ||
          r.kind === "energy-giver" ||
          r.kind === "energy-taker" ||
          r.kind === "rhythm"
            ? r.kind
            : "interest";
        return [
          {
            id: typeof r.id === "string" ? r.id : `shared:${r.label}`,
            kind,
            label: r.label,
            ...(typeof r.colorMeaning === "string" ? { colorMeaning: r.colorMeaning } : {}),
          },
        ];
      })
    : undefined;
  const colorMeanings = Array.isArray(raw.colorMeanings)
    ? raw.colorMeanings.flatMap((m): ColorMeaning[] => {
        if (!m || typeof m !== "object") return [];
        const r = m as Record<string, unknown>;
        if (
          (r.slot === "primary" || r.slot === "secondary" || r.slot === "accent") &&
          typeof r.meaning === "string"
        ) {
          return [{ slot: r.slot, meaning: r.meaning }];
        }
        return [];
      })
    : undefined;
  return {
    version: 1,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : null,
    identity,
    ...(str(raw.about) ? { about: str(raw.about) } : {}),
    ...(str(raw.communication) ? { communication: str(raw.communication) } : {}),
    ...(str(raw.support) ? { support: str(raw.support) } : {}),
    ...(traits && traits.length ? { traits } : {}),
    ...(colorMeanings && colorMeanings.length ? { colorMeanings } : {}),
  };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Serialize a live SVG element (the rendered butterfly) to a standalone file. */
export function svgElementToString(el: SVGSVGElement): string {
  const clone = el.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(clone);
}

export function downloadSvg(el: SVGSVGElement, filename: string): void {
  downloadBlob(
    new Blob([svgElementToString(el)], { type: "image/svg+xml" }),
    filename,
  );
}

/** Rasterize the butterfly at high resolution for avatars and social posts. */
export async function downloadPng(
  el: SVGSVGElement,
  filename: string,
  pixels = 1024,
): Promise<void> {
  const svgString = svgElementToString(el);
  const svgUrl = URL.createObjectURL(new Blob([svgString], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not render the SVG."));
      img.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = pixels;
    canvas.height = pixels;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");
    ctx.drawImage(img, 0, 0, pixels, pixels);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("PNG encoding failed.");
    downloadBlob(blob, filename);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
