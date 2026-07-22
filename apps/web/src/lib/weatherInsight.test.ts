import { describe, expect, test } from "bun:test";
import {
  conditionsAt,
  dayAverageConditions,
  interpolateUv,
  parseDayWeather,
  uvBand,
  weatherDaySuggestion,
} from "./weatherInsight";

const favorites = [
  { side: "deposit" as const, label: "Read a favorite book", useCount: 9 },
  { side: "deposit" as const, label: "Walk by the river", useCount: 6 },
  { side: "withdrawal" as const, label: "Commute", useCount: 20 },
];

describe("weather insight", () => {
  test("narrows valid weather fields and rejects an empty payload", () => {
    expect(parseDayWeather({ source: "Open-Meteo" })).toBeNull();
    expect(
      parseDayWeather({
        weathercode: 0,
        tempMin: 18,
        tempMax: 30,
        uvMax: Number.NaN,
        source: "Open-Meteo",
      }),
    ).toEqual({
      weathercode: 0,
      tempMin: 18,
      tempMax: 30,
      precip: null,
      uvMax: null,
      sunrise: null,
      sunset: null,
      source: "Open-Meteo",
      timezone: null,
      minutely15: null,
      hourlyUv: null,
    });
  });

  test("uses standard UV index bands at their boundaries", () => {
    expect(uvBand(2.4).level).toBe("low");
    expect(uvBand(2.5).level).toBe("moderate");
    expect(uvBand(5.5).level).toBe("high");
    expect(uvBand(7.5).level).toBe("very-high");
    expect(uvBand(11).level).toBe("extreme");
  });

  test("suggests a familiar outdoor energy giver in favorable conditions", () => {
    const suggestion = weatherDaySuggestion({
      kind: "sun",
      uv: 2,
      precip: 0,
      isDaylight: true,
      favorites,
    });
    expect(suggestion.headline).toContain("Low UV");
    expect(suggestion.activity).toBe("Walk by the river");
    expect(suggestion.body).toContain("6×");
  });

  test("suggests a familiar indoor energy giver in rain or very high UV", () => {
    const rainy = weatherDaySuggestion({
      kind: "rain",
      uv: 1,
      precip: 8,
      isDaylight: true,
      favorites,
    });
    const sunny = weatherDaySuggestion({
      kind: "sun",
      uv: 9,
      precip: 0,
      isDaylight: true,
      favorites,
    });
    expect(rainy.activity).toBe("Read a favorite book");
    expect(sunny.activity).toBe("Read a favorite book");
  });

  test("does not expose withdrawal labels as favorite activities", () => {
    const suggestion = weatherDaySuggestion({
      kind: "rain",
      uv: null,
      precip: 4,
      isDaylight: true,
      favorites: [{ side: "withdrawal", label: "Read reports", useCount: 30 }],
    });
    expect(suggestion.activity).toBeUndefined();
    expect(suggestion.body).not.toContain("Read reports");
  });

  test("does not recommend outside when UV is unknown or daylight has ended", () => {
    const unknownUv = weatherDaySuggestion({
      kind: "sun",
      uv: null,
      precip: 0,
      isDaylight: true,
      favorites,
    });
    const evening = weatherDaySuggestion({
      kind: "sun",
      uv: 1,
      precip: 0,
      isDaylight: false,
      favorites,
    });
    expect(unknownUv.activity).toBe("Read a favorite book");
    expect(unknownUv.headline).toBe("Keep the day flexible");
    expect(evening.headline).toContain("evening");
  });

  test("treats snow and thunderstorms as indoor conditions", () => {
    for (const kind of ["snow", "thunder"] as const) {
      const suggestion = weatherDaySuggestion({
        kind,
        uv: 1,
        precip: 0,
        isDaylight: true,
        favorites,
      });
      expect(suggestion.activity).toBe("Read a favorite book");
    }
  });

  test("keeps high and very high UV guidance distinct", () => {
    const high = weatherDaySuggestion({
      kind: "sun",
      uv: 6,
      precip: 0,
      isDaylight: true,
      favorites,
    });
    const veryHigh = weatherDaySuggestion({
      kind: "sun",
      uv: 8,
      precip: 0,
      isDaylight: true,
      favorites,
    });
    expect(high.headline).toBe("Plan around the sun");
    expect(veryHigh.headline).toBe("Very strong sun right now");
  });

  test("uses the condition code rather than a small daily total to call a day rainy", () => {
    const suggestion = weatherDaySuggestion({
      kind: "cloud",
      uv: 2,
      precip: 1,
      isDaylight: true,
      favorites,
    });
    expect(suggestion.activity).toBe("Walk by the river");
  });
});

describe("conditionsAt / interpolateUv", () => {
  const baseWeather = {
    weathercode: 0,
    tempMax: 28,
    tempMin: 16,
    precip: 0,
    uvMax: 8,
    sunrise: "2026-07-21T06:00",
    sunset: "2026-07-21T20:00",
    source: "Open-Meteo",
    timezone: "America/Los_Angeles",
    minutely15: {
      time: ["2026-07-21T10:00", "2026-07-21T10:15", "2026-07-21T12:00", "2026-07-21T18:00"],
      weathercode: [61, 61, 0, 0],
      temp: [18, 18, 27, 22],
      precip: [0.4, 0.2, 0, 0],
    },
    hourlyUv: {
      time: ["2026-07-21T12:00", "2026-07-21T13:00"],
      uv: [8, 4],
    },
  };

  test("flips kind when the 15-min bucket clears", () => {
    const rainy = conditionsAt(baseWeather, {
      now: new Date("2026-07-21T17:10:00Z"), // 10:10 PDT
      timeZone: "America/Los_Angeles",
      lat: 37.77,
      lon: -122.42,
    });
    const clear = conditionsAt(baseWeather, {
      now: new Date("2026-07-21T19:05:00Z"), // 12:05 PDT
      timeZone: "America/Los_Angeles",
      lat: 37.77,
      lon: -122.42,
    });
    expect(rainy.kind).toBe("rain");
    expect(clear.kind).toBe("sun");
  });

  test("interpolates UV between hourly points", () => {
    expect(interpolateUv(baseWeather.hourlyUv, "2026-07-21T12:00")).toBe(8);
    expect(interpolateUv(baseWeather.hourlyUv, "2026-07-21T12:30")).toBe(6);
    expect(interpolateUv(baseWeather.hourlyUv, "2026-07-21T13:00")).toBe(4);
  });

  test("indexes series in the forecast timezone, not the device timezone", () => {
    // 19:00 UTC = 12:00 PDT / 20:00 London. Series keys are Pacific.
    const now = new Date("2026-07-21T19:00:00Z");
    const pacific = conditionsAt(baseWeather, {
      now,
      timeZone: "Europe/London",
      lat: 37.77,
      lon: -122.42,
    });
    expect(pacific.kind).toBe("sun");
    expect(pacific.bucket).toBe("2026-07-21T12:00");
  });

  test("keeps an overnight open day from using yesterday's night bucket", () => {
    // Series is only for 2026-07-21; "now" is the next afternoon.
    const nextAfternoon = conditionsAt(baseWeather, {
      now: new Date("2026-07-22T20:00:00Z"), // 13:00 PDT Jul 22
      timeZone: "America/Los_Angeles",
      lat: 37.77,
      lon: -122.42,
    });
    // Must not snap to 2026-07-21T23:45 (UV 0 / evening temp).
    expect(nextAfternoon.bucket).toBeNull();
    expect(nextAfternoon.temp).toBe(28); // daily max fallback
    expect(nextAfternoon.uv).toBe(8); // daily uvMax while sky is day
  });

  test("without hourly UV, dawn does not inherit the daily max", () => {
    const dawn = conditionsAt(
      { ...baseWeather, hourlyUv: null, minutely15: null },
      {
        now: new Date("2026-07-21T13:10:00Z"), // ~06:10 PDT near sunrise
        timeZone: "America/Los_Angeles",
        lat: 37.77,
        lon: -122.42,
      },
    );
    if (dawn.sky === "dawn" || dawn.sky === "dusk" || dawn.sky === "night") {
      expect(dawn.uv).toBe(0);
    }
  });

  test("late-day UV drop unlocks outdoor-friendly suggestion", () => {
    const midday = conditionsAt(baseWeather, {
      now: new Date("2026-07-21T19:00:00Z"), // 12:00 PDT
      timeZone: "America/Los_Angeles",
      lat: 37.77,
      lon: -122.42,
    });
    const later = conditionsAt(
      {
        ...baseWeather,
        hourlyUv: { time: ["2026-07-21T12:00", "2026-07-21T18:00"], uv: [8, 2] },
      },
      {
        now: new Date("2026-07-22T01:00:00Z"), // 18:00 PDT
        timeZone: "America/Los_Angeles",
        lat: 37.77,
        lon: -122.42,
      },
    );
    expect(midday.uv!).toBeGreaterThanOrEqual(6);
    expect(later.uv!).toBeLessThanOrEqual(3);
    const middayTip = weatherDaySuggestion({
      kind: midday.kind,
      uv: midday.uv,
      precip: midday.precip,
      isDaylight: midday.isDaylight,
      favorites,
    });
    const laterTip = weatherDaySuggestion({
      kind: later.kind,
      uv: later.uv,
      precip: later.precip,
      isDaylight: later.isDaylight,
      favorites,
    });
    expect(middayTip.activity).toBe("Read a favorite book");
    expect(laterTip.activity).toBe("Walk by the river");
  });
});

describe("dayAverageConditions", () => {
  test("averages temp and daytime UV for a closed day summary", () => {
    const avg = dayAverageConditions({
      weathercode: 0,
      tempMax: 30,
      tempMin: 20,
      precip: 0,
      uvMax: 8,
      sunrise: null,
      sunset: null,
      source: "Open-Meteo",
      timezone: "America/Los_Angeles",
      minutely15: {
        time: ["2026-07-21T10:00", "2026-07-21T14:00"],
        weathercode: [0, 0],
        temp: [22, 28],
        precip: [0, 0],
      },
      hourlyUv: {
        time: ["2026-07-21T00:00", "2026-07-21T12:00", "2026-07-21T13:00"],
        uv: [0, 8, 4],
      },
    });
    expect(avg.temp).toBe(25);
    expect(avg.uv).toBe(6);
    expect(avg.uvMax).toBe(8);
    expect(avg.slot).toBe("afternoon");
  });

  test("falls back to high/low mid-point and uvMax without series", () => {
    const avg = dayAverageConditions({
      weathercode: 3,
      tempMax: 30,
      tempMin: 20,
      precip: 1,
      uvMax: 5,
      sunrise: null,
      sunset: null,
      source: null,
      timezone: null,
      minutely15: null,
      hourlyUv: null,
    });
    expect(avg.temp).toBe(25);
    expect(avg.uv).toBe(5);
    expect(avg.kind).toBe("cloud");
  });
});
