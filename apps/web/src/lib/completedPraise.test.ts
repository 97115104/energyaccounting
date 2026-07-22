import { describe, expect, test } from "bun:test";
import { completedFooterPraise } from "./completedPraise";

describe("completedFooterPraise", () => {
  test("uses sentence-case encouragement without middot glue", () => {
    for (const n of [1, 2, 3, 5, 12]) {
      const line = completedFooterPraise(n);
      expect(line).not.toContain("·");
      expect(line).not.toContain("\u2014");
      expect(line).toMatch(/\d/);
      expect(line.endsWith("!") || line.includes("!")).toBe(true);
      // Stable within the visit for the same count.
      expect(completedFooterPraise(n)).toBe(line);
    }
  });

  test("singular and plural counts stay readable", () => {
    expect(completedFooterPraise(1).startsWith("1 ")).toBe(true);
    expect(completedFooterPraise(2).startsWith("2 ")).toBe(true);
    expect(completedFooterPraise(7)).toContain("7");
  });
});
