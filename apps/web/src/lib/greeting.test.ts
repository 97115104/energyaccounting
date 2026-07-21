import { describe, expect, test } from "bun:test";
import { greetingDetailFor } from "./greeting";

describe("greetingDetailFor", () => {
  test("facts always ship a verifiable https source link", () => {
    const detail = greetingDetailFor("Sam", { style: "facts" });
    expect(detail.text.length).toBeGreaterThan(0);
    expect(detail.factSource).toBeDefined();
    expect(detail.factSource!.label.length).toBeGreaterThan(0);
    expect(detail.factSource!.url.startsWith("https://")).toBe(true);
  });

  test("non-fact styles carry no source link", () => {
    const detail = greetingDetailFor("Sam", {
      style: "classic",
      now: new Date("2026-07-20T15:00:00Z"),
    });
    expect(detail.factSource).toBeUndefined();
  });

  // Regression: a UTC-evening instant is still afternoon in Los Angeles, so
  // the classic greeting must not say evening for a Pacific user at 2:50 PM.
  test("classic slot follows the hour in the given timezone", () => {
    const pacificAfternoon = new Date("2026-07-21T21:50:00Z"); // 14:50 PDT
    const detail = greetingDetailFor("Sam", {
      style: "classic",
      now: pacificAfternoon,
      timeZone: "America/Los_Angeles",
    });
    expect(detail.text.toLowerCase()).not.toContain("evening");

    const utcDetail = greetingDetailFor("Sam", {
      style: "classic",
      now: pacificAfternoon,
      timeZone: "UTC",
    });
    // Same instant read as UTC lands in the evening pool.
    const evening = ["evening", "audit the day"];
    expect(evening.some((w) => utcDetail.text.toLowerCase().includes(w))).toBe(true);
  });

  test("slot is not frozen across calls at different hours", () => {
    const morning = greetingDetailFor("Sam", {
      style: "classic",
      now: new Date("2026-07-21T09:00:00Z"),
      timeZone: "UTC",
    });
    const night = greetingDetailFor("Sam", {
      style: "classic",
      now: new Date("2026-07-21T23:30:00Z"),
      timeZone: "UTC",
    });
    expect(morning.text).not.toBe(night.text);
  });
});
