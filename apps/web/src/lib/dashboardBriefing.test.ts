import { describe, expect, test } from "bun:test";
import {
  buildDayBriefing,
  buildTrendNarrative,
  chooseDashboardRange,
  type TrendMetric,
} from "./dashboardBriefing";
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

function addDays(dateIso: string, offset: number) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function closedStatOn(dateIso: string, index: number) {
  return stat({
    id: `closed-${index}`,
    date: dateIso,
    startedAt: `${dateIso}T09:00:00.000Z`,
    closedAt: `${dateIso}T20:00:00.000Z`,
  });
}

function closedSeries(startIso: string, count: number, everyDays = 1) {
  return Array.from({ length: count }, (_, index) =>
    closedStatOn(addDays(startIso, index * everyDays), index),
  );
}

describe("chooseDashboardRange", () => {
  test("defaults to day when comparison ranges do not have useful history", () => {
    expect(chooseDashboardRange([], "2026-08-04")).toBe("day");
    expect(chooseDashboardRange(closedSeries("2026-08-03", 1), "2026-08-04")).toBe("day");
  });

  test("uses week when the last seven days have a small trend sample", () => {
    const points = ["2026-07-29", "2026-08-01", "2026-08-03"].map(closedStatOn);

    expect(chooseDashboardRange(points, "2026-08-04")).toBe("week");
  });

  test("ranges overnight days by their close time rather than their start date", () => {
    const points = [
      stat({
        id: "overnight",
        date: "2026-07-27",
        startedAt: "2026-07-27T23:30:00.000Z",
        closedAt: "2026-08-01T01:00:00.000Z",
      }),
      closedStatOn("2026-08-02", 2),
      closedStatOn("2026-08-03", 3),
    ];
    expect(chooseDashboardRange(points, "2026-08-04")).toBe("week");
  });

  test("uses month when recent history spans enough days to be more informative", () => {
    const points = closedSeries("2026-07-10", 9, 3);

    expect(chooseDashboardRange(points, "2026-08-04")).toBe("month");
  });

  test("uses year when there is enough multi-month history", () => {
    const points = closedSeries("2026-03-01", 46, 3);

    expect(chooseDashboardRange(points, "2026-08-04")).toBe("year");
  });
});

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
