import { describe, expect, test } from "bun:test";
import {
  closeDayInsights,
  closedStreak,
  planningHint,
  type StatPoint,
} from "./insights";

function day(date: string, overrides: Partial<StatPoint> = {}): StatPoint {
  return {
    date,
    openingBalance: 100,
    closingBalance: 100,
    attwoodNet: 0,
    depositTotal: 20,
    withdrawalTotal: 20,
    isHoliday: false,
    feelRating: null,
    phase: "closed",
    taskCount: 4,
    completedCount: 3,
    plannedTotal: 40,
    actualTotal: 40,
    ...overrides,
  };
}

/** N consecutive closed days ending the day before `end`. */
function history(end: string, n: number, overrides: Partial<StatPoint> = {}): StatPoint[] {
  const out: StatPoint[] = [];
  const d = new Date(end + "T12:00:00Z");
  for (let i = n; i >= 1; i--) {
    const cur = new Date(d);
    cur.setUTCDate(cur.getUTCDate() - i);
    out.push(day(cur.toISOString().slice(0, 10), overrides));
  }
  return out;
}

describe("closeDayInsights", () => {
  test("returns nothing for a day missing from the series", () => {
    expect(closeDayInsights([], "2026-07-20")).toEqual([]);
  });

  test("thin history produces no averages-based noise", () => {
    const series = [
      ...history("2026-07-20", 2),
      day("2026-07-20", { completedCount: 9 }),
    ];
    const ids = closeDayInsights(series, "2026-07-20").map((i) => i.id);
    expect(ids).not.toContain("above-average-completed");
  });

  test("celebrates completions clearly above the recent average", () => {
    const series = [
      ...history("2026-07-20", 10, { completedCount: 2 }),
      day("2026-07-20", { completedCount: 6 }),
    ];
    const ids = closeDayInsights(series, "2026-07-20").map((i) => i.id);
    expect(ids).toContain("above-average-completed");
  });

  test("celebrates high average difficulty with real completions", () => {
    const series = [
      ...history("2026-07-20", 10),
      day("2026-07-20", {
        avgDifficulty: 8,
        difficultyRatedCount: 3,
        completedCount: 3,
      }),
    ];
    const ids = closeDayInsights(series, "2026-07-20").map((i) => i.id);
    expect(ids).toContain("hard-and-done");
  });

  test("a deficit day with no other wins gets the gentle framing, never shame", () => {
    const series = [day("2026-07-20", { openingBalance: 100, closingBalance: 70 })];
    const insights = closeDayInsights(series, "2026-07-20");
    expect(insights).toHaveLength(1);
    expect(insights[0]!.id).toBe("showed-up");
    expect(insights[0]!.tone).toBe("gentle");
  });

  test("caps output at three insights, celebrations first", () => {
    const series = [
      ...history("2026-07-20", 30, {
        completedCount: 1,
        closingBalance: 50,
        depositTotal: 10,
      }),
      day("2026-07-20", {
        completedCount: 8,
        closingBalance: 120,
        depositTotal: 40,
      }),
    ];
    const insights = closeDayInsights(series, "2026-07-20");
    expect(insights.length).toBeLessThanOrEqual(3);
    expect(insights[0]!.tone).toBe("celebrate");
  });
});

describe("closedStreak", () => {
  test("counts consecutive closed days through the given date", () => {
    const series = [...history("2026-07-21", 3), day("2026-07-21")];
    expect(closedStreak(series, "2026-07-21")).toBe(4);
  });

  test("a gap breaks the streak", () => {
    const series = [day("2026-07-18"), day("2026-07-20")];
    expect(closedStreak(series, "2026-07-20")).toBe(1);
  });
});

describe("planningHint", () => {
  test("null when history is thin", () => {
    expect(planningHint(history("2026-07-20", 5), "2026-07-20")).toBeNull();
  });

  test("flags a weekday that reliably runs a net drain", () => {
    // 2026-07-20 is a Monday. Mondays net -30; every other day nets +5.
    const series = history("2026-07-20", 28).map((p) => {
      const isMonday = new Date(p.date + "T12:00:00Z").getUTCDay() === 1;
      return { ...p, attwoodNet: isMonday ? -30 : 5 };
    });
    const hint = planningHint(series, "2026-07-20");
    expect(hint?.id).toBe("weekday-pattern");
    expect(hint?.text).toContain("Monday");
  });

  test("no hint when the weekday looks like every other day", () => {
    const series = history("2026-07-20", 28, { attwoodNet: 5 });
    expect(planningHint(series, "2026-07-20")).toBeNull();
  });
});
