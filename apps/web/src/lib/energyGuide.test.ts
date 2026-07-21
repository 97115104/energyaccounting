import { describe, expect, test } from "bun:test";
import type { ActivityCandidate } from "./activitySuggest";
import {
  buildGuide,
  nextIsoDate,
  recoveryPlan,
  type GuideContext,
  type RecoveryContext,
} from "./energyGuide";
import type { StatPoint } from "./insights";

function guideContext(overrides: Partial<GuideContext> = {}): GuideContext {
  return {
    date: "2026-07-20",
    available: 40,
    depositTotal: 20,
    withdrawalTotal: 20,
    incompleteWithdrawals: 0,
    weatherKind: "sun",
    uvMax: 1,
    isDaylight: true,
    withdrawalHeavy: false,
    existingLabels: [],
    candidates: [],
    ...overrides,
  };
}

function candidate(overrides: Partial<ActivityCandidate> = {}): ActivityCandidate {
  return {
    id: "c1",
    side: "deposit",
    label: "Quiet pause",
    typicalCost: 10,
    weekdayMask: 127,
    useCount: 5,
    typicalDifficulty: 2,
    difficultyCount: 4,
    lastUsed: "2026-07-19",
    ...overrides,
  };
}

function statDay(date: string, overrides: Partial<StatPoint> = {}): StatPoint {
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

function recoveryContext(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    date: "2026-07-20",
    feelRating: 7,
    openingBalance: 100,
    closingBalance: 100,
    plannedTotal: 40,
    actualTotal: 40,
    incompleteWithdrawals: 0,
    series: [],
    candidates: [],
    ...overrides,
  };
}

describe("buildGuide", () => {
  test("a just-freed event always leads as the primary item", () => {
    const guide = buildGuide(guideContext({ justFreed: 15 }));
    expect(guide.primary?.id).toBe("event:freed");
    expect(guide.primary?.because[0]).toContain("15 points");
  });

  test("deterministic: identical context yields identical guides", () => {
    const ctx = guideContext({ withdrawalHeavy: true, withdrawalTotal: 40 });
    const a = buildGuide(ctx);
    const b = buildGuide(ctx);
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
  });

  test("dismissed items disappear and the next item takes primary", () => {
    const withEvent = buildGuide(guideContext({ justFreed: 10 }));
    expect(withEvent.primary?.id).toBe("event:freed");
    const dismissed = buildGuide(
      guideContext({ justFreed: 10, dismissedIds: new Set(["event:freed"]) }),
    );
    expect(dismissed.items.map((i) => i.id)).not.toContain("event:freed");
    expect(dismissed.primary?.id).not.toBe("event:freed");
  });

  test("actionable items never repeat labels already on the ledger", () => {
    const guide = buildGuide(
      guideContext({
        existingLabels: ["Take a short walk"],
        candidates: [candidate({ label: "Take a short walk" })],
      }),
    );
    const labels = guide.items
      .filter((i) => i.action && !i.action.targetDate)
      .map((i) => i.action!.label.toLowerCase());
    expect(labels).not.toContain("take a short walk");
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("play deposits over remaining capacity are excluded", () => {
    const guide = buildGuide(
      guideContext({ withdrawalHeavy: true, withdrawalTotal: 60, available: 5 }),
    );
    for (const item of guide.items) {
      if (item.kind === "play" && item.action) {
        expect(item.action.cost).toBeLessThanOrEqual(5);
      }
    }
  });

  test("low-signal context produces no interrupting primary", () => {
    // Night, unknown UV, nothing on the ledger, no capacity: sheet-only content.
    const guide = buildGuide(
      guideContext({
        available: 0,
        isDaylight: false,
        uvMax: null,
        weatherKind: "cloud",
        depositTotal: 0,
        withdrawalTotal: 0,
      }),
    );
    expect(guide.primary).toBeNull();
  });

  test("familiar activities are marked personalized without a research label", () => {
    const guide = buildGuide(
      guideContext({ candidates: [candidate({ label: "Evening tea" })] }),
    );
    const familiar = guide.items.find((i) => i.id === "activity:familiar:c1");
    expect(familiar?.personalized).toBe(true);
    expect(familiar?.research).toBeUndefined();
    for (const item of guide.items.filter((i) => i.kind === "context")) {
      expect(item.personalized).toBe(false);
      expect(item.research).toBeTruthy();
    }
  });

  test("tomorrow capacity uses openingBalance(100 + closing)", () => {
    const plan = recoveryPlan(
      recoveryContext({
        feelRating: 2,
        closingBalance: 40,
        candidates: [candidate({ typicalCost: 20 })],
      }),
    );
    expect(plan?.action?.label).toBe("Quiet pause");
    expect(plan?.because.some((b) => b.includes("140"))).toBe(true);
  });

  test("caps the sheet and gives every item at least one concrete reason", () => {
    const guide = buildGuide(
      guideContext({
        justFreed: 10,
        withdrawalHeavy: true,
        withdrawalTotal: 60,
        incompleteWithdrawals: 4,
        candidates: [candidate()],
        planningHint: { id: "weekday-pattern", tone: "gentle", text: "Mondays run heavy." },
      }),
    );
    expect(guide.items.length).toBeLessThanOrEqual(6);
    for (const item of guide.items) {
      expect(item.because.length).toBeGreaterThan(0);
    }
  });
});

describe("nextIsoDate", () => {
  test("rolls over month and year boundaries", () => {
    expect(nextIsoDate("2026-07-31")).toBe("2026-08-01");
    expect(nextIsoDate("2026-12-31")).toBe("2027-01-01");
  });
});

describe("recoveryPlan", () => {
  test("silent when today gives no evidence recovery is needed", () => {
    expect(recoveryPlan(recoveryContext())).toBeNull();
  });

  test("one weak signal alone is not enough", () => {
    expect(recoveryPlan(recoveryContext({ incompleteWithdrawals: 3 }))).toBeNull();
  });

  test("a rough feel rating fires with the exact number in the reasons", () => {
    const plan = recoveryPlan(recoveryContext({ feelRating: 3 }));
    expect(plan).not.toBeNull();
    expect(plan!.because.some((b) => b.includes("3/10"))).toBe(true);
  });

  test("a real deficit fires and quantifies the gap", () => {
    const plan = recoveryPlan(
      recoveryContext({ openingBalance: 100, closingBalance: 76 }),
    );
    expect(plan).not.toBeNull();
    expect(plan!.because.some((b) => b.includes("24 points below"))).toBe(true);
  });

  test("two weak signals combine to fire", () => {
    const plan = recoveryPlan(
      recoveryContext({ incompleteWithdrawals: 3, plannedTotal: 40, actualTotal: 60 }),
    );
    expect(plan).not.toBeNull();
  });

  test("picks a familiar low-difficulty deposit that fits tomorrow's capacity", () => {
    const plan = recoveryPlan(
      recoveryContext({
        feelRating: 2,
        closingBalance: 30,
        candidates: [
          candidate({ id: "tea", label: "Evening tea", typicalCost: 10 }),
          candidate({
            id: "hike",
            label: "Long hike",
            typicalCost: 24,
            typicalDifficulty: 8,
            useCount: 2,
            difficultyCount: 4,
          }),
        ],
      }),
    );
    expect(plan?.action?.label).toBe("Evening tea");
    expect(plan?.action?.targetDate).toBe("2026-07-21");
    expect(plan?.because.some((b) => b.includes("5×"))).toBe(true);
  });

  test("suggests a buffer when no familiar deposit fits tomorrow opening", () => {
    const plan = recoveryPlan(
      recoveryContext({
        feelRating: 2,
        closingBalance: 5,
        candidates: [],
      }),
    );
    expect(plan).not.toBeNull();
    expect(plan!.action).toBeUndefined();
    expect(plan!.body).toContain("buffer");
  });

  test("negative closing still allows deposits within tomorrow opening", () => {
    const plan = recoveryPlan(
      recoveryContext({
        feelRating: 2,
        closingBalance: -5,
        candidates: [candidate({ typicalCost: 10 })],
      }),
    );
    expect(plan?.action?.label).toBe("Quiet pause");
    expect(plan?.because.some((b) => b.includes("95"))).toBe(true);
  });

  test("a historically heavy tomorrow counts as a weak signal", () => {
    // 2026-07-21 is a Tuesday; make Tuesdays reliably net-negative.
    const series: StatPoint[] = [];
    const start = new Date("2026-06-20T12:00:00Z");
    for (let i = 0; i < 28; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const isTuesday = d.getUTCDay() === 2;
      series.push(statDay(iso, { attwoodNet: isTuesday ? -30 : 5 }));
    }
    const plan = recoveryPlan(
      recoveryContext({ series, incompleteWithdrawals: 3 }),
    );
    expect(plan).not.toBeNull();
    expect(plan!.because.some((b) => b.includes("Tuesday"))).toBe(true);
  });
});
