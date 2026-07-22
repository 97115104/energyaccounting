import { describe, expect, test } from "bun:test";
import { skyLuminance, skyPalette } from "./skyPalette.ts";
import { skyPeriod, sunTimesForUtcDay } from "./weatherUi.ts";

describe("skyPalette", () => {
  test("noon is lighter than late afternoon without coords", () => {
    // Fixed 6–20 fallback: noon at 12:00, late afternoon ~70% → ~15:48.
    const noon = new Date("2026-07-20T19:00:00Z"); // 12:00 PDT
    const late = new Date("2026-07-20T22:48:00Z"); // 15:48 PDT
    const noonPal = skyPalette(null, null, "America/Los_Angeles", noon);
    const latePal = skyPalette(null, null, "America/Los_Angeles", late);
    expect(noonPal.period).toBe("day");
    expect(latePal.period).toBe("day");
    expect(skyLuminance(noonPal.bg0)).toBeGreaterThan(skyLuminance(latePal.bg0) + 3);
  });

  test("noon is lighter than late afternoon with coords", () => {
    const lat = 37.77;
    const lon = -122.42;
    const day = new Date("2026-07-20T12:00:00Z");
    const times = sunTimesForUtcDay(lat, lon, day);
    expect(times.kind).toBe("times");
    if (times.kind !== "times") return;
    const span = times.sunset.getTime() - times.sunrise.getTime();
    const noon = new Date(times.sunrise.getTime() + span * 0.5);
    const late = new Date(times.sunrise.getTime() + span * 0.7);
    const noonPal = skyPalette(lat, lon, "America/Los_Angeles", noon);
    const latePal = skyPalette(lat, lon, "America/Los_Angeles", late);
    expect(noonPal.period).toBe("day");
    expect(latePal.period).toBe("day");
    expect(skyLuminance(noonPal.bg0)).toBeGreaterThan(skyLuminance(latePal.bg0) + 3);
  });

  test("near sunrise leans warmer/orange vs noon", () => {
    const lat = 37.77;
    const lon = -122.42;
    const day = new Date("2026-07-20T12:00:00Z");
    const times = sunTimesForUtcDay(lat, lon, day);
    expect(times.kind).toBe("times");
    if (times.kind !== "times") return;

    const atRise = skyPalette(lat, lon, "America/Los_Angeles", times.sunrise);
    const noonMs =
      times.sunrise.getTime() + (times.sunset.getTime() - times.sunrise.getTime()) / 2;
    const atNoon = skyPalette(lat, lon, "America/Los_Angeles", new Date(noonMs));

    expect(atRise.period === "dawn" || atRise.period === "day").toBe(true);
    expect(atNoon.period).toBe("day");
    expect(atRise.bg0).not.toBe(atNoon.bg0);
    expect(skyLuminance(atNoon.bg0)).toBeGreaterThan(skyLuminance(atRise.bg0));
  });

  test("dawn shoulder stays readable with day ink (not night navy)", () => {
    const lat = -33.87;
    const lon = 151.21;
    const day = new Date("2026-07-20T12:00:00Z");
    const times = sunTimesForUtcDay(lat, lon, day);
    expect(times.kind).toBe("times");
    if (times.kind !== "times") return;
    const predawn = new Date(times.sunrise.getTime() - 40 * 60_000);
    const pal = skyPalette(lat, lon, "Australia/Sydney", predawn);
    expect(pal.period).toBe("dawn");
    // Must not be the night navy while chrome is still day-themed.
    expect(pal.bg0).not.toBe("#12182e");
    expect(skyLuminance(pal.bg0)).toBeGreaterThan(100);
  });

  test("near sunset leans toward dusk rose vs noon", () => {
    const lat = 37.77;
    const lon = -122.42;
    // Winter sunset is before the 20:00 night floor, so dusk colors are visible.
    const day = new Date("2026-01-15T12:00:00Z");
    const times = sunTimesForUtcDay(lat, lon, day);
    expect(times.kind).toBe("times");
    if (times.kind !== "times") return;

    const noonMs =
      times.sunrise.getTime() + (times.sunset.getTime() - times.sunrise.getTime()) / 2;
    const atNoon = skyPalette(lat, lon, "America/Los_Angeles", new Date(noonMs));
    const atSet = skyPalette(lat, lon, "America/Los_Angeles", times.sunset);

    expect(atSet.period).toBe("dusk");
    expect(skyLuminance(atNoon.bg0)).toBeGreaterThan(skyLuminance(atSet.bg0));
    expect(atSet.bg1.toLowerCase()).not.toBe(atNoon.bg1.toLowerCase());
  });

  test("night palette after the 20:00 local floor", () => {
    const now = new Date("2026-07-21T03:16:00Z"); // 20:16 PDT
    const withCoords = skyPalette(37.77, -122.42, "America/Los_Angeles", now);
    const noCoords = skyPalette(null, null, "America/Los_Angeles", now);
    expect(withCoords.period).toBe("night");
    expect(noCoords.period).toBe("night");
    expect(withCoords.bg0).toBe("#12182e");
    expect(noCoords.bg0).toBe("#12182e");
    expect(withCoords.panel).toBe("#1c2240");
    expect(withCoords.ink).toBe("#e8e4f8");
  });

  test("noon panels stay cream; dusk panels darken toward night", () => {
    const lat = 37.77;
    const lon = -122.42;
    const day = new Date("2026-01-15T12:00:00Z");
    const times = sunTimesForUtcDay(lat, lon, day);
    expect(times.kind).toBe("times");
    if (times.kind !== "times") return;

    const noonMs =
      times.sunrise.getTime() + (times.sunset.getTime() - times.sunrise.getTime()) / 2;
    const atNoon = skyPalette(lat, lon, "America/Los_Angeles", new Date(noonMs));
    const atSet = skyPalette(lat, lon, "America/Los_Angeles", times.sunset);
    const deep = skyPalette(
      lat,
      lon,
      "America/Los_Angeles",
      new Date(times.sunset.getTime() + 35 * 60_000),
    );

    expect(atNoon.panel.toLowerCase()).toBe("#fffdf3");
    expect(atNoon.surface.toLowerCase()).toBe("#fffef8");
    expect(skyLuminance(atNoon.panel)).toBeGreaterThan(skyLuminance(atSet.panel));
    expect(skyLuminance(atSet.panel)).toBeGreaterThan(skyLuminance(deep.panel));
    expect(skyLuminance(atNoon.surface)).toBeGreaterThan(skyLuminance(deep.surface));
    // Dusk-deep is closer to night navy than to noon cream.
    expect(skyLuminance(deep.panel)).toBeLessThan(120);
    expect(skyLuminance(deep.ink)).toBeGreaterThan(skyLuminance(atNoon.ink));
  });

  test("night surface matches nested-card night token", () => {
    const now = new Date("2026-07-21T03:16:00Z"); // 20:16 PDT
    const pal = skyPalette(null, null, "America/Los_Angeles", now);
    expect(pal.surface).toBe("#0e1428");
  });

  test("dawn predawn panel is not night navy; ink stays readable", () => {
    const lat = -33.87;
    const lon = 151.21;
    const day = new Date("2026-07-20T12:00:00Z");
    const times = sunTimesForUtcDay(lat, lon, day);
    expect(times.kind).toBe("times");
    if (times.kind !== "times") return;
    const predawn = new Date(times.sunrise.getTime() - 40 * 60_000);
    const pal = skyPalette(lat, lon, "Australia/Sydney", predawn);
    expect(pal.period).toBe("dawn");
    expect(pal.panel).not.toBe("#1c2240");
    expect(skyLuminance(pal.panel)).toBeGreaterThan(skyLuminance(pal.ink) + 80);
  });

  test("polar day stays on the bright day palette", () => {
    const midsummer = new Date("2026-06-21T12:00:00Z");
    const pal = skyPalette(69.65, 18.96, "Europe/Oslo", midsummer);
    expect(pal.period).toBe("day");
    expect(pal.bg0).toBe("#fff6c8");
    expect(pal.panel).toBe("#fffdf3");
  });
});

describe("skyPeriod polar / morning edges", () => {
  test("a polar neighbor does not force day after local sunset", () => {
    // Tromsø 2026-05-18 after civil dusk: May 19 is polar-up, but tonight is night.
    const afterDusk = new Date("2026-05-18T23:00:00Z");
    expect(skyPeriod(69.65, 18.96, "Europe/Oslo", afterDusk)).toBe("night");
    expect(skyPeriod(69.65, 18.96, "Europe/Oslo", afterDusk)).not.toBe("day");
  });

  test("a polar-night neighbor does not force night over brief daylight", () => {
    const lat = 69.75;
    const lon = 19.0;
    // Find a January noon that has civil times while a neighbor may be polar.
    const noon = new Date("2026-01-17T12:00:00Z");
    const period = skyPeriod(lat, lon, "Europe/Oslo", noon);
    const times = sunTimesForUtcDay(lat, lon, noon);
    if (times.kind === "times") {
      const t = noon.getTime();
      if (t > times.sunrise.getTime() && t < times.sunset.getTime()) {
        expect(period).toBe("day");
      }
    }
  });

  test("pre-6:00 with the sun already up is dawn/day, not night", () => {
    // London midsummer sunrise ~03:42 UTC (hour 4 BST).
    const times = sunTimesForUtcDay(51.5, -0.12, new Date("2026-06-21T12:00:00Z"));
    expect(times.kind).toBe("times");
    if (times.kind !== "times") return;
    const afterRise = new Date(times.sunrise.getTime() + 30 * 60_000);
    const period = skyPeriod(51.5, -0.12, "Europe/London", afterRise);
    expect(period === "dawn" || period === "day").toBe(true);
  });
});
