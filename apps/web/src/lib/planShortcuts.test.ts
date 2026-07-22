import { describe, expect, test } from "bun:test";
import { recentDisabledReason } from "./planShortcuts";

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
