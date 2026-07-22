import { describe, expect, test } from "bun:test";
import {
  addableRecent,
  filterUnusedRecent,
  recentDisabledReason,
  shouldShowColumnRecent,
} from "./planShortcuts";

describe("recentDisabledReason", () => {
  test("allows choices that fit available capacity", () => {
    expect(recentDisabledReason(20, 20, "plan")).toBeNull();
    expect(recentDisabledReason(5, 40, "audit")).toBeNull();
  });

  test("explains over-capacity choices on a live day", () => {
    expect(recentDisabledReason(30, 10, "plan")).toBe(
      "Needs 30 points, only 10 available",
    );
  });

  test("never blocks closed-day amendments", () => {
    expect(recentDisabledReason(90, 0, "closed")).toBeNull();
  });

  test("never blocks deposits: adds restore energy, they do not reserve it", () => {
    expect(recentDisabledReason(90, 0, "plan", "deposit")).toBeNull();
  });
});

describe("filterUnusedRecent", () => {
  test("drops items already on the board by hash or label", () => {
    const recent = [
      { id: "a", side: "withdrawal" as const, label: "Made Bed", labelHash: "h1", typicalCost: 20 },
      { id: "b", side: "withdrawal" as const, label: "Workout", labelHash: "h2", typicalCost: 20 },
      { id: "c", side: "deposit" as const, label: "Walk", labelHash: "h3", typicalCost: 20 },
    ];
    const unused = filterUnusedRecent(recent, [
      { side: "withdrawal", labelHash: "h1", label: "Made Bed" },
      { side: "deposit", label: "walk" },
    ]);
    expect(unused.map((s) => s.id)).toEqual(["b"]);
  });
});

describe("shouldShowColumnRecent", () => {
  test("withdrawals need leftover capacity; deposits do not", () => {
    expect(
      shouldShowColumnRecent({
        closed: false,
        phase: "plan",
        side: "withdrawal",
        availableCapacity: 0,
        unusedCount: 3,
      }),
    ).toBe(false);
    expect(
      shouldShowColumnRecent({
        closed: false,
        phase: "plan",
        side: "withdrawal",
        availableCapacity: 10,
        unusedCount: 3,
      }),
    ).toBe(true);
    expect(
      shouldShowColumnRecent({
        closed: false,
        phase: "plan",
        side: "deposit",
        availableCapacity: 0,
        unusedCount: 2,
      }),
    ).toBe(true);
  });

  test("closed-day amendments still show withdrawal suggestions at zero capacity", () => {
    expect(
      shouldShowColumnRecent({
        closed: false,
        phase: "closed",
        side: "withdrawal",
        availableCapacity: 0,
        unusedCount: 2,
      }),
    ).toBe(true);
  });

  test("hides when closed or empty", () => {
    expect(
      shouldShowColumnRecent({
        closed: true,
        phase: "plan",
        side: "deposit",
        availableCapacity: 50,
        unusedCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldShowColumnRecent({
        closed: false,
        phase: "plan",
        side: "deposit",
        availableCapacity: 50,
        unusedCount: 0,
      }),
    ).toBe(false);
  });
});

describe("addableRecent", () => {
  test("packs withdrawals in order without exceeding capacity", () => {
    const recent = [
      { id: "a", side: "withdrawal" as const, label: "A", typicalCost: 20 },
      { id: "b", side: "withdrawal" as const, label: "B", typicalCost: 30 },
      { id: "c", side: "withdrawal" as const, label: "C", typicalCost: 20 },
    ];
    expect(addableRecent(recent, 40, "plan").map((s) => s.id)).toEqual(["a", "c"]);
  });

  test("deposits all add even at zero available", () => {
    const recent = [
      { id: "a", side: "deposit" as const, label: "A", typicalCost: 20 },
      { id: "b", side: "deposit" as const, label: "B", typicalCost: 90 },
    ];
    expect(addableRecent(recent, 0, "plan").map((s) => s.id)).toEqual(["a", "b"]);
  });
});
