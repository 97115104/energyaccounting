import { describe, expect, test } from "bun:test";
import {
  effectiveBeatMs,
  resolveButterflyState,
  type ButterflyStateInput,
} from "./butterflyState";

function input(overrides: Partial<ButterflyStateInput> = {}): ButterflyStateInput {
  return {
    available: 100,
    opening: 100,
    depositTotal: 0,
    withdrawalTotal: 0,
    incompleteWithdrawals: 0,
    completedCount: 0,
    withdrawalHeavy: false,
    feelRating: null,
    phase: "plan",
    ...overrides,
  };
}

describe("resolveButterflyState", () => {
  test("fresh day rests", () => {
    const s = resolveButterflyState(input());
    expect(s.id).toBe("resting");
    expect(s.vitality).toBe(1);
    expect(s.because.length).toBeGreaterThan(0);
  });

  test("no open day rests with its own explanation", () => {
    const s = resolveButterflyState(input({ phase: null }));
    expect(s.id).toBe("resting");
    expect(s.because[0]).toContain("No energy day");
  });

  test("nearly drained day is spent regardless of anything else", () => {
    const s = resolveButterflyState(
      input({ available: 10, depositTotal: 40, completedCount: 5 }),
    );
    expect(s.id).toBe("spent");
  });

  test("withdrawal-heavy day recovers", () => {
    const s = resolveButterflyState(
      input({ withdrawalHeavy: true, withdrawalTotal: 60, depositTotal: 10, available: 40 }),
    );
    expect(s.id).toBe("recovering");
    expect(s.because.join(" ")).toContain("60");
  });

  test("low feel rating reads as recovering", () => {
    const s = resolveButterflyState(input({ feelRating: 3, available: 60 }));
    expect(s.id).toBe("recovering");
  });

  test("energy added makes it lively", () => {
    const s = resolveButterflyState(input({ depositTotal: 25, available: 80 }));
    expect(s.id).toBe("lively");
  });

  test("completions make it lively", () => {
    const s = resolveButterflyState(input({ completedCount: 3, available: 70 }));
    expect(s.id).toBe("lively");
  });

  test("some activity but no strong signal is steady", () => {
    const s = resolveButterflyState(
      input({ depositTotal: 10, withdrawalTotal: 12, available: 78 }),
    );
    expect(s.id).toBe("steady");
  });

  test("lively beats faster than recovering", () => {
    const lively = resolveButterflyState(input({ depositTotal: 25, available: 80 }));
    const recovering = resolveButterflyState(input({ feelRating: 2, available: 60 }));
    expect(lively.beatMs).toBeLessThan(recovering.beatMs);
  });

  test("deterministic for identical input", () => {
    const a = resolveButterflyState(input({ depositTotal: 25 }));
    const b = resolveButterflyState(input({ depositTotal: 25 }));
    expect(a).toEqual(b);
  });
});

describe("effectiveBeatMs", () => {
  const lively = resolveButterflyState(input({ depositTotal: 25, available: 80 }));

  test("auto follows the state", () => {
    expect(effectiveBeatMs(lively, "auto", false)).toBe(lively.beatMs);
  });

  test("calm slows the beat by half", () => {
    expect(effectiveBeatMs(lively, "calm", false)).toBe(Math.round(lively.beatMs * 1.5));
  });

  test("still and reduced motion both stop animation", () => {
    expect(effectiveBeatMs(lively, "still", false)).toBeNull();
    expect(effectiveBeatMs(lively, "auto", true)).toBeNull();
    expect(effectiveBeatMs(lively, "calm", true)).toBeNull();
  });
});
