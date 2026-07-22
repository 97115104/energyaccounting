/**
 * Pure helpers for the Recent list in the add sheet. Kept out of TodayPage so
 * the capacity rules are testable without rendering.
 */

/**
 * Why a recent choice cannot be added right now, or null when it can.
 * Only live (non-closed) withdrawal planning enforces capacity; deposits
 * restore energy and stay open, and closed-day amendments are never blocked.
 */
export function recentDisabledReason(
  cost: number,
  availableCapacity: number,
  phase: string,
  side: "deposit" | "withdrawal" = "withdrawal",
): string | null {
  if (phase === "closed" || side === "deposit" || cost <= availableCapacity) return null;
  return `Needs ${cost} points, only ${availableCapacity} available`;
}
