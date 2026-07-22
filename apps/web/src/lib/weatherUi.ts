/** Weather mapping, sunrise/sunset math, and temperature formatting. */

import WEATHER_QUIPS from "../content/weather-quips.json";
import { hourInTimezone, isNightInTimezone } from "./timezone";

// Re-exported to keep weatherUi's public API unchanged after the move.
export { isNightInTimezone };

export type WeatherKind = "sun" | "rain" | "cloud" | "snow" | "fog" | "thunder" | "unknown";

type WeatherQuipPools = {
  thunder: string[];
  rain: string[];
  snow: string[];
  fog: string[];
  cloud: string[];
  sunHotHighUv: string[];
  sunHot: string[];
  sunHighUv: string[];
  sunChilly: string[];
  sunWarm: string[];
  sunClear: string[];
  fallback: string[];
};

const QUIPS = WEATHER_QUIPS as WeatherQuipPools;

export function weatherKindFromCode(code: unknown): WeatherKind {
  if (typeof code !== "number") return "unknown";
  if (code === 0 || code === 1) return "sun";
  if (code === 2 || code === 3) return "cloud";
  if (code >= 45 && code <= 48) return "fog";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95) return "thunder";
  return "unknown";
}

export function weatherLabel(kind: WeatherKind): string {
  switch (kind) {
    case "sun":
      return "Clear";
    case "rain":
      return "Rain";
    case "cloud":
      return "Clouds";
    case "snow":
      return "Snow";
    case "fog":
      return "Fog";
    case "thunder":
      return "Thunderstorms";
    default:
      return "Weather";
  }
}

export type TemperatureUnit = "C" | "F";

/** US (plus the few other Fahrenheit holdouts) default to F; everyone else C. */
export function defaultTemperatureUnit(country?: string | null): TemperatureUnit {
  if (country === "US") return "F";
  const locale = (typeof navigator !== "undefined" ? navigator.language : "") || "";
  if (/-(us|lr|mm)\b/i.test(locale)) return "F";
  return "C";
}

export function formatTemp(celsius: number, unit: TemperatureUnit): string {
  if (unit === "F") return `${Math.round((celsius * 9) / 5 + 32)}°F`;
  return `${Math.round(celsius)}°C`;
}

/** Format a min–max range in one unit suffix, e.g. "66–91°F". */
export function formatTempRange(minC: number, maxC: number, unit: TemperatureUnit): string {
  const conv = (c: number) => (unit === "F" ? Math.round((c * 9) / 5 + 32) : Math.round(c));
  return `${conv(minC)}–${conv(maxC)}°${unit}`;
}

export type SunTimes =
  | { kind: "times"; sunrise: Date; sunset: Date }
  | { kind: "polar"; alwaysUp: boolean };

/**
 * NOAA-style solar calculation for one UTC calendar day (accurate to ~1 min).
 * `utcDay` is any instant on the UTC day of interest (typically that day's midnight).
 */
export function sunTimesForUtcDay(lat: number, lon: number, utcDay: Date): SunTimes {
  const rad = Math.PI / 180;
  const y = utcDay.getUTCFullYear();
  const startOfYear = Date.UTC(y, 0, 1);
  const dayOfYear =
    Math.floor((Date.UTC(y, utcDay.getUTCMonth(), utcDay.getUTCDate()) - startOfYear) / 86_400_000) +
    1;
  // Noon-ish gamma for the day (NOAA convention).
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (12 - 12) / 24);

  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // 90.833° accounts for refraction plus the solar disc radius.
  const cosHa =
    Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) -
    Math.tan(lat * rad) * Math.tan(decl);
  // cosHa > 1 → never rises (polar night); cosHa < -1 → never sets (polar day).
  if (cosHa > 1) return { kind: "polar", alwaysUp: false };
  if (cosHa < -1) return { kind: "polar", alwaysUp: true };

  const haDeg = Math.acos(Math.min(1, Math.max(-1, cosHa))) / rad;
  const utcMidnight = Date.UTC(y, utcDay.getUTCMonth(), utcDay.getUTCDate());
  const sunriseMin = 720 - 4 * (lon + haDeg) - eqTime;
  const sunsetMin = 720 - 4 * (lon - haDeg) - eqTime;
  return {
    kind: "times",
    sunrise: new Date(utcMidnight + sunriseMin * 60_000),
    sunset: new Date(utcMidnight + sunsetMin * 60_000),
  };
}

/** Convenience: sun times for the UTC day of `now`. */
export function sunTimes(lat: number, lon: number, now = new Date()): SunTimes {
  return sunTimesForUtcDay(lat, lon, now);
}

export type SkyPeriod = "day" | "night" | "dawn" | "dusk";

/** Predawn / post-dusk golden shoulder (shared with continuous skyPalette). */
export const GOLDEN_BEFORE_MS = 40 * 60_000;
/** Post-sunrise / pre-sunset golden shoulder. */
export const GOLDEN_AFTER_MS = 30 * 60_000;
const DAY_MS = 86_400_000;

/**
 * Sky period from real sun position when coordinates are known,
 * otherwise a fixed 6:00–20:00 daytime window in the given timezone.
 *
 * Checks yesterday / today / tomorrow UTC days so mornings in UTC+ zones
 * (Tokyo, Sydney, …) aren't stuck on "night" until UTC midnight.
 */
export function skyPeriod(
  lat: number | null | undefined,
  lon: number | null | undefined,
  timezone: string,
  now = new Date(),
): SkyPeriod {
  const hour = hourInTimezone(now, timezone || "UTC");

  // Hard evening floor: solar golden hour must not keep a sun after 20:00.
  // Polar day is the only exception (the sun truly never sets).
  if (hour >= 20) {
    if (lat != null && lon != null && isPolarAlwaysUp(lat, lon, now)) return "day";
    return "night";
  }

  if (lat != null && lon != null) {
    const fromSun = periodFromSunTimes(lat, lon, now);
    if (fromSun != null) return fromSun;
  }

  // No coords, or sun times left us outside every daylight window.
  return hour < 6 ? "night" : "day";
}

/** True when every nearby UTC day is polar-up (no civil rise/set to contradict). */
function isPolarAlwaysUp(lat: number, lon: number, now: Date): boolean {
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let sawPolarUp = false;
  for (const offset of [-1, 0, 1] as const) {
    const result = sunTimesForUtcDay(lat, lon, new Date(utcMidnight + offset * DAY_MS));
    if (result.kind === "times") return false;
    if (result.kind === "polar" && result.alwaysUp) sawPolarUp = true;
  }
  return sawPolarUp;
}

/**
 * Dawn / day / dusk / night from neighboring UTC rise/set pairs.
 * Polar answers only apply when no civil day offers times, a polar neighbor
 * must not override a real sunrise on the current day.
 */
function periodFromSunTimes(lat: number, lon: number, now: Date): SkyPeriod | null {
  const t = now.getTime();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  let bestNightDist = Infinity;
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

    if (t >= rise - GOLDEN_BEFORE_MS && t <= rise + GOLDEN_AFTER_MS) return "dawn";
    if (t >= set - GOLDEN_AFTER_MS && t <= set + GOLDEN_BEFORE_MS) return "dusk";
    if (t > rise && t < set) return "day";

    const dist = t < rise ? rise - t : t - set;
    if (dist < bestNightDist) bestNightDist = dist;
  }

  if (sawTimes) return "night";
  if (polarUp) return "day";
  if (polarDown) return "night";
  return null;
}

/** True when the current sky period is daytime-ish (for UV tips that cite daily max). */
export function isDaylightPeriod(period: SkyPeriod): boolean {
  return period === "day" || period === "dawn" || period === "dusk";
}

/** Stable pick so the quip rotates across days/slots without flickering. */
function pickQuip(pool: string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length]!;
}

export type WeatherQuipSlot = "morning" | "afternoon" | "evening" | "night";

/**
 * Short, lightly funny line about current weather for the Today header.
 * Copy lives in content/weather-quips.json so pools can grow without
 * touching picker logic. Plain human voice, no energy-accounting jargon.
 * Temps are Celsius. Seed includes the time slot so lines rotate through the day.
 */
export function weatherQuip(opts: {
  kind: WeatherKind;
  /** Effective UV right now. */
  uv: number | null;
  /** Temperature right now (°C). */
  temp: number | null;
  date: string;
  slot?: WeatherQuipSlot;
}): string {
  const { kind, uv, temp, date, slot = "morning" } = opts;
  const seed = `${date}|${slot}`;
  const hot = temp != null && temp >= 29;
  const warm = temp != null && temp >= 24;
  const chilly = temp != null && temp <= 10;
  const highUv = uv != null && uv >= 7;
  const spicyUv = uv != null && uv >= 5;

  if (kind === "thunder") return pickQuip(QUIPS.thunder, seed);
  if (kind === "rain") return pickQuip(QUIPS.rain, seed);
  if (kind === "snow") return pickQuip(QUIPS.snow, seed);
  if (kind === "fog") return pickQuip(QUIPS.fog, seed);
  if (kind === "cloud") return pickQuip(QUIPS.cloud, seed);
  if (kind === "sun" || kind === "unknown") {
    if (hot && highUv) return pickQuip(QUIPS.sunHotHighUv, seed);
    if (hot) return pickQuip(QUIPS.sunHot, seed);
    if (highUv || (warm && spicyUv)) return pickQuip(QUIPS.sunHighUv, seed);
    if (chilly) return pickQuip(QUIPS.sunChilly, seed);
    if (warm) return pickQuip(QUIPS.sunWarm, seed);
    return pickQuip(QUIPS.sunClear, seed);
  }
  return pickQuip(QUIPS.fallback, seed);
}
