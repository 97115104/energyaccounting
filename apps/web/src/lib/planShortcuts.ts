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
 * An empty column is an invitation to plan, even when its normal suggestions
 * are hidden. Completed rows do not count as active work here.
 */
export function resolveSuggestionVisibility(opts: Readonly<{
  requestedVisible: boolean;
  activeTaskCount: number;
  revealWhenEmpty: boolean;
}>): boolean {
  return opts.requestedVisible || (opts.revealWhenEmpty && opts.activeTaskCount === 0);
}

const SUGGESTION_FILLER_WORDS = new Set(["a", "an", "the", "few", "some"]);

function singularSuggestionWord(word: string): string {
  if (word.length <= 3 || word.endsWith("ss")) return word;
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("ies") && !word.endsWith("vies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ches") || word.endsWith("shes") || word.endsWith("xes") || word.endsWith("zes")) {
    return word.slice(0, -2);
  }
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

/**
 * A deliberately conservative client-side key for decrypted suggestion labels.
 * It removes only incidental articles/quantity words, normalizes simple
 * plurals, and keeps meaningful names, quantities, and activity words.
 */
export function suggestionFingerprint(label: string | undefined): string {
  if (!label) return "";
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .filter((word) => !SUGGESTION_FILLER_WORDS.has(word))
    .map(singularSuggestionWord)
    .sort()
    .join(" ");
}

function isSimilarSuggestionLabel(left: string | undefined, right: string | undefined): boolean {
  const leftFingerprint = suggestionFingerprint(left);
  // Do not guess that overlapping words mean the same activity. The canonical
  // form must be exactly equal, so a changed person, activity, or quantity is
  // always retained as a distinct suggestion.
  return leftFingerprint.length > 0 && leftFingerprint === suggestionFingerprint(right);
}

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
 * Collapse near-identical recent activities after decryption. The API orders
 * items by recency, so retaining the first item keeps the freshest wording and
 * cost. Similarity is derived from every label's exact canonical token key;
 * it has no task-specific vocabulary or title-specific branches.
 */
export function collapseSimilarRecent<T extends RecentLike>(recent: readonly T[]): T[] {
  return recent.reduce<T[]>((representatives, suggestion) => {
    if (!suggestionFingerprint(suggestion.label)) return representatives;
    const alreadyRepresented = representatives.some(
      (representative) =>
        representative.side === suggestion.side &&
        isSimilarSuggestionLabel(representative.label, suggestion.label),
    );
    return alreadyRepresented ? representatives : [...representatives, suggestion];
  }, []);
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
