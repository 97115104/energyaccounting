import { describe, expect, test } from "bun:test";
import { MOVEMENT_FAMILIES, deriveMovementProgress } from "./activityCatalog";
import { suggestActivities, type ActivitySuggestContext } from "./activitySuggest";

function weekOfDates(): string[] {
  return Array.from({ length: 7 }, (_, i) => `2026-07-${String(20 + i).padStart(2, "0")}`);
}

function context(overrides: Partial<ActivitySuggestContext> = {}): ActivitySuggestContext {
  return {
    date: "2026-07-20",
    available: 40,
    weatherKind: "sun",
    uv: 1,
    isDaylight: true,
    withdrawalHeavy: false,
    existingLabels: [],
    candidates: [],
    ...overrides,
  };
}

describe("suggestActivities", () => {
  test("prefers a familiar walk when history and conditions align", () => {
    const suggestions = suggestActivities(
      context({
        candidates: [
          {
            id: "walk",
            side: "deposit",
            label: "Walk around the block",
            typicalCost: 15,
            weekdayMask: 1 << 1,
            useCount: 6,
            lastUsed: "2026-07-13",
          },
        ],
      }),
    );
    expect(suggestions[0]?.id).toBe("familiar:walk");
    expect(suggestions[0]?.reason).toContain("low UV");
  });

  test("suppresses outdoor history in rain or night even at high use counts", () => {
    const suggestions = suggestActivities(
      context({
        weatherKind: "rain",
        isDaylight: false,
        withdrawalHeavy: true,
        candidates: [
          {
            id: "walk",
            side: "deposit",
            label: "Evening walk",
            typicalCost: 15,
            weekdayMask: 127,
            useCount: 20,
            lastUsed: "2026-07-19",
          },
        ],
      }),
    );
    expect(suggestions.map((s) => s.id)).not.toContain("familiar:walk");
    expect(suggestions.some((s) => s.id === "healthy:mindful-pause")).toBe(true);
  });

  test("does not claim UV evidence when uv is missing", () => {
    const suggestions = suggestActivities(
      context({
        uv: null,
        isDaylight: true,
        weatherKind: "sun",
      }),
    );
    expect(suggestions.map((s) => s.id)).not.toContain("healthy:short-walk");
    expect(suggestions.every((s) => !/peak UV/i.test(s.reason))).toBe(true);
  });

  test("suppresses activities already planned and suggestions over capacity", () => {
    const suggestions = suggestActivities(
      context({
        available: 10,
        existingLabels: ["Try a 5-minute mindfulness pause"],
      }),
    );
    expect(suggestions.map((s) => s.label)).not.toContain("Try a 5-minute mindfulness pause");
    expect(suggestions.every((s) => s.typicalCost <= 10)).toBe(true);
  });

  test("surplus capacity surfaces familiar ways to use energy", () => {
    const suggestions = suggestActivities(
      context({
        available: 80,
        withdrawalHeavy: false,
        candidates: [
          {
            id: "deep-work",
            side: "withdrawal",
            label: "Focused writing block",
            typicalCost: 20,
            weekdayMask: 127,
            useCount: 8,
            typicalDifficulty: 4,
            difficultyCount: 5,
            lastUsed: "2026-07-18",
          },
        ],
      }),
    );
    const use = suggestions.find((s) => s.id === "familiar-use:deep-work");
    expect(use?.side).toBe("withdrawal");
    expect(use?.label).toBe("Focused writing block");
  });

  test("heavy days do not push surplus use-energy picks at moderate capacity", () => {
    const suggestions = suggestActivities(
      context({
        available: 45,
        withdrawalHeavy: true,
        candidates: [
          {
            id: "deep-work",
            side: "withdrawal",
            label: "Focused writing block",
            typicalCost: 20,
            weekdayMask: 127,
            useCount: 8,
            lastUsed: "2026-07-18",
          },
        ],
      }),
    );
    expect(suggestions.every((s) => s.side !== "withdrawal")).toBe(true);
  });

  test("offers exactly one movement family per day with a gentler alternative", () => {
    const suggestions = suggestActivities(context());
    const movement = suggestions.filter((s) => s.id.startsWith("movement:"));
    expect(movement).toHaveLength(1);
    expect(movement[0]!.alternative?.label).toBeTruthy();
    expect(movement[0]!.research).toBeTruthy();
  });

  test("movement doses start tiny without history and rotate by date", () => {
    const a = suggestActivities(context({ date: "2026-07-20" })).find((s) =>
      s.id.startsWith("movement:"),
    )!;
    // Starter tier: the label matches tier 0 of whichever family fired.
    const family = MOVEMENT_FAMILIES.find((f) => `movement:${f.id}` === a.id)!;
    expect(a.label).toBe(family.primary.tiers[0].label);
    expect(a.alternative?.label).toBe(family.gentler.tiers[0].label);
    expect(a.familiar).toBe(false);

    // Deterministic: same date, same pick; different dates eventually differ.
    const again = suggestActivities(context({ date: "2026-07-20" }));
    expect(again.find((s) => s.id.startsWith("movement:"))?.id).toBe(a.id);
    const week = weekOfDates().map(
      (date) =>
        suggestActivities(context({ date })).find((s) => s.id.startsWith("movement:"))?.id,
    );
    expect(new Set([a.id, ...week]).size).toBeGreaterThan(1);
  });

  test("comfortable movement history steps the dose up with evidence", () => {
    const movement = deriveMovementProgress([
      {
        side: "deposit",
        label: "Do 3 push-ups",
        useCount: 5,
        typicalDifficulty: 2,
        difficultyCount: 4,
      },
    ]);
    // Force the push-up family regardless of the date rotation by finding a
    // date whose rotation lands on it.
    for (const date of weekOfDates()) {
      const pick = suggestActivities(context({ date, movement })).find(
        (s) => s.id === "movement:pushups",
      );
      if (!pick) continue;
      expect(pick.label).toBe("Do 8 push-ups");
      expect(pick.familiar).toBe(true);
      expect(pick.reason).toContain("steps up");
      expect(pick.reason).toContain("5×");
      // The gentler variant has no history of its own, so it stays at starter.
      expect(pick.alternative?.label).toBe("Do 5 wall push-ups");
      return;
    }
    throw new Error("push-up family never rotated in across a week");
  });

  test("gentler-only history never escalates the primary dose", () => {
    const movement = deriveMovementProgress([
      {
        side: "deposit",
        label: "Do 10 wall push-ups",
        useCount: 6,
        typicalDifficulty: 2,
        difficultyCount: 4,
      },
    ]);
    for (const date of weekOfDates()) {
      const pick = suggestActivities(context({ date, movement })).find(
        (s) => s.id === "movement:pushups",
      );
      if (!pick) continue;
      // Comfort with wall push-ups is evidence about wall push-ups only.
      expect(pick.label).toBe("Do 3 push-ups");
      expect(pick.alternative?.label).toBe("Do 10 wall push-ups");
      return;
    }
    throw new Error("push-up family never rotated in across a week");
  });

  test("any same-family label on the day suppresses the family, whatever the tier", () => {
    for (const date of weekOfDates()) {
      const first = suggestActivities(context({ date })).find((s) =>
        s.id.startsWith("movement:"),
      )!;
      // A differently-dosed label from the same family still blocks it.
      const higherTier = first.label.replace(/\d+/, "99");
      const after = suggestActivities(context({ date, existingLabels: [higherTier] })).find(
        (s) => s.id === first.id,
      );
      expect(after).toBeUndefined();
    }
  });

  test("movement survives a rich familiar catalog instead of being crowded out", () => {
    const candidates = ["Morning tea", "Journaling", "Call a friend"].map((label, i) => ({
      id: `fam-${i}`,
      side: "deposit" as const,
      label,
      typicalCost: 10,
      weekdayMask: 127,
      useCount: 9,
      lastUsed: "2026-07-19",
    }));
    const suggestions = suggestActivities(context({ candidates }));
    expect(suggestions.filter((s) => s.familiar && !s.id.startsWith("movement:")).length).toBe(3);
    expect(suggestions.some((s) => s.id.startsWith("movement:"))).toBe(true);
  });

  test("movement already on the day (either variant) suppresses the family", () => {
    for (const date of weekOfDates()) {
      const first = suggestActivities(context({ date })).find((s) =>
        s.id.startsWith("movement:"),
      )!;
      // Adding the gentler label blocks the same family from re-firing.
      const after = suggestActivities(
        context({ date, existingLabels: [first.alternative!.label] }),
      ).find((s) => s.id === first.id);
      expect(after).toBeUndefined();
    }
  });

  test("movement respects remaining capacity", () => {
    const none = suggestActivities(context({ available: 0 }));
    expect(none).toHaveLength(0);
    const tiny = suggestActivities(context({ available: 5 }));
    for (const s of tiny) expect(s.typicalCost).toBeLessThanOrEqual(5);
  });

  test("mentions difficulty only after enough personal ratings", () => {
    const base = {
      id: "pause",
      side: "deposit" as const,
      label: "Quiet pause",
      typicalCost: 10,
      weekdayMask: 127,
      useCount: 4,
      lastUsed: "2026-07-19",
      typicalDifficulty: 3,
    };
    const thin = suggestActivities(context({ candidates: [{ ...base, difficultyCount: 2 }] }));
    const known = suggestActivities(context({ candidates: [{ ...base, difficultyCount: 3 }] }));
    expect(thin[0]?.reason).not.toContain("difficulty");
    expect(known[0]?.reason).toContain("3/10 for difficulty");
  });
});
