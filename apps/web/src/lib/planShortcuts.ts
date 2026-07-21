/**
 * Pure helpers for the "Use previous plan" action and the Recent list in the
 * add sheet. Kept out of TodayPage so the visibility/capacity rules are
 * testable without rendering.
 */

export type RepeatableDay = {
  phase: string;
  lines: unknown[];
  /** Server-provided availability: a prior closed ledger with tasks exists. */
  repeatAvailable?: boolean;
};

/**
 * The single repeat action shows only on the editable active-ledger view:
 * plan phase, nothing added yet, and the server says a previous plan exists.
 * History deep-links (?day=) never show it.
 */
export function repeatActionVisible(
  day: RepeatableDay | null,
  isHistoryView: boolean,
): boolean {
  return (
    !!day &&
    !isHistoryView &&
    day.phase === "plan" &&
    day.lines.length === 0 &&
    day.repeatAvailable === true
  );
}

/**
 * Why a recent choice cannot be added right now, or null when it can.
 * Only live (non-closed) days enforce capacity; closed-day amendments
 * record what happened and are never blocked.
 */
export function recentDisabledReason(
  cost: number,
  availableCapacity: number,
  phase: string,
): string | null {
  if (phase === "closed" || cost <= availableCapacity) return null;
  return `Needs ${cost} points, only ${availableCapacity} available`;
}
