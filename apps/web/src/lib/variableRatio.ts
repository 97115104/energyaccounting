/**
 * Tiny variable-ratio reward scheduler: most rolls miss; intermittent hits
 * pick a weighted outcome. One schedule instance per reward stream so
 * completion bursts, praise accents, and future badges do not steal hits.
 */

export type Weighted<T extends string> = { value: T; weight: number };

export type VariableRatioSchedule<T extends string> = {
  sinceReward: number;
  /** Inclusive completion count that awards the next hit. */
  nextAt: number;
  minGap: number;
  maxGap: number;
  weights: Weighted<T>[];
};

function drawThreshold(
  minGap: number,
  maxGap: number,
  rng: () => number,
): number {
  return minGap + Math.floor(rng() * (maxGap - minGap + 1));
}

function pickWeighted<T extends string>(
  weights: Weighted<T>[],
  rng: () => number,
): T {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  let roll = rng() * total;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return weights[weights.length - 1]!.value;
}

export function createVariableRatioSchedule<T extends string>(opts: {
  minGap: number;
  maxGap: number;
  weights: Weighted<T>[];
  rng?: () => number;
}): VariableRatioSchedule<T> {
  if (opts.minGap < 1 || opts.maxGap < opts.minGap) {
    throw new Error("variableRatio: invalid gap range");
  }
  if (!opts.weights.length) {
    throw new Error("variableRatio: weights required");
  }
  const rng = opts.rng ?? Math.random;
  return {
    sinceReward: 0,
    nextAt: drawThreshold(opts.minGap, opts.maxGap, rng),
    minGap: opts.minGap,
    maxGap: opts.maxGap,
    weights: opts.weights,
  };
}

/**
 * Record one trial. Returns null on miss; on hit returns the weighted value
 * and resets the counter. `skip: true` (e.g. reduced motion) never awards and
 * does not advance, so enabling motion later cannot dump a stored jackpot.
 */
export function rollVariableRatio<T extends string>(
  schedule: VariableRatioSchedule<T>,
  opts?: { rng?: () => number; skip?: boolean },
): T | null {
  if (opts?.skip) return null;
  const rng = opts?.rng ?? Math.random;

  schedule.sinceReward += 1;
  if (schedule.sinceReward < schedule.nextAt) return null;

  schedule.sinceReward = 0;
  schedule.nextAt = drawThreshold(schedule.minGap, schedule.maxGap, rng);
  return pickWeighted(schedule.weights, rng);
}

/** Test helper: overwrite counters without redrawing threshold from rng. */
export function resetVariableRatioSchedule<T extends string>(
  schedule: VariableRatioSchedule<T>,
  opts?: { sinceReward?: number; nextAt?: number },
): void {
  schedule.sinceReward = opts?.sinceReward ?? 0;
  if (opts?.nextAt != null) schedule.nextAt = opts.nextAt;
}
