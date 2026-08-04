import { describe, expect, test } from "bun:test";
import { buildDayBriefing, buildTrendNarrative, type TrendMetric } from "./dashboardBriefing";
import type { StatPoint } from "./insights";

function stat(overrides: Partial<StatPoint> = {}): StatPoint {
  return {
    id: overrides.id ?? "day",
    date: overrides.date ?? "2026-07-10",
    startedAt: overrides.startedAt ?? "2026-07-10T09:00:00.000Z",
    closedAt: overrides.closedAt ?? null,
    durationMinutes: overrides.durationMinutes ?? null,
    openingBalance: overrides.openingBalance ?? 100,
    closingBalance: overrides.closingBalance ?? 100,
    attwoodNet: overrides.attwoodNet ?? 0,
    depositTotal: overrides.depositTotal ?? 0,
    withdrawalTotal: overrides.withdrawalTotal ?? 0,
    isHoliday: overrides.isHoliday ?? false,
    feelRating: overrides.feelRating ?? null,
    phase: overrides.phase ?? "closed",
    taskCount: overrides.taskCount ?? 0,
    completedCount: overrides.completedCount ?? 0,
    pendingReservedEnergy: overrides.pendingReservedEnergy,
    completedFreedEnergy: overrides.completedFreedEnergy,
    availableCapacity: overrides.availableCapacity,
    avgDifficulty: overrides.avgDifficulty,
    difficultyRatedCount: overrides.difficultyRatedCount,
    plannedTotal: overrides.plannedTotal ?? 0,
    actualTotal: overrides.actualTotal ?? overrides.plannedTotal ?? 0,
    lines: overrides.lines,
  };
}

function expectProfileCopy(text: string) {
  expect(text).not.toContain("Direction is information");
  expect(text).not.toContain("not a grade");
  expect(text).not.toContain("rather than");
  expect(text).not.toContain("—");
  expect(text).not.toMatch(/\bnot\b[^.?!]+?\bbut\b/i);
}

describe("buildDayBriefing", () => {
  test("compares today's planned energy with recent closed days", () => {
    const latest = stat({
      id: "today",
      startedAt: "2026-07-10T09:00:00.000Z",
      phase: "plan",
      plannedTotal: 80,
      withdrawalTotal: 55,
      depositTotal: 25,
      closingBalance: 70,
      availableCapacity: 45,
      taskCount: 4,
      completedCount: 1,
    });
    const history = [50, 60, 70].map((plannedTotal, index) =>
      stat({
        id: `prior-${index}`,
        startedAt: `2026-07-0${index + 1}T09:00:00.000Z`,
        plannedTotal,
        withdrawalTotal: plannedTotal - 10,
        depositTotal: 10,
        closingBalance: 100 - index * 5,
      }),
    );

    const briefing = buildDayBriefing(latest, history);

    expect(briefing.headline).toContain("80 points planned today");
    expect(briefing.headline).toContain("20 above your recent closed-day average");
    expect(briefing.completionText).toBe("1 of 4 planned lines completed today.");
    expect(briefing.chartRows.find((row) => row.id === "planned-use")?.compare).toContain(
      "above your recent use average",
    );
    expectProfileCopy(`${briefing.headline} ${briefing.insight}`);
  });

  test("surfaces a repeated activity moving between columns from the previous closed day", () => {
    const latest = stat({
      id: "today",
      startedAt: "2026-07-10T09:00:00.000Z",
      phase: "plan",
      plannedTotal: 30,
      withdrawalTotal: 30,
      lines: [
        {
          side: "withdrawal",
          labelHash: "walk",
          label: "Walk around the block",
          plannedCost: 30,
        },
      ],
    });
    const history = [
      stat({
        id: "prior",
        startedAt: "2026-07-09T09:00:00.000Z",
        lines: [
          {
            side: "deposit",
            labelHash: "walk",
            label: "Walk around the block",
            plannedCost: 20,
          },
        ],
      }),
    ];

    const briefing = buildDayBriefing(latest, history);

    expect(briefing.insight).toContain("Walk around the block moved to Use energy today");
    expect(briefing.insight).toContain("Add energy on the previous closed day");
    expectProfileCopy(briefing.insight);
  });
});

describe("buildTrendNarrative", () => {
  test("replaces generic trend language with a concrete interpretation", () => {
    const metrics: TrendMetric[] = [
      { label: "Energy at close", tone: "signed", recent: 87, delta: -62 },
      { label: "Attwood net", tone: "signed", recent: -13, delta: -62 },
      { label: "Energy added / day", tone: "neutral", recent: 79, delta: -29 },
      { label: "Energy used / day", tone: "neutral", recent: 92, delta: 33 },
    ];

    const narrative = buildTrendNarrative(metrics, 13);

    expect(narrative).toContain("Your average close across the last seven closed days is 87");
    expect(narrative).toContain("energy used rose by 33 points per day");
    expect(narrative).toContain("next useful check");
    expectProfileCopy(narrative);
  });
});
