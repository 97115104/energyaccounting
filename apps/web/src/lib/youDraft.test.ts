import { describe, expect, test } from "bun:test";
import type { PersonalData, PersonalDay } from "./personalData";
import { draftWorkWithYou, extractYouFeatures } from "./youDraft";

function day(over: Partial<PersonalDay>): PersonalDay {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    date: over.date ?? "2026-01-05",
    phase: over.phase ?? "closed",
    feelRating: over.feelRating ?? null,
    openingBalance: 100,
    closingBalance: over.closingBalance ?? 80,
    attwoodNet: over.attwoodNet ?? 0,
    depositTotal: 0,
    withdrawalTotal: 0,
    journal: over.journal ?? null,
    compensateNote: null,
    tasks: over.tasks ?? [],
  };
}

function data(over: Partial<PersonalData>): PersonalData {
  return {
    schemaVersion: 1,
    exportedAt: "2026-01-06T00:00:00Z",
    user: {},
    catalog: over.catalog ?? [],
    days: over.days ?? [],
  };
}

describe("youDraft", () => {
  test("thin history produces no draft lines", () => {
    expect(draftWorkWithYou(data({}))).toEqual([]);
  });

  test("recurring givers become a support line with evidence", () => {
    const d = data({
      catalog: [
        { side: "deposit", label: "Walk", useCount: 8, typicalDifficulty: null, difficultyCount: 0 },
      ],
    });
    const lines = draftWorkWithYou(d);
    const support = lines.find((l) => l.field === "support");
    expect(support).toBeTruthy();
    expect(support!.text).toContain("Walk");
    expect(support!.because.join(" ")).toContain("8");
  });

  test("a hard withdrawal becomes a communication line", () => {
    const d = data({
      catalog: [
        {
          side: "withdrawal",
          label: "Big meeting",
          useCount: 6,
          typicalDifficulty: 8,
          difficultyCount: 4,
        },
      ],
    });
    const lines = draftWorkWithYou(d);
    const comms = lines.find((l) => l.field === "communication");
    expect(comms).toBeTruthy();
    expect(comms!.text).toContain("Big meeting");
  });

  test("dismissed ids are filtered out", () => {
    const d = data({
      catalog: [
        { side: "deposit", label: "Walk", useCount: 8, typicalDifficulty: null, difficultyCount: 0 },
      ],
    });
    const all = draftWorkWithYou(d);
    const dismissed = new Set(all.map((l) => l.id));
    expect(draftWorkWithYou(d, [], dismissed)).toEqual([]);
  });

  test("a draining weekday surfaces once enough closed days exist", () => {
    const mondays = Array.from({ length: 4 }, (_, i) =>
      // 2026-01-05 is a Monday.
      day({ date: "2026-01-05", attwoodNet: -30, id: `m${i}` }),
    );
    const others = Array.from({ length: 8 }, (_, i) =>
      day({ date: "2026-01-07", attwoodNet: 10, id: `w${i}` }),
    );
    const f = extractYouFeatures(data({ days: [...mondays, ...others] }));
    expect(f.heavyWeekday?.day).toBe("Monday");
  });

  test("is deterministic for the same input", () => {
    const d = data({
      catalog: [
        { side: "deposit", label: "Walk", useCount: 8, typicalDifficulty: null, difficultyCount: 0 },
        { side: "withdrawal", label: "Errands", useCount: 5, typicalDifficulty: 6, difficultyCount: 3 },
      ],
    });
    expect(draftWorkWithYou(d)).toEqual(draftWorkWithYou(d));
  });
});
