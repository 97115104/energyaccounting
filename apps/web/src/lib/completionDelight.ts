/**
 * Variable-ratio completion delight: most checks get only the quiet exit;
 * intermittent CSS bursts keep the habit sticky without spam.
 */

import QUIPS_JSON from "../content/completion-quips.json";
import {
  createVariableRatioSchedule,
  resetVariableRatioSchedule,
  rollVariableRatio,
  type VariableRatioSchedule,
} from "./variableRatio";

export type DelightTier = "small" | "medium" | "rare";
export type DelightSide = "deposit" | "withdrawal";

export type DelightHit = {
  tier: DelightTier;
  quip: string | null;
};

type QuipPools = {
  any: string[];
  deposit: string[];
  withdrawal: string[];
};

const QUIPS = QUIPS_JSON as QuipPools;

const schedule: VariableRatioSchedule<DelightTier> = createVariableRatioSchedule({
  minGap: 2,
  maxGap: 6,
  weights: [
    { value: "small", weight: 70 },
    { value: "medium", weight: 22 },
    { value: "rare", weight: 8 },
  ],
});

function pickQuip(side: DelightSide, rng: () => number): string {
  const pool = [...QUIPS.any, ...QUIPS[side]];
  if (!pool.length) return "Nice.";
  return pool[Math.floor(rng() * pool.length)]!;
}

/** Test/reset hook so unit tests don't leak session state. */
export function resetCompletionDelightSession(opts?: {
  completionsSinceReward?: number;
  nextRewardAt?: number;
}): void {
  resetVariableRatioSchedule(schedule, {
    sinceReward: opts?.completionsSinceReward ?? 0,
    nextAt: opts?.nextRewardAt ?? 2,
  });
}

export function peekCompletionDelightSession(): {
  completionsSinceReward: number;
  nextRewardAt: number;
} {
  return {
    completionsSinceReward: schedule.sinceReward,
    nextRewardAt: schedule.nextAt,
  };
}

/**
 * Record one successful completion. Returns a hit on the VR schedule, else null.
 * Inject `rng` for deterministic tests. When `reducedMotion` is true, never hit.
 */
export function rollCompletionDelight(
  side: DelightSide,
  opts?: { rng?: () => number; reducedMotion?: boolean },
): DelightHit | null {
  const rng = opts?.rng ?? Math.random;
  const tier = rollVariableRatio(schedule, {
    rng,
    skip: opts?.reducedMotion,
  });
  if (!tier) return null;
  return {
    tier,
    quip: tier === "rare" ? pickQuip(side, rng) : null,
  };
}

export const COMPLETION_EXIT_MS = 320;
