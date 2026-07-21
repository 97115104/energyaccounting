import { isOutdoorActivity } from "./activitySuggest";
import { weatherKindFromCode, type WeatherKind } from "./weatherUi";

export type DayWeather = {
  weathercode: number | null;
  tempMax: number | null;
  tempMin: number | null;
  precip: number | null;
  uvMax: number | null;
  sunrise: string | null;
  sunset: string | null;
  source: string | null;
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

  if (
    weathercode == null &&
    tempMax == null &&
    tempMin == null &&
    precip == null &&
    uvMax == null &&
    sunrise == null &&
    sunset == null
  ) {
    return null;
  }

  return { weathercode, tempMax, tempMin, precip, uvMax, sunrise, sunset, source };
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
 * Turn daily conditions into cautious guidance, preferring familiar energy-giving
 * activities without claiming that weather alone determines what someone can do.
 */
export function weatherDaySuggestion(input: {
  kind: WeatherKind;
  uvMax: number | null;
  precip: number | null;
  isDaylight: boolean;
  favorites: WeatherFavorite[];
}): WeatherDaySuggestion {
  const { kind, uvMax, isDaylight, favorites } = input;
  const indoorFavorite = favoriteDeposit(favorites, "indoor");
  const outdoorFavorite = favoriteDeposit(favorites, "outdoor");
  const wetOrStormy = kind === "rain" || kind === "snow" || kind === "thunder";
  const uv = uvMax == null ? null : uvBand(uvMax);

  if (wetOrStormy) {
    return {
      headline: kind === "thunder" ? "Make indoor plans" : "A cozy indoor day",
      ...personalizedBody(
        indoorFavorite,
        "Consider an indoor activity that reliably gives some energy back.",
      ),
    };
  }

  if ((uv?.level === "very-high" || uv?.level === "extreme") && isDaylight) {
    return {
      headline: "Very strong sun today",
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
        "UV is high, so favor shade, protection, or an indoor activity around midday.",
      ),
    };
  }

  const dry = kind === "sun" || kind === "cloud";
  if (dry && isDaylight && (uv?.level === "low" || uv?.level === "moderate")) {
    return {
      headline: uv.level === "low" ? "Low UV may favor outside time" : "Conditions may suit outside time",
      ...personalizedBody(
        outdoorFavorite,
        "Conditions look suitable for some outside time if that feels good today.",
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

export function weatherKindFor(weather: DayWeather): WeatherKind {
  return weatherKindFromCode(weather.weathercode);
}
