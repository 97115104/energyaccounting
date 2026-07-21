/**
 * Explainable trait inference for the You profile.
 *
 * The butterfly's long-term look and a person's shareable "how to work with me"
 * notes are shaped by traits. Traits are never applied silently: this module
 * only *suggests* them, each with concrete evidence, and the person accepts,
 * edits, or dismisses each one. This mirrors scrutable-recommender practice,
 * where a user can read and correct the model's view of them.
 *
 * Inference runs on-device from the decrypted catalog and plaintext day numbers.
 * Nothing here is uploaded; accepted traits live in the encrypted You profile.
 */

import { mean, weekdayName } from "./dateIso";

export type TraitKind = "interest" | "energy-giver" | "energy-taker" | "rhythm";

export type TraitSuggestion = {
  /** Stable id so acceptance and dismissal survive re-computation. */
  id: string;
  kind: TraitKind;
  /** Short label, e.g. the activity or pattern. */
  label: string;
  /** Concrete signals behind the suggestion. */
  because: string[];
  /** 0..1 confidence from how strong the evidence is. */
  strength: number;
};

export type AcceptedTrait = {
  id: string;
  kind: TraitKind;
  label: string;
  /** Optional personal color meaning the person attached. */
  colorMeaning?: string;
};

/** Minimal decrypted catalog shape needed for inference. */
export type CatalogEntry = {
  side: "deposit" | "withdrawal" | string;
  label: string;
  useCount: number;
  typicalDifficulty: number | null;
  difficultyCount: number;
};

/** Minimal numeric day shape needed for rhythm inference. */
export type DayPoint = {
  date: string;
  phase: string;
  attwoodNet: number;
  feelRating: number | null;
};

const MIN_USE = 3;

/**
 * Suggest traits from decrypted catalog and numeric history. Deterministic and
 * sorted by strength so the strongest, best-evidenced traits lead.
 *
 * Complexity is linear in catalog size plus day count, so this is cheap to run
 * on unlock and after each closed day.
 */
export function suggestTraits(
  catalog: CatalogEntry[],
  days: DayPoint[],
  dismissedIds: ReadonlySet<string> = new Set(),
): TraitSuggestion[] {
  const out: TraitSuggestion[] = [];

  const givers = catalog
    .filter((c) => c.side === "deposit" && c.label.trim() && c.useCount >= MIN_USE)
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, 5);
  for (const c of givers) {
    out.push({
      id: `energy-giver:${c.label.toLowerCase()}`,
      kind: "energy-giver",
      label: c.label,
      because: [`Added energy ${c.useCount} times.`],
      strength: Math.min(1, c.useCount / 10),
    });
  }

  const takers = catalog
    .filter((c) => c.side === "withdrawal" && c.label.trim() && c.useCount >= MIN_USE)
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, 5);
  for (const c of takers) {
    const hard =
      c.typicalDifficulty != null && c.difficultyCount >= 2 && c.typicalDifficulty >= 7;
    out.push({
      id: `energy-taker:${c.label.toLowerCase()}`,
      kind: "energy-taker",
      label: c.label,
      because: [
        `Used energy ${c.useCount} times.`,
        ...(hard ? [`Usually rated hard (${c.typicalDifficulty}/10).`] : []),
      ],
      strength: Math.min(1, c.useCount / 10 + (hard ? 0.2 : 0)),
    });
  }

  // Interests: high-use activities on either side read as things the person
  // returns to, which is what an interest is in practice.
  const interests = catalog
    .filter((c) => c.label.trim() && c.useCount >= MIN_USE + 2)
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, 5);
  for (const c of interests) {
    out.push({
      id: `interest:${c.label.toLowerCase()}`,
      kind: "interest",
      label: c.label,
      because: [`Returned to this ${c.useCount} times.`],
      strength: Math.min(1, c.useCount / 12),
    });
  }

  // Rhythm: a weekday that historically runs a net drain is worth naming.
  const closed = days.filter((d) => d.phase === "closed");
  if (closed.length >= 10) {
    const byDay = new Map<string, number[]>();
    for (const d of closed) {
      const key = weekdayName(d.date);
      const list = byDay.get(key) ?? [];
      list.push(d.attwoodNet);
      byDay.set(key, list);
    }
    let hardest: { day: string; net: number } | null = null;
    for (const [day, nets] of byDay) {
      if (nets.length < 3) continue;
      const avg = mean(nets);
      if (avg < 0 && (!hardest || avg < hardest.net)) hardest = { day, net: avg };
    }
    if (hardest) {
      out.push({
        id: `rhythm:${hardest.day.toLowerCase()}`,
        kind: "rhythm",
        label: `${hardest.day}s ask more than they give`,
        because: [
          `${hardest.day}s average ${Math.round(hardest.net)} net energy across your closed days.`,
        ],
        strength: Math.min(1, Math.abs(hardest.net) / 40),
      });
    }
  }

  return out
    .filter((t) => !dismissedIds.has(t.id))
    .sort((a, b) => b.strength - a.strength);
}
