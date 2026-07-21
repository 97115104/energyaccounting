/**
 * Butterfly daily state: a pure mapping from today's plaintext energy numbers to
 * a labeled, explainable pose. This never reads encrypted labels and never talks
 * to a network, so it stays inside the same on-device, numbers-only boundary the
 * Energy Guide already respects.
 *
 * The state drives how the wings move (tempo) and a text status label, so the
 * meaning survives with animation paused or reduced. Color is never the only
 * signal.
 */

import { DAILY_ENERGY } from "@eaj/shared";
import type { MotionPreference } from "./identity";

export type ButterflyStateId = "resting" | "steady" | "lively" | "recovering" | "spent";

export type ButterflyStateInput = {
  /** Points still available to allocate today. */
  available: number;
  /** Opening energy for the day (usually DAILY_ENERGY). */
  opening: number;
  /** Attwood deposit total so far. */
  depositTotal: number;
  /** Attwood withdrawal total so far. */
  withdrawalTotal: number;
  /** Planned energy-using tasks still open. */
  incompleteWithdrawals: number;
  /** Tasks completed today. */
  completedCount: number;
  /** True when energy used clearly dominates energy added. */
  withdrawalHeavy: boolean;
  /** Feel rating 1..10 when the day has been audited, else null. */
  feelRating: number | null;
  /** Lifecycle phase of the active day, or null when no day is open. */
  phase: "plan" | "audit" | "closed" | null;
};

export type ButterflyState = {
  id: ButterflyStateId;
  /** Short human label, safe to read aloud or show without color. */
  label: string;
  /** One plain sentence describing the pose. */
  summary: string;
  /** Wing-beat period in milliseconds; larger is calmer. */
  beatMs: number;
  /** 0..1 vitality ring fill, from remaining capacity. */
  vitality: number;
  /** Concrete signals that produced this state ("why this pose"). */
  because: string[];
};

/**
 * Display labels per pose. Mixes the simple originals with funnier, gender-neutral
 * variants of similar length. The pick freezes for the visit (see visitSeed) so
 * the header does not churn, but a pose change re-draws from that pool.
 */
export const STATE_LABEL_POOLS: Record<ButterflyStateId, readonly string[]> = {
  resting: ["Resting", "Taking it easy", "Quiet for now", "Plenty left"],
  steady: ["Steady", "Even keel", "In balance", "Holding steady"],
  lively: ["Lively", "Feeling lively", "Quick wings today", "Bright beat"],
  recovering: ["Recovering", "Soft landing", "Going gentle", "Take it slow"],
  spent: ["Spent", "Tank's low", "Nearly empty", "Very little left"],
};

/** The plain name for each pose, always the first entry in the pool. */
export function canonicalStateLabel(id: ButterflyStateId): string {
  return STATE_LABEL_POOLS[id][0]!;
}

const META: Record<ButterflyStateId, { summary: string; beatMs: number }> = {
  resting: {
    summary: "Wings folded and calm. Plenty of energy is still available.",
    beatMs: 2600,
  },
  steady: {
    summary: "An even, unhurried beat. The day is in balance.",
    beatMs: 1800,
  },
  lively: {
    summary: "A brighter, quicker beat after adding energy or finishing tasks.",
    beatMs: 1100,
  },
  recovering: {
    summary: "A slow, gentle beat. The day has asked a lot, so ease in.",
    beatMs: 3200,
  },
  spent: {
    summary: "Wings low and still. Very little energy remains for today.",
    beatMs: 3600,
  },
};

// Same freeze-per-visit idea as greetings: one random stream for the session.
const visitSeed = Math.random();

const STATE_ORDER: ButterflyStateId[] = [
  "resting",
  "steady",
  "lively",
  "recovering",
  "spent",
];

function labelFor(id: ButterflyStateId): string {
  const pool = STATE_LABEL_POOLS[id];
  // Offset by pose ordinal so resting/recovering (same first letter) never share an index.
  const ordinal = STATE_ORDER.indexOf(id);
  const mixed = (visitSeed + ordinal / STATE_ORDER.length) % 1;
  return pool[Math.floor(mixed * pool.length) % pool.length]!;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Resolve the butterfly's state for the current day. Deterministic for a given
 * visit seed: the same input always produces the same pose and label.
 *
 * Precedence: a hard, low-energy day reads as spent or recovering first, then a
 * clearly energized day reads as lively, then balance reads as steady, and an
 * untouched or well-rested day reads as resting.
 */
export function resolveButterflyState(input: ButterflyStateInput): ButterflyState {
  const opening = input.opening > 0 ? input.opening : DAILY_ENERGY;
  const vitality = clamp01(input.available / opening);
  const because: string[] = [];

  let id: ButterflyStateId;
  if (input.available <= opening * 0.15) {
    id = "spent";
    because.push(`Only ${Math.round(input.available)} of ${Math.round(opening)} points remain.`);
  } else if (
    input.withdrawalHeavy ||
    (input.feelRating != null && input.feelRating <= 4) ||
    (input.incompleteWithdrawals >= 3 && vitality < 0.5)
  ) {
    id = "recovering";
    if (input.withdrawalHeavy) {
      because.push(
        `Energy used (${Math.round(input.withdrawalTotal)}) outpaces energy added (${Math.round(
          input.depositTotal,
        )}).`,
      );
    }
    if (input.feelRating != null && input.feelRating <= 4) {
      because.push(`Today was rated ${input.feelRating} out of 10.`);
    }
    if (input.incompleteWithdrawals >= 3) {
      because.push(`${input.incompleteWithdrawals} energy-using tasks are still open.`);
    }
  } else if (input.depositTotal >= 20 || input.completedCount >= 2) {
    id = "lively";
    if (input.depositTotal >= 20) {
      because.push(`${Math.round(input.depositTotal)} points of energy added so far.`);
    }
    if (input.completedCount >= 2) {
      because.push(`${input.completedCount} tasks completed today.`);
    }
  } else if (input.depositTotal > 0 || input.withdrawalTotal > 0) {
    id = "steady";
    because.push(
      `Balanced so far: ${Math.round(input.depositTotal)} added, ${Math.round(
        input.withdrawalTotal,
      )} used.`,
    );
  } else {
    id = "resting";
    because.push(
      input.phase == null
        ? "No energy day is open yet."
        : `A fresh day with ${Math.round(input.available)} points available.`,
    );
  }

  const meta = META[id];
  return {
    id,
    label: labelFor(id),
    summary: meta.summary,
    beatMs: meta.beatMs,
    vitality,
    because,
  };
}

/**
 * Effective wing-beat period after the person's motion preference and the OS
 * reduced-motion setting. "still" and reduced motion return null, meaning no
 * animation; render a static pose instead.
 */
export function effectiveBeatMs(
  state: ButterflyState,
  motion: MotionPreference,
  prefersReducedMotion: boolean,
): number | null {
  if (motion === "still") return null;
  if (prefersReducedMotion) return null;
  if (motion === "calm") return Math.round(state.beatMs * 1.5);
  return state.beatMs;
}
