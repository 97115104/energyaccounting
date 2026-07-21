/**
 * The movement registry: typed, extensible activity families for the Energy
 * Guide's novel suggestions (push-ups, jumping jacks, and friends).
 *
 * Family data lives in content/movement-families.json (matchers as strings).
 * Progression is derived on-device from the person's own decrypted catalog
 * history; nothing here assumes fitness, and nothing talks to a network.
 */

import MOVEMENT_JSON from "../content/movement-families.json";

export type MovementTier = {
  /** Exact label logged to the encrypted ledger when this dose is chosen. */
  label: string;
  /** Energy points this deposit typically costs to start. */
  cost: number;
};

export type MovementVariant = {
  name: string;
  /** starter, steady, strong — always suggested in that order of evidence. */
  tiers: [MovementTier, MovementTier, MovementTier];
};

export type MovementFamily = {
  id: string;
  /** Playful card title, e.g. "Tiny strength spark". */
  title: string;
  /** Groups the person's own logged labels (any dose, any variant) into this family. */
  matcher: RegExp;
  /** Recognizes labels that belong to the lower-impact variant specifically. */
  gentlerMatcher: RegExp;
  primary: MovementVariant;
  /** Lower-impact alternative, always offered alongside the primary dose. */
  gentler: MovementVariant;
  research: string;
  sourceUrl: string;
};

type MovementFamilyJson = {
  id: string;
  title: string;
  matcher: string;
  gentlerMatcher: string;
  primary: MovementVariant;
  gentler: MovementVariant;
  research: string;
  sourceUrl: string;
};

function compileFamily(raw: MovementFamilyJson): MovementFamily {
  return {
    ...raw,
    matcher: new RegExp(raw.matcher, "i"),
    gentlerMatcher: new RegExp(raw.gentlerMatcher, "i"),
  };
}

export const MOVEMENT_FAMILIES: MovementFamily[] = (
  MOVEMENT_JSON as MovementFamilyJson[]
).map(compileFamily);

/** Tier index: 0 starter, 1 steady, 2 strong. */
export type MovementTierIndex = 0 | 1 | 2;

/** Progression for one variant (primary or gentler), from that variant's history only. */
export type VariantProgress = {
  tier: MovementTierIndex;
  uses: number;
  /** True once the person has logged this variant at least 3 times. */
  familiar: boolean;
};

export type MovementProgress = {
  familyId: string;
  primary: VariantProgress;
  gentler: VariantProgress;
  /** Evidence lines behind the tier choices; empty means no history yet. */
  because: string[];
};

export type MovementHistoryEntry = {
  side: string;
  label: string;
  useCount: number;
  typicalDifficulty?: number | null;
  difficultyCount?: number;
};

type VariantStats = { uses: number; ratingCount: number; ratingTotal: number };

/** Conservative tier from one variant's own history — never from its sibling's. */
function variantTier(
  stats: VariantStats,
  name: string,
  because: string[],
): VariantProgress {
  const { uses, ratingCount, ratingTotal } = stats;
  if (uses === 0) return { tier: 0, uses: 0, familiar: false };

  const familiar = uses >= 3;
  const avg = ratingCount > 0 ? Math.round((ratingTotal / ratingCount) * 10) / 10 : null;
  const ratedEnough = ratingCount >= 3 && avg != null;
  because.push(`You have logged ${name} ${uses}×.`);

  // Hard ratings hold the dose small — never push through difficulty.
  if (ratedEnough && avg! >= 7) {
    because.push(
      `You usually rate it around ${avg}/10 for difficulty, so the dose stays deliberately small.`,
    );
    return { tier: 0, uses, familiar };
  }
  if (familiar && ratedEnough && avg! <= 4) {
    because.push(`You usually rate it about ${avg}/10 for difficulty.`);
    return { tier: uses >= 8 && avg! <= 3 ? 2 : 1, uses, familiar };
  }
  // Honest hold: say why the dose is not stepping up rather than implying it did.
  if (!ratedEnough) {
    because.push(
      "There are not enough difficulty ratings yet to size it up, so it stays at the starter dose.",
    );
  } else {
    because.push(`You usually rate it about ${avg}/10 for difficulty, so the dose holds steady.`);
  }
  return { tier: 0, uses, familiar };
}

/**
 * Derive per-variant progression per family from the decrypted catalog.
 * O(catalog × families). Each variant steps up only on its own repeated
 * comfortable history: wall push-up history never escalates floor push-ups.
 * Every non-default choice carries its evidence.
 */
export function deriveMovementProgress(catalog: MovementHistoryEntry[]): MovementProgress[] {
  return MOVEMENT_FAMILIES.map((family) => {
    const primary: VariantStats = { uses: 0, ratingCount: 0, ratingTotal: 0 };
    const gentler: VariantStats = { uses: 0, ratingCount: 0, ratingTotal: 0 };
    for (const entry of catalog) {
      if (entry.side !== "deposit" || !family.matcher.test(entry.label)) continue;
      const stats = family.gentlerMatcher.test(entry.label) ? gentler : primary;
      stats.uses += entry.useCount;
      const count = entry.difficultyCount ?? 0;
      if (count > 0 && entry.typicalDifficulty != null) {
        stats.ratingCount += count;
        stats.ratingTotal += entry.typicalDifficulty * count;
      }
    }

    const because: string[] = [];
    return {
      familyId: family.id,
      primary: variantTier(primary, family.primary.name, because),
      gentler: variantTier(gentler, family.gentler.name, because),
      because,
    };
  });
}
