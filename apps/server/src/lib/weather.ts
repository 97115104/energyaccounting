import { eq, and } from "drizzle-orm";
import { db } from "../db/index.ts";
import { weatherCacheTable } from "../db/schema.ts";
import { newId } from "./session.ts";

function roundCoord(n: number): string {
  return n.toFixed(2);
}

/** Bump when the payload shape changes so stale cache rows get refetched. */
export const WEATHER_PAYLOAD_VERSION = 3;

/** True when a stored day payload already has the v3 shape (stop soft-refresh loops). */
export function isCurrentWeatherPayload(payload: Record<string, unknown> | null | undefined): boolean {
  return !!payload && payload.v === WEATHER_PAYLOAD_VERSION;
}

/** Calendar `YYYY-MM-DD` in an IANA zone (Open-Meteo local dates). */
export function calendarDateInTimeZone(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Open days can span midnight; live quips/guide need **today's** forecast in the
 * location zone, not the energy day's start date.
 */
export function weatherNeedsRefresh(
  payload: Record<string, unknown> | null | undefined,
  todayLocal: string,
): boolean {
  if (!isCurrentWeatherPayload(payload)) return true;
  if (!payload) return true;
  if (typeof payload.timezone !== "string" || !payload.timezone) return true;
  if (typeof payload.date !== "string" || payload.date !== todayLocal) return true;
  const series = payload.minutely15;
  if (!series || typeof series !== "object") return true;
  const time = (series as { time?: unknown }).time;
  return !Array.isArray(time) || time.length === 0;
}

export async function fetchDayWeather(
  lat: number,
  lon: number,
  date: string,
): Promise<Record<string, unknown> | null> {
  const latKey = roundCoord(lat);
  const lonKey = roundCoord(lon);
  const cached = await db.query.weatherCacheTable.findFirst({
    where: and(
      eq(weatherCacheTable.latKey, latKey),
      eq(weatherCacheTable.lonKey, lonKey),
      eq(weatherCacheTable.date, date),
    ),
  });
  if (cached) {
    try {
      const payload = JSON.parse(cached.payload) as Record<string, unknown>;
      if (isCurrentWeatherPayload(payload)) return payload;
    } catch {
      /* refetch */
    }
  }

  // Daily summary + 15-min conditions; UV only exists on the hourly timeline.
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,uv_index_max,sunrise,sunset` +
    `&minutely_15=weather_code,temperature_2m,precipitation` +
    `&hourly=uv_index` +
    `&timezone=auto&start_date=${date}&end_date=${date}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      timezone?: string;
      daily?: {
        time?: string[];
        weathercode?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
        uv_index_max?: number[];
        sunrise?: string[];
        sunset?: string[];
      };
      minutely_15?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m?: number[];
        precipitation?: number[];
      };
      hourly?: {
        time?: string[];
        uv_index?: number[];
      };
    };
    const daily = raw.daily;
    if (!daily?.time?.[0]) return null;

    const m15 = raw.minutely_15;
    const hourly = raw.hourly;
    const minutely15 =
      m15?.time && m15.time.length > 0
        ? {
            time: m15.time,
            weathercode: (m15.weather_code ?? []).length === m15.time.length
              ? m15.weather_code!
              : m15.time.map(() => null),
            temp: (m15.temperature_2m ?? []).length === m15.time.length
              ? m15.temperature_2m!
              : m15.time.map(() => null),
            precip: (m15.precipitation ?? []).length === m15.time.length
              ? m15.precipitation!
              : m15.time.map(() => null),
          }
        : null;
    const hourlyUv =
      hourly?.time && hourly.time.length > 0
        ? {
            time: hourly.time,
            uv:
              (hourly.uv_index ?? []).length === hourly.time.length
                ? hourly.uv_index!
                : hourly.time.map(() => null),
          }
        : null;

    const payload = {
      v: WEATHER_PAYLOAD_VERSION,
      date: daily.time[0],
      // Open-Meteo local keys are in this zone — client must index with it, not the device TZ.
      timezone: typeof raw.timezone === "string" && raw.timezone ? raw.timezone : null,
      weathercode: daily.weathercode?.[0] ?? null,
      tempMax: daily.temperature_2m_max?.[0] ?? null,
      tempMin: daily.temperature_2m_min?.[0] ?? null,
      precip: daily.precipitation_sum?.[0] ?? null,
      uvMax: daily.uv_index_max?.[0] ?? null,
      sunrise: daily.sunrise?.[0] ?? null,
      sunset: daily.sunset?.[0] ?? null,
      minutely15,
      hourlyUv,
      source: "Open-Meteo",
    };
    const existing = await db.query.weatherCacheTable.findFirst({
      where: and(
        eq(weatherCacheTable.latKey, latKey),
        eq(weatherCacheTable.lonKey, lonKey),
        eq(weatherCacheTable.date, date),
      ),
    });
    if (existing) {
      await db
        .update(weatherCacheTable)
        .set({ payload: JSON.stringify(payload) })
        .where(eq(weatherCacheTable.id, existing.id));
    } else {
      await db.insert(weatherCacheTable).values({
        id: newId(),
        latKey,
        lonKey,
        date,
        payload: JSON.stringify(payload),
      });
    }
    return payload;
  } catch {
    return null;
  }
}
