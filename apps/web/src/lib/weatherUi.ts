/** Weather mapping, sunrise/sunset math, and temperature formatting. */

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

const GOLDEN_BEFORE_MS = 40 * 60_000;
const GOLDEN_AFTER_MS = 30 * 60_000;
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
  // Keep authenticated and signed-out skies consistent at the local night
  // boundary; solar golden hour must not reintroduce a sun after 20:00.
  // Polar day is the only exception — the sun truly never sets.
  if (isNightInTimezone(timezone, now)) {
    if (lat != null && lon != null) {
      const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      for (const offset of [0, -1, 1] as const) {
        const result = sunTimesForUtcDay(lat, lon, new Date(utcMidnight + offset * DAY_MS));
        if (result.kind === "polar" && result.alwaysUp) return "day";
      }
    }
    return "night";
  }
  if (lat != null && lon != null) {
    const t = now.getTime();
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    // Prefer a polar answer if any nearby day is polar (consistent within a day).
    for (const offset of [0, -1, 1] as const) {
      const result = sunTimesForUtcDay(lat, lon, new Date(utcMidnight + offset * DAY_MS));
      if (result.kind === "polar") {
        return result.alwaysUp ? "day" : "night";
      }
    }

    // Among neighboring civil days, find the rise/set pair that contains `now`
    // (or the nearest golden-hour window around those edges).
    let best: SkyPeriod | null = null;
    let bestDist = Infinity;
    for (const offset of [-1, 0, 1] as const) {
      const result = sunTimesForUtcDay(lat, lon, new Date(utcMidnight + offset * DAY_MS));
      if (result.kind !== "times") continue;
      const rise = result.sunrise.getTime();
      const set = result.sunset.getTime();

      if (t >= rise - GOLDEN_BEFORE_MS && t <= rise + GOLDEN_AFTER_MS) return "dawn";
      if (t >= set - GOLDEN_AFTER_MS && t <= set + GOLDEN_BEFORE_MS) return "dusk";
      if (t > rise && t < set) return "day";

      // Track distance to the day interval so "night" can still be chosen when
      // we're between yesterday's set and tomorrow's rise.
      const dist = t < rise ? rise - t : t - set;
      if (dist < bestDist) {
        bestDist = dist;
        best = "night";
      }
    }
    if (best) return best;
  }
  return isNightInTimezone(timezone, now) ? "night" : "day";
}

/** True when the current sky period is daytime-ish (for UV tips that cite daily max). */
export function isDaylightPeriod(period: SkyPeriod): boolean {
  return period === "day" || period === "dawn" || period === "dusk";
}

/** Day vs night from local hour in the given IANA timezone (fallback path). */
export function isNightInTimezone(timezone: string, now = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone || "UTC",
    }).formatToParts(now);
    // Some engines emit "24" for midnight under hour12:false — normalize.
    let hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
    if (hour === 24) hour = 0;
    return hour < 6 || hour >= 20;
  } catch {
    const h = now.getHours();
    return h < 6 || h >= 20;
  }
}
