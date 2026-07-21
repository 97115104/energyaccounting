import { describe, expect, test } from "bun:test";
import {
  buildPersonalIntelligence,
  type IntelligenceDay,
} from "./personalIntelligence";

function day(index: number, overrides: Partial<IntelligenceDay> = {}): IntelligenceDay {
  const date = new Date(Date.UTC(2026, 6, 6 + index)).toISOString().slice(0, 10);
  return {
    date,
    phase: "closed",
    closingBalance: 60,
    attwoodNet: 0,
    depositTotal: 20,
    withdrawalTotal: 20,
    feelRating: 7,
    ...overrides,
  };
}

describe("buildPersonalIntelligence", () => {
  test("stays quiet when history is sparse", () => {
    const model = buildPersonalIntelligence({ catalog: [], days: [day(0)] });
    expect(model.overview).toEqual([]);
    expect(model.energyMeaning).toEqual([]);
    expect(model.tipSignals.recentLowFeel).toBe(false);
  });

  test("explains familiar restorers and personal energy ranges", () => {
    const model = buildPersonalIntelligence({
      catalog: [
        { side: "deposit", label: "Quiet walk", useCount: 7 },
        { side: "withdrawal", label: "Long meeting", useCount: 5 },
      ],
      days: Array.from({ length: 6 }, (_, index) => day(index)),
    });
    expect(model.overview.map((line) => line.text).join(" ")).toContain("Quiet walk");
    expect(model.overview.every((line) => line.because.length > 0)).toBe(true);
    expect(model.energyMeaning[0]?.text).toContain("60");
    expect(model.tipSignals.familiarRestorer).toBe("Quiet walk");
  });

  test("waits for enough rated history before low-feel tips", () => {
    const sparse = buildPersonalIntelligence({
      catalog: [],
      days: [
        day(0, { feelRating: 3 }),
        day(1, { feelRating: 7 }),
        day(2, { feelRating: 4 }),
      ],
    });
    expect(sparse.tipSignals.recentLowFeel).toBe(false);

    const ready = buildPersonalIntelligence({
      catalog: [],
      days: Array.from({ length: 5 }, (_, index) =>
        day(index, { feelRating: index >= 2 ? 3 : 7 }),
      ),
    });
    expect(ready.tipSignals.recentLowFeel).toBe(true);
    expect(ready.tipSignals.recentRatedSample).toBe(3);
  });

  test("sorts unsorted closed days before recent windows", () => {
    const model = buildPersonalIntelligence({
      catalog: [],
      days: [
        day(5, { closingBalance: 10 }),
        day(0, { closingBalance: 90 }),
        day(1, { closingBalance: 90 }),
        day(2, { closingBalance: 90 }),
        day(3, { closingBalance: 90 }),
        day(4, { closingBalance: 90 }),
      ],
    });
    // Most recent day (index 5) is 10; mean of six sorted closes is not 90.
    expect(model.energyMeaning[0]?.text).toContain("77");
  });
});
