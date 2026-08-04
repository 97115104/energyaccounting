/**
 * Apply NeuroMe mark icons in the browser.
 *
 * Tab favicons use an SVG data URL. Apple touch / Home Screen icons must be a
 * real same-origin URL, because iOS ignores blob: and data: for Add to Home
 * Screen, so we point at /api/auth/touch-icon, which rasterizes the same mark
 * server-side.
 */

import { normalizeIdentity, type IdentityConfig } from "./identity";
import { identityFaviconDataUrl } from "./identityFaviconSvg";

export { identityFaviconSvg, identityFaviconDataUrl } from "./identityFaviconSvg";

let appleIconVersion: string | null = null;

function hashVersion(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function touchIconHref(version: string): string {
  return `/api/auth/touch-icon?v=${encodeURIComponent(version)}`;
}

/** Point the document favicon at this mark; Home Screen uses the auth PNG URL. */
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
  apple.setAttribute("sizes", "180x180");
  const version = hashVersion(JSON.stringify(identity) + background);
  if (appleIconVersion === version && apple.href.includes("/api/auth/touch-icon")) return;
  appleIconVersion = version;
  apple.href = touchIconHref(version);
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
    appleIconVersion = null;
    apple.setAttribute("sizes", "180x180");
    apple.href = "/apple-touch-icon.png";
  }
}

/** Resolve the mark to show: live profile identity, else a safe normalized fallback. */
export function identityForIcons(raw: unknown, seed: string): IdentityConfig {
  return normalizeIdentity(raw, seed);
}
