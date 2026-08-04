import { describe, expect, test } from "bun:test";
import { buildRestorePlan } from "./restorePlan.ts";

describe("buildRestorePlan", () => {
  const incoming = [
    { sourceId: "closed", phase: "closed", lines: [{ sourceId: "known" }, { sourceId: "new" }] },
    { sourceId: "open", phase: "plan", lines: [{ sourceId: "open-line" }] },
  ] as const;

  test("derives merge actions and idempotent line counts from source indexes", () => {
    const plan = buildRestorePlan(incoming, {
      dayIdBySource: new Map([["closed", "local-closed"]]),
      lineSourcesByDay: new Map([["local-closed", new Set(["known"])]]),
      activeDayId: null,
      activeDaySourceId: null,
    });
    expect(plan).toMatchObject({ daysToAdd: 1, daysExisting: 1, linesToAdd: 2, linesExisting: 1 });
    expect(plan.days[0]).toMatchObject({ action: "merge", lineSourceIdsToInsert: ["new"] });
  });

  test("requires an explicit resolution for a new active day and can skip it", () => {
    const plan = buildRestorePlan(incoming, {
      dayIdBySource: new Map(),
      lineSourcesByDay: new Map(),
      activeDayId: "current",
      activeDaySourceId: "current-source",
    });
    expect(plan.activeDayConflict).toBe(true);
    const kept = buildRestorePlan(incoming, {
      dayIdBySource: new Map(),
      lineSourcesByDay: new Map(),
      activeDayId: "current",
      activeDaySourceId: "current-source",
    }, "keep-current");
    expect(kept.daysSkippedForActiveConflict).toBe(1);
    expect(kept.linesToAdd).toBe(2);
  });
});
