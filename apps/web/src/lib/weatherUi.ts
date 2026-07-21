/** Map Open-Meteo weathercode to a simple UI kind. */

export type WeatherKind = "sun" | "rain" | "cloud" | "unknown";

export function weatherKindFromCode(code: unknown): WeatherKind {
  if (typeof code !== "number") return "unknown";
  if (code === 0 || code === 1) return "sun";
  if (code >= 51 && code <= 67) return "rain";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 95) return "rain";
  if (code >= 2 && code <= 48) return "cloud";
  return "unknown";
}

export function weatherLabel(kind: WeatherKind): string {
  if (kind === "sun") return "Clear";
  if (kind === "rain") return "Rain";
  if (kind === "cloud") return "Clouds";
  return "Weather";
}

/** Day vs night from local hour in the given IANA timezone. */
export function isNightInTimezone(timezone: string, now = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone || "UTC",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
    return hour < 6 || hour >= 20;
  } catch {
    const h = now.getHours();
    return h < 6 || h >= 20;
  }
}
