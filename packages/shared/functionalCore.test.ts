import { describe, expect, test } from "bun:test";
import { foldCatalog } from "./src/catalog";
import { mapConcurrent } from "./src/async";
import { applyLinePositions, deriveLineReorder } from "./src/lineReorder";

describe("functional core", () => {
  test("derives deterministic cross-column reorder positions without mutation", () => {
    const lines = [
      { id: "a", side: "deposit" as const, sort: 0 },
      { id: "b", side: "withdrawal" as const, sort: 0 },
      { id: "c", side: "withdrawal" as const, sort: 1 },
    ];
    const positions = deriveLineReorder(lines, "a", "withdrawal", 1);
    expect(positions).toEqual([
      { id: "a", side: "withdrawal", sort: 1 },
      { id: "c", side: "withdrawal", sort: 2 },
    ]);
    expect(lines[0]).toEqual({ id: "a", side: "deposit", sort: 0 });
    expect(applyLinePositions(lines, positions)).toEqual([
      { id: "a", side: "withdrawal", sort: 1 },
      { id: "b", side: "withdrawal", sort: 0 },
      { id: "c", side: "withdrawal", sort: 2 },
    ]);
  });

  test("folds retained source lines into one catalog entry per stable key", () => {
    const entries = foldCatalog([
      {
        date: "2026-08-02",
        line: { side: "deposit", labelCiphertext: "old", labelIv: "iv", labelHash: "tea", plannedCost: 10, difficulty: 4 },
      },
      {
        date: "2026-08-03",
        line: { side: "deposit", labelCiphertext: "new", labelIv: "iv2", labelHash: "tea", plannedCost: 15, difficulty: null },
      },
    ]);
    expect(entries).toEqual([
      expect.objectContaining({
        side: "deposit",
        labelHash: "tea",
        labelCiphertext: "new",
        typicalCost: 15,
        useCount: 2,
        difficultyTotal: 4,
        difficultyCount: 1,
        lastUsed: "2026-08-03",
      }),
    ]);
  });

  test("bounds concurrency while preserving input ordering", async () => {
    let active = 0;
    let peak = 0;
    const values = await mapConcurrent([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 4));
      active -= 1;
      return value * 2;
    });
    expect(peak).toBe(2);
    expect(values).toEqual([2, 4, 6, 8]);
  });
});
