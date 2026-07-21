import { describe, expect, test } from "bun:test";
import { recentDisabledReason, repeatActionVisible } from "./planShortcuts";

function day(overrides: Partial<Parameters<typeof repeatActionVisible>[0] & object> = {}) {
  return { phase: "plan", lines: [], repeatAvailable: true, ...overrides };
}

describe("repeatActionVisible", () => {
  test("shows only on an empty planning day with a previous plan", () => {
    expect(repeatActionVisible(day(), false)).toBe(true);
  });

  test("hides on history deep-links even when otherwise eligible", () => {
    expect(repeatActionVisible(day(), true)).toBe(false);
  });

  test("hides without a day, outside plan phase, or with lines", () => {
    expect(repeatActionVisible(null, false)).toBe(false);
    expect(repeatActionVisible(day({ phase: "audit" }), false)).toBe(false);
    expect(repeatActionVisible(day({ lines: [{}] }), false)).toBe(false);
  });

  test("hides when the server reports no previous plan or omits the field", () => {
    expect(repeatActionVisible(day({ repeatAvailable: false }), false)).toBe(false);
    expect(repeatActionVisible(day({ repeatAvailable: undefined }), false)).toBe(false);
  });
});

describe("recentDisabledReason", () => {
  test("allows choices that fit available capacity", () => {
    expect(recentDisabledReason(20, 20, "plan")).toBeNull();
    expect(recentDisabledReason(5, 40, "audit")).toBeNull();
  });

  test("explains over-capacity choices on a live day", () => {
    expect(recentDisabledReason(30, 10, "plan")).toBe(
      "Needs 30 points, only 10 available",
    );
  });

  test("never blocks closed-day amendments", () => {
    expect(recentDisabledReason(90, 0, "closed")).toBeNull();
  });
});
