import { describe, expect, test } from "bun:test";
import {
  MOVEMENT_FAMILIES,
  deriveMovementProgress,
  type MovementHistoryEntry,
} from "./activityCatalog";

function entry(overrides: Partial<MovementHistoryEntry> = {}): MovementHistoryEntry {
  return {
    side: "deposit",
    label: "Do 3 push-ups",
    useCount: 1,
    ...overrides,
  };
}

function pushups(progress = deriveMovementProgress([])) {
  return progress.find((p) => p.familyId === "pushups")!;
}

describe("MOVEMENT_FAMILIES", () => {
  test("every family offers a lower-impact alternative at every tier", () => {
    for (const family of MOVEMENT_FAMILIES) {
      expect(family.gentler.tiers).toHaveLength(3);
      expect(family.primary.tiers).toHaveLength(3);
      for (const tier of [...family.primary.tiers, ...family.gentler.tiers]) {
        expect(tier.label.length).toBeGreaterThan(0);
        expect(tier.cost).toBeGreaterThan(0);
        expect(tier.cost).toBeLessThanOrEqual(10);
      }
    }
  });

  test("matchers recognize both the primary and gentler tier labels", () => {
    for (const family of MOVEMENT_FAMILIES) {
      for (const tier of family.primary.tiers) {
        expect(family.matcher.test(tier.label)).toBe(true);
      }
      for (const tier of family.gentler.tiers) {
        expect(family.matcher.test(tier.label)).toBe(true);
        expect(family.gentlerMatcher.test(tier.label)).toBe(true);
      }
    }
  });

  test("phrasal verbs and unrelated labels never count as movement", () => {
    const family = MOVEMENT_FAMILIES.find((f) => f.id === "pushups")!;
    for (const label of [
      "Push up my deadline",
      "Push upright the fence post",
      "Pushing the release",
    ]) {
      expect(family.matcher.test(label)).toBe(false);
    }
  });
});

describe("deriveMovementProgress", () => {
  test("unseen families start both variants at starter with no claimed evidence", () => {
    const progress = deriveMovementProgress([]);
    expect(progress).toHaveLength(MOVEMENT_FAMILIES.length);
    for (const p of progress) {
      expect(p.primary.tier).toBe(0);
      expect(p.gentler.tier).toBe(0);
      expect(p.primary.familiar).toBe(false);
      expect(p.because).toEqual([]);
    }
  });

  test("sparse history stays at starter even when ratings are easy", () => {
    const p = pushups(
      deriveMovementProgress([entry({ useCount: 2, typicalDifficulty: 2, difficultyCount: 2 })]),
    );
    expect(p.primary.tier).toBe(0);
  });

  test("repeated comfortable history steps up one tier with evidence", () => {
    const p = pushups(
      deriveMovementProgress([entry({ useCount: 4, typicalDifficulty: 3, difficultyCount: 4 })]),
    );
    expect(p.primary.tier).toBe(1);
    expect(p.primary.familiar).toBe(true);
    expect(p.because.join(" ")).toContain("4×");
    expect(p.because.join(" ")).toContain("3/10");
  });

  test("a boss-level history earns the strongest tier", () => {
    const p = pushups(
      deriveMovementProgress([entry({ useCount: 10, typicalDifficulty: 2, difficultyCount: 6 })]),
    );
    expect(p.primary.tier).toBe(2);
  });

  test("difficult ratings hold the dose small and say why", () => {
    const p = pushups(
      deriveMovementProgress([entry({ useCount: 12, typicalDifficulty: 8, difficultyCount: 5 })]),
    );
    expect(p.primary.tier).toBe(0);
    expect(p.because.join(" ")).toContain("deliberately small");
  });

  test("unrated history never steps up on frequency alone, and says so", () => {
    const p = pushups(deriveMovementProgress([entry({ useCount: 20 })]));
    expect(p.primary.tier).toBe(0);
    expect(p.because.join(" ")).toContain("not enough difficulty ratings");
  });

  test("gentler history steps up only the gentler variant, never the primary", () => {
    const p = pushups(
      deriveMovementProgress([
        entry({
          label: "Do 10 wall push-ups",
          useCount: 5,
          typicalDifficulty: 2,
          difficultyCount: 3,
        }),
      ]),
    );
    expect(p.gentler.tier).toBe(1);
    expect(p.gentler.familiar).toBe(true);
    // Wall push-up comfort is evidence about wall push-ups only.
    expect(p.primary.tier).toBe(0);
    expect(p.primary.familiar).toBe(false);
  });

  test("each variant progresses from its own ratings when both have history", () => {
    const p = pushups(
      deriveMovementProgress([
        entry({ label: "Do 3 push-ups", useCount: 5, typicalDifficulty: 8, difficultyCount: 4 }),
        entry({
          label: "Do 5 wall push-ups",
          useCount: 5,
          typicalDifficulty: 2,
          difficultyCount: 4,
        }),
      ]),
    );
    // Hard floor ratings hold the primary small; easy wall ratings step the
    // gentler up. Averaging them together would hide both facts.
    expect(p.primary.tier).toBe(0);
    expect(p.gentler.tier).toBe(1);
  });

  test("withdrawal-side labels never count toward progression", () => {
    const p = pushups(
      deriveMovementProgress([
        entry({ side: "withdrawal", useCount: 9, typicalDifficulty: 2, difficultyCount: 5 }),
      ]),
    );
    expect(p.primary.tier).toBe(0);
    expect(p.because).toEqual([]);
  });
});
