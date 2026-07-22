import { describe, expect, test } from "bun:test";
import type { ActivityCandidate } from "./activitySuggest";
import {
  buildGuide,
  nextIsoDate,
  recoveryPlan,
  type GuideContext,
  type GuideItem,
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
    uv: 1,
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
    id: overrides.id ?? `day-${date}`,
    date,
    startedAt: overrides.startedAt ?? `${date}T12:00:00.000Z`,
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
    dayId: "day-2026-07-20",
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

  test("includePhysicalActivities false drops outdoor walk tips and movement", () => {
    const guide = buildGuide(
      guideContext({
        includePhysicalActivities: false,
        weatherKind: "sun",
        uv: 1,
        isDaylight: true,
        available: 80,
      }),
    );
    const ids = guide.items.map((i) => i.id);
    expect(ids.some((id) => id.startsWith("activity:movement:"))).toBe(false);
    expect(ids).not.toContain("context:uv-low-walk");
    expect(ids).not.toContain("context:sun-general");
    expect(ids.some((id) => id.includes("healthy:short-walk"))).toBe(false);
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

  test("actionable items never repeat labels already on the day", () => {
    const guide = buildGuide(
      guideContext({
        existingLabels: ["Take a short walk"],
        candidates: [candidate({ label: "Take a short walk" })],
      }),
    );
    const labels = guide.items
      .filter((i) => i.action && !i.action.requiresStart)
      .map((i) => i.action!.label.toLowerCase());
    expect(labels).not.toContain("take a short walk");
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("play options that add too much energy for remaining capacity are excluded", () => {
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
    // Night, unknown UV, nothing on the day, no capacity: sheet-only content.
    const guide = buildGuide(
      guideContext({
        available: 0,
        isDaylight: false,
        uv: null,
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

  test("surplus capacity can recommend a way to use energy", () => {
    const guide = buildGuide(
      guideContext({
        available: 85,
        withdrawalHeavy: false,
        withdrawalTotal: 5,
        depositTotal: 10,
        candidates: [
          candidate({
            id: "write",
            side: "withdrawal",
            label: "Focused writing block",
            typicalCost: 20,
            useCount: 7,
            typicalDifficulty: 3,
            difficultyCount: 4,
          }),
        ],
      }),
    );
    const use = guide.items.find((i) => i.id === "activity:familiar-use:write");
    expect(use?.action?.side).toBe("withdrawal");
    expect(use?.action?.cost).toBe(20);
    expect(use?.title).toMatch(/use energy/i);
  });

  test("personal state selects a named, research-backed nourishment tip", () => {
    const guide = buildGuide(
      guideContext({
        firstName: "Alex",
        recentLowFeel: true,
        recentRatedSample: 3,
        weatherKind: "cloud",
        uv: null,
        isDaylight: false,
      }),
    );
    const item = guide.items.find((entry) => entry.id === "context:low-feel-nourish");
    expect(item?.body).toContain("Alex");
    expect(item?.personalized).toBe(true);
    expect(item?.research).toBeTruthy();
    expect(item?.because[0]).toContain("3 most recently rated");
  });

  test("heavy weekday personal tip uses the shared signal", () => {
    const guide = buildGuide(
      guideContext({
        heavyWeekday: "Monday",
        weatherKind: "cloud",
        uv: null,
        isDaylight: false,
      }),
    );
    const item = guide.items.find((entry) => entry.id === "context:heavy-weekday");
    expect(item?.body).toContain("Monday");
    expect(item?.personalized).toBe(true);
  });

  test("next day capacity is always 100", () => {
    const plan = recoveryPlan(
      recoveryContext({
        feelRating: 2,
        closingBalance: 40,
        candidates: [candidate({ typicalCost: 20 })],
      }),
    );
    expect(plan?.action?.label).toBe("Quiet pause");
    expect(plan?.action?.requiresStart).toBe(true);
    expect(plan?.because.some((b) => b.includes("100"))).toBe(true);
  });

  test("movement cards carry a primary dose and an equal gentler action", () => {
    const guide = buildGuide(guideContext());
    const movement = guide.items.find((i) => i.id.startsWith("activity:movement:"));
    expect(movement).toBeDefined();
    expect(movement!.action?.side).toBe("deposit");
    expect(movement!.altAction?.side).toBe("deposit");
    expect(movement!.altAction?.label).not.toBe(movement!.action?.label);
    expect(movement!.body).toContain("Either counts");
  });

  test("movement never interrupts inline, even as the only activity", () => {
    // available: 5 leaves only cost-5 movement doses; primary must stay null
    // unless something else earns it.
    const guide = buildGuide(
      guideContext({ available: 5, weatherKind: "cloud", uv: null, isDaylight: false }),
    );
    const movement = guide.items.find((i) => i.id.startsWith("activity:movement:"));
    expect(movement).toBeDefined();
    expect(movement!.score).toBeLessThan(45);
    expect(guide.primary?.id.startsWith("activity:movement:")).not.toBe(true);
  });

  test("a movement variant already on the day suppresses the whole family", () => {
    const base = buildGuide(guideContext());
    const movement = base.items.find((i) => i.id.startsWith("activity:movement:"))!;
    const guide = buildGuide(guideContext({ existingLabels: [movement.altAction!.label] }));
    expect(guide.items.some((i) => i.id === movement.id)).toBe(false);
  });

  test("a duplicated alternative is stripped and the body stops promising it", () => {
    const extra: GuideItem[] = [
      {
        id: "extra:first",
        kind: "activity",
        title: "First",
        body: "Quiet pause fits.",
        because: ["test"],
        personalized: false,
        action: { side: "deposit", label: "Quiet pause", cost: 5 },
        score: 99,
      },
      {
        id: "extra:dup",
        kind: "activity",
        title: "Second",
        body: "Do 3 push-ups, or quiet pause if that fits better. Either counts.",
        because: ["test"],
        personalized: false,
        action: { side: "deposit", label: "Do 3 push-ups", cost: 5 },
        altAction: { side: "deposit", label: "Quiet pause", cost: 5 },
        score: 98,
      },
    ];
    const guide = buildGuide(guideContext(), extra);
    const item = guide.items.find((i) => i.id === "extra:dup")!;
    // "Quiet pause" was claimed by the first card, so the second loses its
    // alternative and no longer promises one.
    expect(item.altAction).toBeUndefined();
    expect(item.body).not.toContain("quiet pause");
    // The stripped copy must not mutate what other calls would see: the same
    // context without the clash keeps its alternative.
    const clean = buildGuide(guideContext(), [extra[1]!]);
    expect(clean.items.find((i) => i.id === "extra:dup")?.altAction).toBeDefined();
  });

  test("full-history movement signals override day-scoped derivation", () => {
    const stepUp = { tier: 1 as const, uses: 5, familiar: true };
    const starter = { tier: 0 as const, uses: 0, familiar: false };
    const guide = buildGuide(
      guideContext({
        movement: [
          {
            familyId: "pushups",
            primary: stepUp,
            gentler: starter,
            because: ["You have logged push-ups 5×."],
          },
          { familyId: "jacks", primary: starter, gentler: starter, because: [] },
          { familyId: "squats", primary: starter, gentler: starter, because: [] },
        ],
      }),
    );
    const pushups = guide.items.find((i) => i.id === "activity:movement:pushups");
    if (pushups) {
      expect(pushups.action?.label).toBe("Do 8 push-ups");
      expect(pushups.altAction?.label).toBe("Do 5 wall push-ups");
      expect(pushups.personalized).toBe(true);
    } else {
      // Rotation picked another family for this date; those must stay starter.
      const other = guide.items.find((i) => i.id.startsWith("activity:movement:"));
      expect(other).toBeDefined();
      expect(other!.personalized).toBe(false);
    }
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
    expect(plan!.because.some((b) => b.includes("24 points spent"))).toBe(true);
  });

  test("two weak signals combine to fire", () => {
    const plan = recoveryPlan(
      recoveryContext({ incompleteWithdrawals: 3, plannedTotal: 40, actualTotal: 60 }),
    );
    expect(plan).not.toBeNull();
  });

  test("picks a familiar low-difficulty way to add energy for the next day", () => {
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
    expect(plan?.action?.requiresStart).toBe(true);
    expect(plan?.because.some((b) => b.includes("5×"))).toBe(true);
  });

  test("suggests a buffer when no familiar way to add energy fits the next day", () => {
    const plan = recoveryPlan(
      recoveryContext({
        feelRating: 2,
        closingBalance: 5,
        candidates: [],
      }),
    );
    expect(plan).not.toBeNull();
    expect(plan!.action).toBeUndefined();
    expect(plan!.body).toContain("fresh 100");
  });

  test("negative remaining still allows adding energy within a fresh 100", () => {
    const plan = recoveryPlan(
      recoveryContext({
        feelRating: 2,
        closingBalance: -5,
        candidates: [candidate({ typicalCost: 10 })],
      }),
    );
    expect(plan?.action?.label).toBe("Quiet pause");
    expect(plan?.because.some((b) => b.includes("100"))).toBe(true);
  });

  test("a historically heavy next-start weekday counts as a weak signal", () => {
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
      recoveryContext({ series, incompleteWithdrawals: 3, nextStartDate: "2026-07-21" }),
    );
    expect(plan).not.toBeNull();
    expect(plan!.because.some((b) => b.includes("Tuesday"))).toBe(true);
  });
});
