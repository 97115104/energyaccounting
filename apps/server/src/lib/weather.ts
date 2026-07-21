import { eq, and } from "drizzle-orm";
import { db } from "../db/index.ts";
import { weatherCacheTable } from "../db/schema.ts";
import { newId } from "./session.ts";

function roundCoord(n: number): string {
  return n.toFixed(2);
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
      return JSON.parse(cached.payload) as Record<string, unknown>;
    } catch {
      /* refetch */
    }
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&timezone=auto&start_date=${date}&end_date=${date}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = (await res.json()) as {
      daily?: {
        time?: string[];
        weathercode?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
      };
    };
    const daily = raw.daily;
    if (!daily?.time?.[0]) return null;
    const payload = {
      date: daily.time[0],
      weathercode: daily.weathercode?.[0] ?? null,
      tempMax: daily.temperature_2m_max?.[0] ?? null,
      tempMin: daily.temperature_2m_min?.[0] ?? null,
      precip: daily.precipitation_sum?.[0] ?? null,
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
