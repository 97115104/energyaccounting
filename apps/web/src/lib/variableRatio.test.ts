import { describe, expect, test } from "bun:test";
import {
  createVariableRatioSchedule,
  resetVariableRatioSchedule,
  rollVariableRatio,
} from "./variableRatio";

describe("variableRatio", () => {
  test("misses until threshold, then hits and redraws", () => {
    const schedule = createVariableRatioSchedule({
      minGap: 2,
      maxGap: 6,
      weights: [
        { value: "a", weight: 1 },
        { value: "b", weight: 0 },
      ],
      rng: () => 0, // nextAt → minGap (2); pick → a
    });
    resetVariableRatioSchedule(schedule, { sinceReward: 0, nextAt: 3 });

    expect(rollVariableRatio(schedule, { rng: () => 0 })).toBeNull();
    expect(schedule.sinceReward).toBe(1);
    expect(rollVariableRatio(schedule, { rng: () => 0 })).toBeNull();
    expect(rollVariableRatio(schedule, { rng: () => 0 })).toBe("a");
    expect(schedule.sinceReward).toBe(0);
    expect(schedule.nextAt).toBe(2);
  });

  test("skip never awards and does not advance", () => {
    const schedule = createVariableRatioSchedule({
      minGap: 1,
      maxGap: 1,
      weights: [{ value: "hit", weight: 1 }],
      rng: () => 0,
    });
    resetVariableRatioSchedule(schedule, { sinceReward: 0, nextAt: 1 });
    expect(rollVariableRatio(schedule, { skip: true })).toBeNull();
    expect(schedule.sinceReward).toBe(0);
    expect(schedule.nextAt).toBe(1);
  });

  test("weighted pick respects buckets", () => {
    const schedule = createVariableRatioSchedule({
      minGap: 1,
      maxGap: 1,
      weights: [
        { value: "fire", weight: 70 },
        { value: "rainbow", weight: 30 },
      ],
      rng: () => 0,
    });
    resetVariableRatioSchedule(schedule, { sinceReward: 0, nextAt: 1 });
    // After hit: drawThreshold then pick. rng 0.95 → rainbow bucket.
    let calls = 0;
    const rng = () => {
      calls += 1;
      if (calls === 1) return 0; // next threshold
      return 0.95; // pick rainbow
    };
    expect(rollVariableRatio(schedule, { rng })).toBe("rainbow");
  });
});
