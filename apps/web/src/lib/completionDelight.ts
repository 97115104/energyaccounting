/**
 * Variable-ratio completion delight: most checks get only the quiet exit;
 * intermittent CSS bursts keep the habit sticky without spam.
 */

import QUIPS_JSON from "../content/completion-quips.json";

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

const MIN_GAP = 2;
const MAX_GAP = 6;

/** Tier weights when a reward fires. Quiet misses are the gap, not a tier. */
const TIER_WEIGHTS: { tier: DelightTier; weight: number }[] = [
  { tier: "small", weight: 70 },
  { tier: "medium", weight: 22 },
  { tier: "rare", weight: 8 },
];

function drawThreshold(rng: () => number = Math.random): number {
  return MIN_GAP + Math.floor(rng() * (MAX_GAP - MIN_GAP + 1));
}

/** Session state for the VR schedule (module-scoped; resets on full reload). */
let completionsSinceReward = 0;
/** Next completion count (inclusive) that earns a burst. Drawn in [minGap, maxGap]. */
let nextRewardAt = drawThreshold();

function pickTier(rng: () => number): DelightTier {
  const total = TIER_WEIGHTS.reduce((s, t) => s + t.weight, 0);
  let roll = rng() * total;
  for (const entry of TIER_WEIGHTS) {
    roll -= entry.weight;
    if (roll < 0) return entry.tier;
  }
  return "small";
}

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
  completionsSinceReward = opts?.completionsSinceReward ?? 0;
  nextRewardAt = opts?.nextRewardAt ?? drawThreshold(() => 0);
}

export function peekCompletionDelightSession(): {
  completionsSinceReward: number;
  nextRewardAt: number;
} {
  return { completionsSinceReward, nextRewardAt };
}

/**
 * Record one successful completion. Returns a hit on the VR schedule, else null.
 * Inject `rng` for deterministic tests. When `reducedMotion` is true, never hit.
 */
export function rollCompletionDelight(
  side: DelightSide,
  opts?: { rng?: () => number; reducedMotion?: boolean },
): DelightHit | null {
  if (opts?.reducedMotion) return null;
  const rng = opts?.rng ?? Math.random;

  completionsSinceReward += 1;
  if (completionsSinceReward < nextRewardAt) return null;

  completionsSinceReward = 0;
  nextRewardAt = drawThreshold(rng);

  const tier = pickTier(rng);
  return {
    tier,
    quip: tier === "rare" ? pickQuip(side, rng) : null,
  };
}

export const COMPLETION_EXIT_MS = 320;
