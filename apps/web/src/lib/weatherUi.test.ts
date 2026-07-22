import { describe, expect, test } from "bun:test";
import { skyPeriod, sunTimesForUtcDay, weatherQuip } from "./weatherUi.ts";

describe("weatherQuip", () => {
  test("hot high-UV clear days get a heat-and-UV line", () => {
    const line = weatherQuip({
      kind: "sun",
      uvMax: 8,
      tempMax: 33,
      date: "2026-07-21",
    });
    expect(line.toLowerCase()).toMatch(/sunscreen|shade|uv|hot|sun|cover|water/);
  });

  test("same inputs are stable for a given date", () => {
    const a = weatherQuip({ kind: "rain", uvMax: 2, tempMax: 18, date: "2026-07-21" });
    const b = weatherQuip({ kind: "rain", uvMax: 2, tempMax: 18, date: "2026-07-21" });
    expect(a).toBe(b);
  });

  test("different dates can rotate the rain pool", () => {
    const lines = new Set(
      ["2026-07-21", "2026-07-22", "2026-07-23", "2026-07-24", "2026-07-25"].map((date) =>
        weatherQuip({ kind: "rain", uvMax: 1, tempMax: 16, date }),
      ),
    );
    expect(lines.size).toBeGreaterThan(1);
  });
});

describe("skyPeriod / sunTimes", () => {
  test("Tokyo morning (06:00 JST) is day, not night", () => {
    // 2026-07-20 21:00 UTC equals 2026-07-21 06:00 JST, while the UTC calendar day remains the 20th.
    const now = new Date("2026-07-20T21:00:00Z");
    expect(skyPeriod(35.68, 139.65, "Asia/Tokyo", now)).toBe("day");
  });

  test("Sydney morning (07:00 AEST) is daylight, not night", () => {
    const now = new Date("2026-07-20T21:00:00Z"); // 07:00 AEST Jul 21
    const period = skyPeriod(-33.87, 151.21, "Australia/Sydney", now);
    expect(period === "day" || period === "dawn").toBe(true);
  });

  test("San Francisco evening after sunset is night", () => {
    // Midsummer SF sunset ~20:30 PDT; 05:00 UTC Jul 21 = 22:00 PDT Jul 20.
    const now = new Date("2026-07-21T05:00:00Z");
    const period = skyPeriod(37.77, -122.42, "America/Los_Angeles", now);
    expect(period === "night" || period === "dusk").toBe(true);
  });

  test("logged-in coordinates do not override the local 20:00 night boundary", () => {
    // Solar golden hour can continue after 20:00 in summer, but the auth sky
    // already uses the user's local clock and both surfaces should agree.
    const now = new Date("2026-07-21T03:16:00Z"); // 20:16 PDT
    expect(skyPeriod(37.77, -122.42, "America/Los_Angeles", now)).toBe("night");
    expect(skyPeriod(null, null, "America/Los_Angeles", now)).toBe("night");
  });

  test("polar day returns alwaysUp", () => {
    // The sun never sets during Tromsø's midsummer.
    const midsummer = new Date("2026-06-21T12:00:00Z");
    const result = sunTimesForUtcDay(69.65, 18.96, midsummer);
    expect(result.kind).toBe("polar");
    if (result.kind === "polar") expect(result.alwaysUp).toBe(true);
    expect(skyPeriod(69.65, 18.96, "Europe/Oslo", midsummer)).toBe("day");
  });

  test("no location falls back to timezone hours", () => {
    const noon = new Date("2026-07-20T19:00:00Z"); // 12:00 PDT
    expect(skyPeriod(null, null, "America/Los_Angeles", noon)).toBe("day");
    const late = new Date("2026-07-21T05:00:00Z"); // 22:00 PDT
    expect(skyPeriod(null, null, "America/Los_Angeles", late)).toBe("night");
  });

  test("a US afternoon is day under the local zone but night under UTC", () => {
    // Regression: the live theme must pass the device zone. 20:00 UTC is 1pm
    // PDT (day) but reads as night when a UTC-defaulted profile leaks through.
    const onePmPacific = new Date("2026-07-21T20:00:00Z");
    expect(skyPeriod(null, null, "America/Los_Angeles", onePmPacific)).toBe("day");
    expect(skyPeriod(null, null, "UTC", onePmPacific)).toBe("night");
  });
});
