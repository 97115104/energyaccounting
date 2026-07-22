import { describe, expect, test, beforeEach } from "bun:test";
import {
  peekCompletionDelightSession,
  resetCompletionDelightSession,
  rollCompletionDelight,
} from "./completionDelight";
import QUIPS from "../content/completion-quips.json";

describe("completionDelight", () => {
  beforeEach(() => {
    resetCompletionDelightSession({ completionsSinceReward: 0, nextRewardAt: 3 });
  });

  test("quip pools are non-empty and avoid em dashes", () => {
    for (const pool of [QUIPS.any, QUIPS.deposit, QUIPS.withdrawal]) {
      expect(pool.length).toBeGreaterThan(0);
      for (const line of pool) {
        expect(line.trim().length).toBeGreaterThan(0);
        expect(line).not.toContain("\u2014");
      }
    }
  });

  test("misses until the threshold, then hits and redraws", () => {
    const rng = () => 0; // threshold draw → MIN_GAP (2); tier → small
    expect(rollCompletionDelight("deposit", { rng })).toBeNull();
    expect(peekCompletionDelightSession().completionsSinceReward).toBe(1);
    expect(rollCompletionDelight("deposit", { rng })).toBeNull();
    const hit = rollCompletionDelight("deposit", { rng });
    expect(hit).not.toBeNull();
    expect(hit!.tier).toBe("small");
    expect(hit!.quip).toBeNull();
    expect(peekCompletionDelightSession().completionsSinceReward).toBe(0);
    expect(peekCompletionDelightSession().nextRewardAt).toBe(2);
  });

  test("reduced motion never rewards and does not advance the schedule", () => {
    resetCompletionDelightSession({ completionsSinceReward: 0, nextRewardAt: 1 });
    expect(rollCompletionDelight("withdrawal", { reducedMotion: true })).toBeNull();
    expect(peekCompletionDelightSession()).toEqual({
      completionsSinceReward: 0,
      nextRewardAt: 1,
    });
  });

  test("rare tier includes a quip from the combined pools", () => {
    // On hit: drawThreshold(rng), pickTier(rng), pickQuip(rng).
    let calls = 0;
    const rng = () => {
      calls += 1;
      if (calls === 1) return 0; // next threshold → MIN_GAP
      if (calls === 2) return 0.95; // pickTier → rare
      return 0; // quip index 0
    };
    resetCompletionDelightSession({ completionsSinceReward: 0, nextRewardAt: 1 });
    const hit = rollCompletionDelight("deposit", { rng });
    expect(hit?.tier).toBe("rare");
    expect(hit?.quip).toBeTruthy();
    const allowed = new Set([...QUIPS.any, ...QUIPS.deposit]);
    expect(allowed.has(hit!.quip!)).toBe(true);
  });
});
