import { describe, expect, test } from "bun:test";
import { suggestActivities, type ActivitySuggestContext } from "./activitySuggest";

function context(overrides: Partial<ActivitySuggestContext> = {}): ActivitySuggestContext {
  return {
    date: "2026-07-20",
    available: 40,
    weatherKind: "sun",
    uvMax: 1,
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

  test("does not claim UV evidence when uvMax is missing", () => {
    const suggestions = suggestActivities(
      context({
        uvMax: null,
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
