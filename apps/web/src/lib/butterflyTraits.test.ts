import { describe, expect, test } from "bun:test";
import { suggestTraits, type CatalogEntry, type DayPoint } from "./butterflyTraits";

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    side: "deposit",
    label: "Walk the dog",
    useCount: 5,
    typicalDifficulty: null,
    difficultyCount: 0,
    ...overrides,
  };
}

describe("suggestTraits", () => {
  test("frequent deposits become energy-giver suggestions with evidence", () => {
    const out = suggestTraits([entry({ label: "Gaming", useCount: 8 })], []);
    const giver = out.find((t) => t.kind === "energy-giver");
    expect(giver?.label).toBe("Gaming");
    expect(giver?.because[0]).toContain("8 times");
  });

  test("rare activities are not suggested", () => {
    const out = suggestTraits([entry({ useCount: 2 })], []);
    expect(out).toHaveLength(0);
  });

  test("hard withdrawals note the difficulty", () => {
    const out = suggestTraits(
      [
        entry({
          side: "withdrawal",
          label: "Team meeting",
          useCount: 6,
          typicalDifficulty: 8,
          difficultyCount: 4,
        }),
      ],
      [],
    );
    const taker = out.find((t) => t.kind === "energy-taker");
    expect(taker?.because.join(" ")).toContain("hard");
  });

  test("dismissed ids stay gone", () => {
    const catalog = [entry({ label: "Gaming", useCount: 8 })];
    const first = suggestTraits(catalog, []);
    const dismissed = new Set(first.map((t) => t.id));
    expect(suggestTraits(catalog, [], dismissed)).toHaveLength(0);
  });

  test("a consistently draining weekday becomes a rhythm suggestion", () => {
    // 12 closed Mondays at -30 net; other days positive.
    const days: DayPoint[] = [];
    for (let week = 0; week < 6; week++) {
      // 2026-01-05 is a Monday.
      const monday = new Date(Date.UTC(2026, 0, 5 + week * 7));
      const tuesday = new Date(Date.UTC(2026, 0, 6 + week * 7));
      days.push({
        date: monday.toISOString().slice(0, 10),
        phase: "closed",
        attwoodNet: -30,
        feelRating: 4,
      });
      days.push({
        date: tuesday.toISOString().slice(0, 10),
        phase: "closed",
        attwoodNet: 15,
        feelRating: 7,
      });
    }
    const out = suggestTraits([], days);
    const rhythm = out.find((t) => t.kind === "rhythm");
    expect(rhythm?.label).toContain("Monday");
    expect(rhythm?.because[0]).toContain("-30");
  });

  test("results sort strongest first and are deterministic", () => {
    const catalog = [
      entry({ label: "A", useCount: 4 }),
      entry({ label: "B", useCount: 9 }),
    ];
    const a = suggestTraits(catalog, []);
    const b = suggestTraits(catalog, []);
    expect(a).toEqual(b);
    expect(a[0]!.strength).toBeGreaterThanOrEqual(a[a.length - 1]!.strength);
  });
});
