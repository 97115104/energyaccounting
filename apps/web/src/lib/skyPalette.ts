/**
 * Continuous sky colors along the real sun arc (or a 6:00–20:00 fallback).
 * Discrete night chrome still comes from data-theme; this only owns sky tokens.
 */

import { minutesSinceMidnightInTimezone } from "./timezone";
import {
  GOLDEN_AFTER_MS,
  GOLDEN_BEFORE_MS,
  skyPeriod,
  sunTimesForUtcDay,
  type SkyPeriod,
} from "./weatherUi";

export type SkyColors = {
  bg0: string;
  bg1: string;
  skyGlow: string;
  sunFace: string;
  sunHalo: string;
};

export type SkyPalette = SkyColors & { period: SkyPeriod };

const DAY_MS = 86_400_000;

/** Matches styles.css night sky tokens. */
const NIGHT: SkyColors = {
  bg0: "#12182e",
  bg1: "#1a1240",
  skyGlow: "rgba(120, 80, 200, 0.35)",
  sunFace: "#f0e8ff",
  sunHalo: "rgba(200, 180, 255, 0.5)",
};

/**
 * Daylight stops stay close to the noon yellow so the sky shifts read as
 * atmosphere, not a theme change — panels (#fffdf3) shouldn't suddenly pop.
 */
const PREDAWN: SkyColors = {
  bg0: "#ffe8c8",
  bg1: "#f0c898",
  skyGlow: "rgba(255, 190, 120, 0.28)",
  sunFace: "#ffc060",
  sunHalo: "rgba(255, 170, 90, 0.32)",
};

const DAWN: SkyColors = {
  bg0: "#fff0d0",
  bg1: "#ffd4a0",
  skyGlow: "rgba(255, 200, 120, 0.32)",
  sunFace: "#ffc850",
  sunHalo: "rgba(255, 180, 90, 0.35)",
};

const DAY: SkyColors = {
  bg0: "#fff6c8",
  bg1: "#ffe08a",
  skyGlow: "rgba(255, 220, 80, 0.35)",
  sunFace: "#ffcf3d",
  sunHalo: "rgba(255, 200, 60, 0.35)",
};

/** Late afternoon: a whisper warmer/deeper than noon. */
const LATE: SkyColors = {
  bg0: "#fff0b8",
  bg1: "#ffd478",
  skyGlow: "rgba(255, 200, 70, 0.36)",
  sunFace: "#ffc838",
  sunHalo: "rgba(255, 185, 55, 0.36)",
};

/** Pre-sunset: soft gold, still in the day family. */
const GOLDEN: SkyColors = {
  bg0: "#ffe8b0",
  bg1: "#f5c878",
  skyGlow: "rgba(255, 185, 90, 0.34)",
  sunFace: "#ffbe45",
  sunHalo: "rgba(255, 170, 70, 0.36)",
};

/** Sunset: muted peach — no hard rose/magenta jump. */
const DUSK: SkyColors = {
  bg0: "#ffe0bc",
  bg1: "#e8b090",
  skyGlow: "rgba(255, 170, 120, 0.32)",
  sunFace: "#ffb050",
  sunHalo: "rgba(255, 150, 90, 0.34)",
};

/** End of dusk: faint mauve tint before the night snap. */
const DUSK_DEEP: SkyColors = {
  bg0: "#f0d4c8",
  bg1: "#d0a8b0",
  skyGlow: "rgba(200, 140, 160, 0.28)",
  sunFace: "#f0a868",
  sunHalo: "rgba(230, 140, 120, 0.3)",
};

const SKY_VAR_KEYS = ["--bg0", "--bg1", "--sky-glow", "--sun-face", "--sun-halo"] as const;

export type SkyCssVar = (typeof SKY_VAR_KEYS)[number];

/** Inline sky vars App writes; cleared on night so CSS night theme owns them. */
export const SKY_CSS_VARS: readonly SkyCssVar[] = SKY_VAR_KEYS;

type Rgba = { r: number; g: number; b: number; a: number };

function parseColor(input: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(input.trim());
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba =
    /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(
      input.trim(),
    );
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: Number(rgba[4]),
    };
  }
  throw new Error(`Unsupported sky color: ${input}`);
}

function formatColor(c: Rgba, asRgba: boolean): string {
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  if (asRgba) return `rgba(${r}, ${g}, ${b}, ${roundAlpha(c.a)})`;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function roundAlpha(a: number): number {
  return Math.round(a * 1000) / 1000;
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  const mixed: Rgba = {
    r: lerpNum(ca.r, cb.r, t),
    g: lerpNum(ca.g, cb.g, t),
    b: lerpNum(ca.b, cb.b, t),
    a: lerpNum(ca.a, cb.a, t),
  };
  const wantRgba = a.startsWith("rgba") || b.startsWith("rgba") || mixed.a < 1;
  return formatColor(mixed, wantRgba);
}

function lerpSky(a: SkyColors, b: SkyColors, t: number): SkyColors {
  const u = Math.min(1, Math.max(0, t));
  return {
    bg0: lerpColor(a.bg0, b.bg0, u),
    bg1: lerpColor(a.bg1, b.bg1, u),
    skyGlow: lerpColor(a.skyGlow, b.skyGlow, u),
    sunFace: lerpColor(a.sunFace, b.sunFace, u),
    sunHalo: lerpColor(a.sunHalo, b.sunHalo, u),
  };
}

type Anchor = { at: number; colors: SkyColors };

/** Sample colors along sorted time anchors (ms since epoch or local-minute ms). */
function sampleAnchors(anchors: Anchor[], t: number): SkyColors {
  if (anchors.length === 0) return NIGHT;
  if (t <= anchors[0]!.at) return anchors[0]!.colors;
  for (let i = 0; i < anchors.length - 1; i++) {
    const left = anchors[i]!;
    const right = anchors[i + 1]!;
    if (t <= right.at) {
      const span = right.at - left.at;
      const u = span <= 0 ? 1 : (t - left.at) / span;
      return lerpSky(left.colors, right.colors, u);
    }
  }
  return anchors[anchors.length - 1]!.colors;
}

/**
 * Daylight arc from rise→set. Shoulders scale down on short days so anchors
 * stay time-ordered; colors stay day-chrome-safe (no full night navy).
 */
function daylightAnchors(rise: number, set: number): Anchor[] {
  const span = Math.max(set - rise, 1);
  const before = Math.min(GOLDEN_BEFORE_MS, span * 0.45);
  const after = Math.min(GOLDEN_AFTER_MS, span * 0.25);
  const noon = rise + span / 2;
  const late = rise + span * 0.7;
  const anchors: Anchor[] = [
    { at: rise - before, colors: PREDAWN },
    { at: rise, colors: DAWN },
    { at: rise + after, colors: DAY },
    { at: noon, colors: DAY },
    { at: late, colors: LATE },
    { at: set - after, colors: GOLDEN },
    { at: set, colors: DUSK },
    { at: set + before, colors: DUSK_DEEP },
  ];
  return anchors.sort((a, b) => a.at - b.at);
}

function nearestRiseSet(
  lat: number,
  lon: number,
  now: Date,
): { rise: number; set: number } | "polar-day" | "polar-night" | null {
  const t = now.getTime();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  let best: { rise: number; set: number; dist: number } | null = null;
  let sawTimes = false;
  let polarUp = false;
  let polarDown = false;

  for (const offset of [-1, 0, 1] as const) {
    const result = sunTimesForUtcDay(lat, lon, new Date(utcMidnight + offset * DAY_MS));
    if (result.kind === "polar") {
      if (result.alwaysUp) polarUp = true;
      else polarDown = true;
      continue;
    }
    sawTimes = true;
    const rise = result.sunrise.getTime();
    const set = result.sunset.getTime();
    const start = rise - GOLDEN_BEFORE_MS;
    const end = set + GOLDEN_BEFORE_MS;
    if (t >= start && t <= end) return { rise, set };
    const dist = t < rise ? rise - t : t - set;
    if (!best || dist < best.dist) best = { rise, set, dist };
  }

  // Polar only when no civil day offered times (neighbor polar must not win).
  if (!sawTimes && polarUp) return "polar-day";
  if (!sawTimes && polarDown) return "polar-night";
  return best ? { rise: best.rise, set: best.set } : null;
}

/** Fallback rise/set as ms-since-local-midnight for the 6:00–20:00 window. */
function fallbackAnchors(): Anchor[] {
  const rise = 6 * 60 * 60_000;
  const set = 20 * 60 * 60_000;
  return daylightAnchors(rise, set);
}

/**
 * Interpolated sky tokens for the current instant.
 * `period` mirrors skyPeriod (favicons, UV daylight checks, night chrome).
 */
export function skyPalette(
  lat: number | null | undefined,
  lon: number | null | undefined,
  timezone: string,
  now = new Date(),
): SkyPalette {
  const period = skyPeriod(lat, lon, timezone, now);

  // Hard night floor / post-dusk night: solid night palette (polar day excepted).
  if (period === "night") {
    return { period, ...NIGHT };
  }

  if (lat != null && lon != null) {
    const pair = nearestRiseSet(lat, lon, now);
    if (pair === "polar-night") return { period, ...NIGHT };
    if (pair === "polar-day") return { period, ...DAY };
    if (pair) {
      return { period, ...sampleAnchors(daylightAnchors(pair.rise, pair.set), now.getTime()) };
    }
  }

  // No coords (or no usable sun times): same arc on a fixed 6–20 local day.
  const localMs = minutesSinceMidnightInTimezone(now, timezone) * 60_000;
  return { period, ...sampleAnchors(fallbackAnchors(), localMs) };
}

/** Brightness proxy for tests: higher = lighter sky. */
export function skyLuminance(hexOrRgba: string): number {
  const { r, g, b } = parseColor(hexOrRgba);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
