import { describe, expect, test, beforeEach } from "bun:test";
import {
  completedFooterPraise,
  peekPraiseEffectSession,
  resetPraiseEffectSession,
} from "./completedPraise";

describe("completedFooterPraise", () => {
  beforeEach(() => {
    resetPraiseEffectSession("withdrawal", { sinceReward: 0, nextAt: 3 });
    resetPraiseEffectSession("deposit", { sinceReward: 0, nextAt: 3 });
  });

  test("uses sentence-case encouragement without middot glue", () => {
    for (const n of [1, 2, 3, 5, 12]) {
      const line = completedFooterPraise(n);
      expect(line.lead).not.toContain("·");
      expect(line.accent).not.toContain("\u2014");
      expect(line.lead).toMatch(/\d/);
      expect(line.accent.length).toBeGreaterThan(0);
      expect(completedFooterPraise(n)).toEqual(line);
    }
  });

  test("singular and plural counts stay readable", () => {
    expect(completedFooterPraise(1).lead.startsWith("1 ")).toBe(true);
    expect(completedFooterPraise(2).lead.startsWith("2 ")).toBe(true);
    expect(completedFooterPraise(7).lead).toContain("7");
  });

  test("VR effect misses until threshold then awards", () => {
    const rng = () => 0;
    expect(
      completedFooterPraise(4, { side: "withdrawal", rollEffect: true, rng }).effect,
    ).toBe("none");
    expect(peekPraiseEffectSession("withdrawal").sinceReward).toBe(1);
    expect(
      completedFooterPraise(4, { side: "withdrawal", rollEffect: true, rng }).effect,
    ).toBe("none");
    const hit = completedFooterPraise(4, { side: "withdrawal", rollEffect: true, rng });
    expect(hit.effect).toBe("fire");
    expect(peekPraiseEffectSession("withdrawal").sinceReward).toBe(0);
  });

  test("deposit and withdrawal schedules do not steal each other's hits", () => {
    const rng = () => 0;
    resetPraiseEffectSession("withdrawal", { sinceReward: 0, nextAt: 1 });
    resetPraiseEffectSession("deposit", { sinceReward: 0, nextAt: 1 });
    expect(
      completedFooterPraise(2, { side: "withdrawal", rollEffect: true, rng }).effect,
    ).toBe("fire");
    // Deposit still at its own threshold of 1.
    expect(peekPraiseEffectSession("deposit")).toEqual({ sinceReward: 0, nextAt: 1 });
    expect(
      completedFooterPraise(2, { side: "deposit", rollEffect: true, rng }).effect,
    ).toBe("fire");
  });

  test("reduced motion never awards an effect", () => {
    resetPraiseEffectSession("withdrawal", { sinceReward: 0, nextAt: 1 });
    expect(
      completedFooterPraise(5, {
        side: "withdrawal",
        rollEffect: true,
        reducedMotion: true,
      }).effect,
    ).toBe("none");
    expect(peekPraiseEffectSession("withdrawal")).toEqual({ sinceReward: 0, nextAt: 1 });
  });

  test("without rollEffect, prior effect can be preserved", () => {
    const kept = completedFooterPraise(3, { effect: "rainbow" });
    expect(kept.effect).toBe("rainbow");
    expect(peekPraiseEffectSession("withdrawal").sinceReward).toBe(0);
  });
});
