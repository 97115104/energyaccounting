/**
 * Pure helpers for the Recent list in the add sheet. Kept out of TodayPage so
 * the capacity rules are testable without rendering.
 */

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
