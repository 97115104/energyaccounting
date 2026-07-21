import { describe, expect, test } from "bun:test";
import { parseDayWeather, uvBand, weatherDaySuggestion } from "./weatherInsight";

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
      uvMax: 2,
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
      uvMax: 1,
      precip: 8,
      isDaylight: true,
      favorites,
    });
    const sunny = weatherDaySuggestion({
      kind: "sun",
      uvMax: 9,
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
      uvMax: null,
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
      uvMax: null,
      precip: 0,
      isDaylight: true,
      favorites,
    });
    const evening = weatherDaySuggestion({
      kind: "sun",
      uvMax: 1,
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
        uvMax: 1,
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
      uvMax: 6,
      precip: 0,
      isDaylight: true,
      favorites,
    });
    const veryHigh = weatherDaySuggestion({
      kind: "sun",
      uvMax: 8,
      precip: 0,
      isDaylight: true,
      favorites,
    });
    expect(high.headline).toBe("Plan around the sun");
    expect(veryHigh.headline).toBe("Very strong sun today");
  });

  test("uses the condition code rather than a small daily total to call a day rainy", () => {
    const suggestion = weatherDaySuggestion({
      kind: "cloud",
      uvMax: 2,
      precip: 1,
      isDaylight: true,
      favorites,
    });
    expect(suggestion.activity).toBe("Walk by the river");
  });
});
