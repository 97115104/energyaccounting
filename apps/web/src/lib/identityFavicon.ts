/**
 * Favicon / home-screen icons from the person's chosen NeuroMe mark.
 *
 * Tab favicons accept SVG data URLs immediately. Apple touch icons need a PNG
 * blob. Installed PWA manifest icons stay the static brand art until the person
 * re-adds the app — iOS does not refresh those at runtime.
 */

import { buildWingRender } from "./butterflyGeometry";
import {
  normalizeIdentity,
  wingVariation,
  type IdentityConfig,
  type IdentitySymbol,
} from "./identity";

const RAINBOW = ["#d1273b", "#e8853a", "#e5c33a", "#2f8f4e", "#3563b0", "#7a4a9e"];
const INFINITY_PATH =
  "M22 50 C22 33, 42 33, 50 50 C58 67, 78 67, 78 50 C78 33, 58 33, 50 50 C42 67, 22 67, 22 50 Z";

let appleBlobUrl: string | null = null;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function butterflyMarkSvg(identity: IdentityConfig): string {
  const variation = wingVariation(identity.seed);
  const geo = buildWingRender(identity.wing, variation);
  const { primary, secondary, accent } = identity.palette;
  const joins = identity.wing.edge === "angular" ? "miter" : "round";
  const gid = "favicon-bf";

  const wingInner = [
    ...geo.tails.map(
      (d) =>
        `<path d="${esc(d)}" fill="url(#${gid}-hind)" stroke="${esc(accent)}" stroke-width="1.6" stroke-linejoin="${joins}"/>`,
    ),
    `<path d="${esc(geo.forewing)}" fill="url(#${gid}-fore)" stroke="${esc(accent)}" stroke-width="2" stroke-linejoin="${joins}"/>`,
    `<path d="${esc(geo.hindwing)}" fill="url(#${gid}-hind)" stroke="${esc(accent)}" stroke-width="2" stroke-linejoin="${joins}"/>`,
    `<g clip-path="url(#${gid}-clip)">`,
    ...geo.clearPanels.map(
      (d) => `<path d="${esc(d)}" fill="#ffffff" opacity="0.4" stroke="none"/>`,
    ),
    ...geo.bands.map(
      (d) =>
        `<path d="${esc(d)}" fill="none" stroke="${esc(secondary)}" stroke-width="${2.5 + variation.band * 3.5}" stroke-linejoin="round" opacity="0.35"/>`,
    ),
    ...geo.veins.map(
      (d) =>
        `<path d="${esc(d)}" fill="none" stroke="${esc(accent)}" stroke-width="1.1" stroke-linecap="round" opacity="0.55"/>`,
    ),
    ...geo.spots.map(
      (s) =>
        `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${esc(accent)}" opacity="0.8"/>`,
    ),
    ...geo.eyespots.flatMap((s) => [
      `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${esc(accent)}" opacity="0.85"/>`,
      `<circle cx="${s.x}" cy="${s.y}" r="${s.r * 0.5}" fill="${esc(primary)}" opacity="0.95"/>`,
      `<circle cx="${s.x}" cy="${s.y}" r="${s.r * 0.2}" fill="#ffffff" opacity="0.9"/>`,
    ]),
    `</g>`,
  ].join("");

  const clipTails = geo.tails
    .map((d) => `<path d="${esc(d)}"/>`)
    .join("");

  return [
    `<defs>`,
    `<linearGradient id="${gid}-fore" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0%" stop-color="${esc(primary)}"/>`,
    `<stop offset="100%" stop-color="${esc(secondary)}"/>`,
    `</linearGradient>`,
    `<linearGradient id="${gid}-hind" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0%" stop-color="${esc(secondary)}"/>`,
    `<stop offset="100%" stop-color="${esc(primary)}"/>`,
    `</linearGradient>`,
    `<clipPath id="${gid}-clip">`,
    `<path d="${esc(geo.forewing)}"/>`,
    `<path d="${esc(geo.hindwing)}"/>`,
    clipTails,
    `</clipPath>`,
    `</defs>`,
    `<g>${wingInner}</g>`,
    `<g transform="scale(-1,1) translate(-200,0)">${wingInner}</g>`,
    `<ellipse cx="100" cy="108" rx="5" ry="26" fill="${esc(accent)}"/>`,
    `<circle cx="100" cy="76" r="7" fill="${esc(accent)}"/>`,
    `<path d="M97 71 C90 58, 84 52, 78 48" fill="none" stroke="${esc(accent)}" stroke-width="2" stroke-linecap="round"/>`,
    `<path d="M103 71 C110 58, 116 52, 122 48" fill="none" stroke="${esc(accent)}" stroke-width="2" stroke-linecap="round"/>`,
    `<circle cx="78" cy="48" r="2.4" fill="${esc(accent)}"/>`,
    `<circle cx="122" cy="48" r="2.4" fill="${esc(accent)}"/>`,
  ].join("");
}

function infinityMarkSvg(gold: boolean): string {
  const stops = gold
    ? [
        `<stop offset="0%" stop-color="#f0b429"/>`,
        `<stop offset="55%" stop-color="#c98a1a"/>`,
        `<stop offset="100%" stop-color="#8a5a10"/>`,
      ]
    : RAINBOW.map(
        (c, i) =>
          `<stop offset="${(i / (RAINBOW.length - 1)) * 100}%" stop-color="${c}"/>`,
      );
  return [
    `<defs>`,
    `<linearGradient id="favicon-inf" x1="0" y1="0" x2="1" y2="0">`,
    ...stops,
    `</linearGradient>`,
    `</defs>`,
    `<path d="${INFINITY_PATH}" fill="none" stroke="url(#favicon-inf)" stroke-width="9" stroke-linecap="round"/>`,
  ].join("");
}

function prideMarkSvg(): string {
  return RAINBOW.map((color, i) => {
    const r = 40 - i * 5;
    return `<path d="M${50 - r} 72 A${r} ${r} 0 0 1 ${50 + r} 72" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
  }).join("");
}

function markInner(identity: IdentityConfig, symbol: IdentitySymbol): {
  viewBox: string;
  body: string;
} {
  if (symbol === "butterfly") {
    return { viewBox: "0 0 200 210", body: butterflyMarkSvg(identity) };
  }
  if (symbol === "rainbow-infinity") {
    return { viewBox: "0 0 100 100", body: infinityMarkSvg(false) };
  }
  if (symbol === "gold-infinity") {
    return { viewBox: "0 0 100 100", body: infinityMarkSvg(true) };
  }
  return { viewBox: "0 0 100 100", body: prideMarkSvg() };
}

/**
 * Square SVG favicon: sky-colored rounded tile with the chosen mark centered.
 * Size is the outer tile; the mark keeps its native aspect inside a padded inset.
 */
export function identityFaviconSvg(
  identity: IdentityConfig,
  background: string,
  size = 64,
): string {
  const bg = background.trim() || "#fff6c8";
  const { viewBox, body } = markInner(identity, identity.symbol);
  const [, , vbW, vbH] = viewBox.split(/\s+/).map(Number) as [number, number, number, number];
  const pad = size * 0.12;
  const inner = size - pad * 2;
  const scale = Math.min(inner / vbW, inner / vbH);
  const drawW = vbW * scale;
  const drawH = vbH * scale;
  const tx = (size - drawW) / 2;
  const ty = (size - drawH) / 2;
  const radius = Math.round(size * 0.22);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${esc(bg)}"/>`,
    `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">`,
    body,
    `</g>`,
    `</svg>`,
  ].join("");
}

export function identityFaviconDataUrl(identity: IdentityConfig, background: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    identityFaviconSvg(identity, background),
  )}`;
}

async function svgToPngBlob(svg: string, pixels: number): Promise<Blob> {
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not render favicon SVG."));
      img.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = pixels;
    canvas.height = pixels;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.drawImage(img, 0, 0, pixels, pixels);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("PNG encoding failed.");
    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/** Point the document favicon (and apple-touch-icon when possible) at this mark. */
export function applyIdentityIcons(identity: IdentityConfig, background: string): void {
  const favicon = document.getElementById("favicon") as HTMLLinkElement | null;
  if (favicon) {
    favicon.type = "image/svg+xml";
    favicon.href = identityFaviconDataUrl(identity, background);
  }

  const apple = document.querySelector(
    'link[rel="apple-touch-icon"]',
  ) as HTMLLinkElement | null;
  if (!apple) return;

  const svg = identityFaviconSvg(identity, background, 180);
  void svgToPngBlob(svg, 180)
    .then((blob) => {
      if (appleBlobUrl) URL.revokeObjectURL(appleBlobUrl);
      appleBlobUrl = URL.createObjectURL(blob);
      apple.href = appleBlobUrl;
    })
    .catch(() => {
      // Keep the static brand touch icon if rasterization fails.
    });
}

/** Restore the static day/night brand favicons when no personal mark is available. */
export function applyBrandFavicon(theme: "day" | "night"): void {
  const favicon = document.getElementById("favicon") as HTMLLinkElement | null;
  if (favicon) {
    favicon.type = "image/svg+xml";
    favicon.href = theme === "night" ? "/favicon-moon.svg" : "/favicon-sun.svg";
  }
  const apple = document.querySelector(
    'link[rel="apple-touch-icon"]',
  ) as HTMLLinkElement | null;
  if (apple) {
    if (appleBlobUrl) {
      URL.revokeObjectURL(appleBlobUrl);
      appleBlobUrl = null;
    }
    apple.href = "/apple-touch-icon.png";
  }
}

/** Resolve the mark to show: live profile identity, else a safe normalized fallback. */
export function identityForIcons(
  raw: unknown,
  seed: string,
): IdentityConfig {
  return normalizeIdentity(raw, seed);
}
