/**
 * Pure helpers for the Recent list in the add sheet and day columns.
 * Kept out of TodayPage so capacity / filter rules are testable without rendering.
 */

export type RecentLike = {
  id: string;
  side: "deposit" | "withdrawal";
  label?: string;
  labelHash?: string;
  typicalCost: number;
};

export type LineLike = {
  side: "deposit" | "withdrawal";
  label?: string;
  labelHash?: string;
};

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

/** Drop suggestions already on today's board for that side. */
export function filterUnusedRecent<T extends RecentLike>(
  recent: T[],
  lines: LineLike[],
): T[] {
  const used = new Set<string>();
  for (const l of lines) {
    if (l.labelHash) used.add(`${l.side}:${l.labelHash}`);
    const trimmed = l.label?.trim().toLowerCase();
    if (trimmed) used.add(`${l.side}:label:${trimmed}`);
  }
  return recent.filter((s) => {
    if (!s.label?.trim()) return false;
    if (s.labelHash && used.has(`${s.side}:${s.labelHash}`)) return false;
    const trimmed = s.label.trim().toLowerCase();
    if (used.has(`${s.side}:label:${trimmed}`)) return false;
    return true;
  });
}

/**
 * Suggestions still worth showing under a column. Live withdrawals hide when
 * nothing remains to allocate; closed-day amendments and deposits stay while
 * unused history remains.
 */
export function shouldShowColumnRecent(opts: {
  closed: boolean;
  phase: string;
  side: "deposit" | "withdrawal";
  availableCapacity: number;
  unusedCount: number;
}): boolean {
  if (opts.closed || opts.unusedCount <= 0) return false;
  if (
    opts.side === "withdrawal" &&
    opts.phase !== "closed" &&
    opts.availableCapacity <= 0
  ) {
    return false;
  }
  return true;
}

/** In list order, items that currently fit (for Add All), depleting capacity. */
export function addableRecent<T extends RecentLike>(
  recent: T[],
  availableCapacity: number,
  phase: string,
): T[] {
  let remaining = availableCapacity;
  const out: T[] = [];
  for (const s of recent) {
    if (recentDisabledReason(s.typicalCost, remaining, phase, s.side)) continue;
    out.push(s);
    if (s.side === "withdrawal") remaining -= s.typicalCost;
  }
  return out;
}
