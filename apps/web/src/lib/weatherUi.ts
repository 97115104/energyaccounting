/** Weather mapping, sunrise/sunset math, and temperature formatting. */

import { hourInTimezone, isNightInTimezone } from "./timezone";

// Re-exported to keep weatherUi's public API unchanged after the move.
export { isNightInTimezone };

export type WeatherKind = "sun" | "rain" | "cloud" | "snow" | "fog" | "thunder" | "unknown";

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
 * Polar answers only apply when no civil day offers times — a polar neighbor
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

/** Stable day-keyed pick so the quip rotates across days without flickering. */
function pickQuip(pool: string[], seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[hash % pool.length]!;
}

/**
 * Short, lightly funny line about today's weather for the Today header.
 * Plain human voice — no energy-accounting jargon. Temps are Celsius.
 */
export function weatherQuip(opts: {
  kind: WeatherKind;
  uvMax: number | null;
  tempMax: number | null;
  date: string;
}): string {
  const { kind, uvMax, tempMax, date } = opts;
  const hot = tempMax != null && tempMax >= 29;
  const warm = tempMax != null && tempMax >= 24;
  const chilly = tempMax != null && tempMax <= 10;
  const highUv = uvMax != null && uvMax >= 7;
  const spicyUv = uvMax != null && uvMax >= 5;

  if (kind === "thunder") {
    return pickQuip(
      [
        "The sky is having a tantrum. Headphones recommended.",
        "Thunder's oversharing again. You don't have to.",
        "Boom weather. Indoors is the main character today.",
      ],
      date,
    );
  }
  if (kind === "rain") {
    return pickQuip(
      [
        "It's raining. Canceling outside is free and legal.",
        "Wet socks are not a personality. Stay in.",
        "Rain check on the rain. Soft socks instead.",
      ],
      date,
    );
  }
  if (kind === "snow") {
    return pickQuip(
      [
        "Snow day energy, even if your calendar disagrees.",
        "It's snowing. Ambition can wait in the hallway.",
        "Fluffy outside. Low-effort inside.",
      ],
      date,
    );
  }
  if (kind === "fog") {
    return pickQuip(
      [
        "Foggy. Your brain has permission to match.",
        "Can't see far. Don't plan far either.",
        "The world hit soft focus. Join it.",
      ],
      date,
    );
  }
  if (kind === "cloud") {
    return pickQuip(
      [
        "Cloudy. Nature's blue-light filter, free of charge.",
        "Gray skies, less squinting. We'll take it.",
        "Overcast. The sun called in sick.",
      ],
      date,
    );
  }
  if (kind === "sun" || kind === "unknown") {
    if (hot && highUv) {
      return pickQuip(
        [
          "Don't forget sunscreen, even though it sucks.",
          "The sun is being rude. Shade and water, please.",
          "Hot UV chaos. You are not a plant. Cover up.",
        ],
        date,
      );
    }
    if (hot) {
      return pickQuip(
        [
          "It's hot. Melting is optional; shade is not.",
          "Scorcher. Move like molasses on purpose.",
          "Heat wave. Your only job is not cooking yourself.",
        ],
        date,
      );
    }
    if (highUv || (warm && spicyUv)) {
      return pickQuip(
        [
          "UV's up. Sunscreen, even if it's annoying.",
          "Bright and spicy. A hat is low-effort armor.",
          "The sun is doing too much. Soften it.",
        ],
        date,
      );
    }
    if (chilly) {
      return pickQuip(
        [
          "Chilly. Warm drink > heroic outdoor quests.",
          "Crisp air. One brave minute outside is plenty.",
          "Cool out. Sweater weather, soft ambitions.",
        ],
        date,
      );
    }
    if (warm) {
      return pickQuip(
        [
          "Warm and almost inviting. Don't get bullied by it.",
          "Nice out. A short stretch beats a whole saga.",
          "Pleasant skies. Still no need to overdo it.",
        ],
        date,
      );
    }
    return pickQuip(
      [
        "Clear skies. Steady is still a flex.",
        "Weather's behaving. You can too, slowly.",
        "Open sky. Take only what feels doable.",
      ],
      date,
    );
  }
  return "Weather's hanging around. Tap for the gossip.";
}
