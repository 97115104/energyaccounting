/**
 * Completed-task footer praise: sentence-case encouragement with a variable
 * pool (visit-seeded copy) and per-column VR schedules for fire/rainbow accents.
 */

import {
  createVariableRatioSchedule,
  resetVariableRatioSchedule,
  rollVariableRatio,
  type VariableRatioSchedule,
} from "./variableRatio";

export type PraiseEffect = "none" | "fire" | "rainbow";
export type PraiseSide = "deposit" | "withdrawal";

export type CompletedPraise = {
  lead: string;
  accent: string;
  effect: PraiseEffect;
};

const visitSeed = Math.random();

type Line = { lead: string; accent: string };

const ONE: Line[] = [
  { lead: "1 done already.", accent: "Nice!" },
  { lead: "1 done.", accent: "That counts!" },
  { lead: "1 checked off.", accent: "Good start!" },
];

const TWO: Line[] = [
  { lead: "2 done already.", accent: "Well done!" },
  { lead: "2 completed.", accent: "Keep going!" },
  { lead: "2 done.", accent: "You're on a roll!" },
];

const THREE: Line[] = [
  { lead: "3 done.", accent: "You're awesome!" },
  { lead: "3 completed.", accent: "Well done you!" },
  { lead: "3 done already.", accent: "Looking good!" },
];

const MANY: Line[] = [
  { lead: "{n} done already.", accent: "Incredible!" },
  { lead: "{n} completed.", accent: "You're on fire!" },
  { lead: "{n} done.", accent: "Keep that momentum!" },
  { lead: "{n} done already.", accent: "Well done you!" },
];

function poolFor(count: number): Line[] {
  if (count <= 1) return ONE;
  if (count === 2) return TWO;
  if (count === 3) return THREE;
  return MANY;
}

function makeSchedule(): VariableRatioSchedule<"fire" | "rainbow"> {
  return createVariableRatioSchedule({
    minGap: 2,
    maxGap: 5,
    weights: [
      { value: "fire", weight: 70 },
      { value: "rainbow", weight: 30 },
    ],
  });
}

/** Separate streams so Use/Add energy columns do not steal each other's hits. */
const praiseSchedules: Record<PraiseSide, VariableRatioSchedule<"fire" | "rainbow">> = {
  deposit: makeSchedule(),
  withdrawal: makeSchedule(),
};

/** Test hook for a column's praise-accent VR schedule. */
export function resetPraiseEffectSession(
  side: PraiseSide = "withdrawal",
  opts?: { sinceReward?: number; nextAt?: number },
): void {
  resetVariableRatioSchedule(praiseSchedules[side], {
    sinceReward: opts?.sinceReward ?? 0,
    nextAt: opts?.nextAt ?? 2,
  });
}

export function peekPraiseEffectSession(side: PraiseSide = "withdrawal"): {
  sinceReward: number;
  nextAt: number;
} {
  const s = praiseSchedules[side];
  return { sinceReward: s.sinceReward, nextAt: s.nextAt };
}

/**
 * Visit-stable copy for a completion count, plus a VR accent effect rolled
 * only when `rollEffect` is true (call on new wins for that column).
 */
export function completedFooterPraise(
  count: number,
  opts?: {
    side?: PraiseSide;
    rollEffect?: boolean;
    rng?: () => number;
    reducedMotion?: boolean;
    /** Preserve a prior effect across re-renders / uncomplete. */
    effect?: PraiseEffect;
  },
): CompletedPraise {
  const n = Math.floor(count);
  if (n < 1) return { lead: "", accent: "", effect: "none" };

  const pool = poolFor(n);
  const idx = Math.floor((visitSeed * 997 + n * 31) % pool.length);
  const picked = pool[idx]!;
  const lead = picked.lead.replaceAll("{n}", String(n));
  const accent = picked.accent;

  let effect: PraiseEffect = opts?.effect ?? "none";
  if (opts?.rollEffect) {
    const side = opts.side ?? "withdrawal";
    const hit = rollVariableRatio(praiseSchedules[side], {
      rng: opts.rng,
      skip: opts.reducedMotion,
    });
    effect = hit ?? "none";
  }

  return { lead, accent, effect };
}
