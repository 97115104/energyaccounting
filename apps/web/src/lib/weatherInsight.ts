import { isOutdoorActivity } from "./activitySuggest";
import { hourInTimezone } from "./timezone";
import {
  isDaylightPeriod,
  skyPeriod,
  weatherKindFromCode,
  type SkyPeriod,
  type WeatherKind,
} from "./weatherUi";

export type WeatherSeries = {
  time: string[];
  weathercode: Array<number | null>;
  temp: Array<number | null>;
  precip: Array<number | null>;
};

export type HourlyUvSeries = {
  time: string[];
  uv: Array<number | null>;
};

export type DayWeather = {
  weathercode: number | null;
  tempMax: number | null;
  tempMin: number | null;
  precip: number | null;
  uvMax: number | null;
  sunrise: string | null;
  sunset: string | null;
  source: string | null;
  /** IANA zone Open-Meteo used for local series keys (preferred for indexing). */
  timezone: string | null;
  /** 15-min condition series when the day was fetched with payload v3+. */
  minutely15: WeatherSeries | null;
  /** Hourly UV (interpolated at resolve time). */
  hourlyUv: HourlyUvSeries | null;
};

export type WeatherTimeSlot = "morning" | "afternoon" | "evening" | "night";

export type WeatherConditionsNow = {
  kind: WeatherKind;
  weathercode: number | null;
  temp: number | null;
  precip: number | null;
  /** Effective UV right now (interpolated hourly, or daily max fallback). */
  uv: number | null;
  /** Day's peak UV for chip/modal context. */
  uvMax: number | null;
  isDaylight: boolean;
  sky: SkyPeriod;
  slot: WeatherTimeSlot;
  /** Open-Meteo time key for the active 15-min bucket, when known. */
  bucket: string | null;
};

export type UvBand = {
  level: "low" | "moderate" | "high" | "very-high" | "extreme";
  label: string;
};

export type WeatherFavorite = {
  side: string;
  label?: string;
  useCount: number;
};

export type WeatherDaySuggestion = {
  headline: string;
  body: string;
  activity?: string;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseNumberList(value: unknown): Array<number | null> | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => finiteNumber(entry));
}

function parseStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) return null;
    out.push(entry);
  }
  return out;
}

function parseMinutely15(raw: unknown): WeatherSeries | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const time = parseStringList(obj.time);
  const weathercode = parseNumberList(obj.weathercode);
  const temp = parseNumberList(obj.temp);
  const precip = parseNumberList(obj.precip);
  if (!time || !weathercode || !temp || !precip) return null;
  if (time.length === 0) return null;
  if (weathercode.length !== time.length || temp.length !== time.length || precip.length !== time.length) {
    return null;
  }
  return { time, weathercode, temp, precip };
}

function parseHourlyUv(raw: unknown): HourlyUvSeries | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const time = parseStringList(obj.time);
  const uv = parseNumberList(obj.uv);
  if (!time || !uv || time.length === 0 || uv.length !== time.length) return null;
  return { time, uv };
}

/** Narrow the server's JSON payload once so weather UI does not cast fields ad hoc. */
export function parseDayWeather(raw: Record<string, unknown> | null): DayWeather | null {
  if (!raw) return null;
  const weathercode = finiteNumber(raw.weathercode);
  const tempMax = finiteNumber(raw.tempMax);
  const tempMin = finiteNumber(raw.tempMin);
  const precip = finiteNumber(raw.precip);
  const uvMax = finiteNumber(raw.uvMax);
  const sunrise = optionalString(raw.sunrise);
  const sunset = optionalString(raw.sunset);
  const source = optionalString(raw.source);
  const timezone = optionalString(raw.timezone);
  const minutely15 = parseMinutely15(raw.minutely15);
  const hourlyUv = parseHourlyUv(raw.hourlyUv);

  if (
    weathercode == null &&
    tempMax == null &&
    tempMin == null &&
    precip == null &&
    uvMax == null &&
    sunrise == null &&
    sunset == null &&
    !minutely15
  ) {
    return null;
  }

  return {
    weathercode,
    tempMax,
    tempMin,
    precip,
    uvMax,
    sunrise,
    sunset,
    source,
    timezone,
    minutely15,
    hourlyUv,
  };
}

/** Same greeting-style buckets so quips and guide time-of-day stay aligned. */
export function weatherTimeSlot(hour: number): WeatherTimeSlot {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/** Wall-clock `YYYY-MM-DDTHH:mm` in an IANA zone, matching Open-Meteo local keys. */
export function localWallClockKey(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  } catch {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const h = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${d}T${h}:${min}`;
  }
}

function floorToQuarterHour(key: string): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}):(\d{2})/.exec(key);
  if (!match) return key;
  const minute = Number(match[2]);
  const floored = String(Math.floor(minute / 15) * 15).padStart(2, "0");
  return `${match[1]}:${floored}`;
}

/** Latest series index whose time key is ≤ target (string compare works for ISO-local). */
function indexAtOrBefore(times: string[], target: string): number {
  let best = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i]! <= target) best = i;
    else break;
  }
  return best >= 0 ? best : 0;
}

function minutesFromKey(key: string): number | null {
  const match = /T(\d{2}):(\d{2})/.exec(key);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Linear interpolate hourly UV to the current wall-clock minute. */
export function interpolateUv(series: HourlyUvSeries | null, wallKey: string): number | null {
  if (!series || series.time.length === 0) return null;
  const targetMin = minutesFromKey(wallKey);
  if (targetMin == null) return finiteNumber(series.uv[indexAtOrBefore(series.time, wallKey)]);

  let lo = -1;
  let hi = -1;
  for (let i = 0; i < series.time.length; i++) {
    const t = series.time[i]!;
    if (t <= wallKey) lo = i;
    if (t >= wallKey && hi < 0) hi = i;
  }
  if (lo < 0 && hi < 0) return null;
  if (lo < 0) return finiteNumber(series.uv[hi]);
  if (hi < 0 || hi === lo) return finiteNumber(series.uv[lo]);

  const loMin = minutesFromKey(series.time[lo]!);
  const hiMin = minutesFromKey(series.time[hi]!);
  const loUv = finiteNumber(series.uv[lo]);
  const hiUv = finiteNumber(series.uv[hi]);
  if (loMin == null || hiMin == null || loUv == null || hiUv == null) return loUv ?? hiUv;
  if (hiMin === loMin) return loUv;
  const t = (targetMin - loMin) / (hiMin - loMin);
  return loUv + (hiUv - loUv) * Math.min(1, Math.max(0, t));
}

/**
 * Resolve forecast conditions for quips, guide, and suggestions.
 * Prefers the 15-min series; falls back to daily aggregates for older payloads.
 * Series keys are in Open-Meteo's location timezone (stored on the payload).
 */
export function conditionsAt(
  weather: DayWeather,
  opts: {
    now?: Date;
    /** Fallback zone when the payload has no Open-Meteo timezone. */
    timeZone: string;
    lat?: number | null;
    lon?: number | null;
  },
): WeatherConditionsNow {
  const now = opts.now ?? new Date();
  // Index series in the forecast zone; skyPeriod can still use coords + this zone.
  const seriesZone = weather.timezone || opts.timeZone;
  const sky = skyPeriod(opts.lat, opts.lon, seriesZone, now);
  const isDaylight = isDaylightPeriod(sky);
  const slot = weatherTimeSlot(hourInTimezone(now, seriesZone));
  const wallKey = localWallClockKey(now, seriesZone);
  const wallDay = wallKey.slice(0, 10);
  const bucketKey = floorToQuarterHour(wallKey);

  let weathercode = weather.weathercode;
  let temp = weather.tempMax;
  let precip: number | null = null;
  let bucket: string | null = null;

  // Only walk the 15-min series when it covers *this* local calendar day.
  // Overnight-open energy days used to clamp to yesterday 23:59 (UV 0, evening temp).
  const seriesDay = weather.minutely15?.time[0]?.slice(0, 10) ?? null;
  if (weather.minutely15 && seriesDay === wallDay) {
    const idx = indexAtOrBefore(weather.minutely15.time, bucketKey);
    bucket = weather.minutely15.time[idx] ?? null;
    weathercode = weather.minutely15.weathercode[idx] ?? weathercode;
    temp = weather.minutely15.temp[idx] ?? temp;
    precip = weather.minutely15.precip[idx] ?? null;
  }

  const uvSeriesDay = weather.hourlyUv?.time[0]?.slice(0, 10) ?? null;
  let uv =
    weather.hourlyUv && uvSeriesDay === wallDay
      ? interpolateUv(weather.hourlyUv, wallKey)
      : null;
  if (uv == null) {
    // Without a same-day hourly curve, daily max is only a midday stand-in.
    uv = sky === "day" ? weather.uvMax : weather.uvMax != null ? 0 : null;
  } else if (!isDaylight) {
    uv = 0;
  }

  return {
    kind: weatherKindFromCode(weathercode),
    weathercode,
    temp,
    precip,
    uv,
    uvMax: weather.uvMax,
    isDaylight,
    sky,
    slot,
    bucket,
  };
}

export function uvBand(uv: number): UvBand {
  // Forecasts can be fractional, while the UI and public UV scale use whole indices.
  const index = Math.round(uv);
  if (index < 3) return { level: "low", label: "Low" };
  if (index < 6) return { level: "moderate", label: "Moderate" };
  if (index < 8) return { level: "high", label: "High" };
  if (index < 11) return { level: "very-high", label: "Very high" };
  return { level: "extreme", label: "Extreme" };
}

function favoriteDeposit(
  favorites: WeatherFavorite[],
  location: "outdoor" | "indoor",
): { label: string; useCount: number } | null {
  return (
    favorites
      .filter(
        (item): item is WeatherFavorite & { label: string } =>
          item.side === "deposit" &&
          !!item.label?.trim() &&
          isOutdoorActivity(item.label) === (location === "outdoor"),
      )
      .sort((a, b) => b.useCount - a.useCount)[0] ?? null
  );
}

function personalizedBody(
  favorite: { label: string; useCount: number } | null,
  fallback: string,
): Pick<WeatherDaySuggestion, "body" | "activity"> {
  if (!favorite) return { body: fallback };
  return {
    activity: favorite.label,
    body: `${favorite.label} could fit well, and you've used it to add energy ${favorite.useCount}×.`,
  };
}

/**
 * Turn current conditions into cautious guidance, preferring familiar energy-giving
 * activities without claiming that weather alone determines what someone can do.
 */
export function weatherDaySuggestion(input: {
  kind: WeatherKind;
  /** Effective UV right now (not necessarily the day's max). */
  uv: number | null;
  precip: number | null;
  isDaylight: boolean;
  favorites: WeatherFavorite[];
}): WeatherDaySuggestion {
  const { kind, uv: uvNow, isDaylight, favorites } = input;
  const indoorFavorite = favoriteDeposit(favorites, "indoor");
  const outdoorFavorite = favoriteDeposit(favorites, "outdoor");
  const wetOrStormy = kind === "rain" || kind === "snow" || kind === "thunder";
  const uv = uvNow == null ? null : uvBand(uvNow);

  if (wetOrStormy) {
    return {
      headline: kind === "thunder" ? "Make indoor plans" : "A cozy indoor stretch",
      ...personalizedBody(
        indoorFavorite,
        "Consider an indoor activity that reliably gives some energy back.",
      ),
    };
  }

  if ((uv?.level === "very-high" || uv?.level === "extreme") && isDaylight) {
    return {
      headline: "Very strong sun right now",
      ...personalizedBody(
        indoorFavorite,
        "An indoor favorite may feel better during peak UV; save outside time for later.",
      ),
    };
  }

  if (uv?.level === "high" && isDaylight) {
    return {
      headline: "Plan around the sun",
      ...personalizedBody(
        indoorFavorite,
        "UV is high right now, so favor shade, protection, or an indoor activity.",
      ),
    };
  }

  const dry = kind === "sun" || kind === "cloud";
  if (dry && isDaylight && (uv?.level === "low" || uv?.level === "moderate")) {
    return {
      headline: uv.level === "low" ? "Low UV may favor outside time" : "Conditions may suit outside time",
      ...personalizedBody(
        outdoorFavorite,
        "Conditions look suitable for some outside time if that feels good now.",
      ),
    };
  }

  if (!isDaylight) {
    return {
      headline: "Ease into the evening",
      ...personalizedBody(
        indoorFavorite,
        "A familiar indoor activity could be a gentle way to recharge.",
      ),
    };
  }

  return {
    headline: "Keep the day flexible",
    ...personalizedBody(
      indoorFavorite,
      "Use the forecast as one input and choose what feels manageable today.",
    ),
  };
}

/**
 * Day-level summary for closed / history views: overall conditions, not a live bucket.
 * Temp is the mid-point of the day's high/low (or the mean of the 15-min series when present).
 * UV prefers the mean of daytime hourly samples, else the day's max.
 */
export function dayAverageConditions(weather: DayWeather): WeatherConditionsNow {
  const kind = weatherKindFromCode(weather.weathercode);

  let temp: number | null = null;
  if (weather.minutely15) {
    const samples = weather.minutely15.temp.filter((t): t is number => t != null);
    if (samples.length > 0) {
      temp = samples.reduce((a, b) => a + b, 0) / samples.length;
    }
  }
  if (temp == null && weather.tempMin != null && weather.tempMax != null) {
    temp = (weather.tempMin + weather.tempMax) / 2;
  } else if (temp == null) {
    temp = weather.tempMax ?? weather.tempMin;
  }

  let uv: number | null = null;
  if (weather.hourlyUv) {
    // Daytime-ish UV samples only — overnight zeros would drag the mean down.
    const samples = weather.hourlyUv.uv.filter((v): v is number => v != null && v > 0);
    if (samples.length > 0) {
      uv = samples.reduce((a, b) => a + b, 0) / samples.length;
    }
  }
  if (uv == null) uv = weather.uvMax;

  return {
    kind,
    weathercode: weather.weathercode,
    temp,
    precip: weather.precip,
    uv,
    uvMax: weather.uvMax,
    isDaylight: true,
    sky: "day",
    slot: "afternoon",
    bucket: null,
  };
}
