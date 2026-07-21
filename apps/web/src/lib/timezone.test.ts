import { describe, expect, test } from "bun:test";
import {
  deviceTimezone,
  hourInTimezone,
  isNightInTimezone,
  liveTimezone,
} from "./timezone";

describe("liveTimezone", () => {
  test("prefers the device zone over any profile zone", () => {
    const device = deviceTimezone();
    // Bun always resolves a runtime zone; the profile value must not win.
    expect(device).toBeDefined();
    expect(liveTimezone("UTC")).toBe(device!);
    expect(liveTimezone(null)).toBe(device!);
    // A profile zone guaranteed to differ from the runner's device zone, so
    // this stays meaningful on CI runners that happen to run in UTC.
    const other = device === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo";
    expect(liveTimezone(other)).toBe(device!);
  });
});

describe("hourInTimezone", () => {
  const instant = new Date("2026-07-21T21:50:00Z");

  test("a UTC evening reads as Pacific afternoon", () => {
    expect(hourInTimezone(instant, "America/Los_Angeles")).toBe(14);
    expect(hourInTimezone(instant, "UTC")).toBe(21);
  });

  test("invalid or missing zone falls back to device local hours", () => {
    expect(hourInTimezone(instant, "Not/AZone")).toBe(instant.getHours());
    expect(hourInTimezone(instant, null)).toBe(instant.getHours());
  });

  test("midnight normalizes to 0", () => {
    expect(hourInTimezone(new Date("2026-07-21T00:30:00Z"), "UTC")).toBe(0);
  });
});

describe("isNightInTimezone", () => {
  test("night is before 6:00 and from 20:00", () => {
    expect(isNightInTimezone("UTC", new Date("2026-07-21T05:59:00Z"))).toBe(true);
    expect(isNightInTimezone("UTC", new Date("2026-07-21T06:00:00Z"))).toBe(false);
    expect(isNightInTimezone("UTC", new Date("2026-07-21T19:59:00Z"))).toBe(false);
    expect(isNightInTimezone("UTC", new Date("2026-07-21T20:00:00Z"))).toBe(true);
  });

  test("respects the zone, not the instant's UTC hour", () => {
    // 21:50 UTC is 14:50 in Los Angeles: daytime there, night in London.
    const instant = new Date("2026-07-21T21:50:00Z");
    expect(isNightInTimezone("America/Los_Angeles", instant)).toBe(false);
    expect(isNightInTimezone("Europe/London", instant)).toBe(true);
  });
});
