import { describe, expect, test } from "bun:test";
import { AFFIRMATIONS, dailyAffirmation } from "./affirmations";

describe("affirmations", () => {
  test("pool holds over one hundred unique, non-empty lines", () => {
    expect(AFFIRMATIONS.length).toBeGreaterThan(100);
    expect(new Set(AFFIRMATIONS).size).toBe(AFFIRMATIONS.length);
    for (const line of AFFIRMATIONS) {
      expect(line.trim().length).toBeGreaterThan(0);
      // House style: no em dashes anywhere in user-facing copy.
      expect(line).not.toContain("\u2014");
    }
  });

  test("rotates deterministically by day", () => {
    // Local-time constructors keep the assertions valid in any timezone.
    const a = dailyAffirmation(new Date(2026, 6, 21, 9, 0));
    const sameDay = dailyAffirmation(new Date(2026, 6, 21, 22, 0));
    const nextDay = dailyAffirmation(new Date(2026, 6, 22, 9, 0));
    expect(sameDay).toBe(a);
    expect(nextDay).not.toBe(a);
    expect(AFFIRMATIONS).toContain(a);
  });
});
