import { afterEach, describe, expect, test } from "bun:test";
import { decryptText, generateDek, setSessionDek } from "./crypto";
import {
  corpusPreviewRequest,
  parseTrainingCorpus,
  prepareCorpusRestore,
} from "./exportCorpus";

function v6Corpus(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 6,
    exportedAt: "2026-07-02T12:00:00.000Z",
    purpose: "personal energy accounting corpus for optional future model training",
    user: {
      id: "old-user",
      timezone: "America/Los_Angeles",
      lat: 37.77,
      lon: -122.42,
      country: "US",
      identity: null,
    },
    youProfile: {
      version: 1,
      about: "Direct is kind.",
      communication: "Write it down.",
      support: "Quiet time.",
      traits: [],
      dismissedTraitIds: [],
      colorMeanings: [],
      autoDraft: true,
      dismissedDraftIds: [],
    },
    days: [
      {
        id: "old-day",
        date: "2026-07-01",
        startedAt: "2026-07-01T08:00:00.000Z",
        openingBalance: 100,
        closingBalance: 120,
        projectedClosing: 120,
        availableCapacity: 100,
        phase: "closed",
        feelRating: 7,
        weather: null,
        isHoliday: false,
        attwood: { attwoodNet: 20 },
        journal: "A good, quiet day.",
        compensateNote: null,
        lines: [
          {
            id: "old-line",
            side: "deposit",
            sort: 0,
            label: "Tea",
            labelHash: "tea-hash",
            plannedCost: 20,
            actualCost: 20,
            completed: true,
            difficulty: 2,
            details: "Slowly.",
          },
        ],
      },
    ],
    catalog: [],
    ...overrides,
  };
}

afterEach(() => setSessionDek(null));

describe("training corpus restore preparation", () => {
  test("normalizes v6 exports with stable ids and lifecycle compatibility timestamps", () => {
    const corpus = parseTrainingCorpus(v6Corpus());
    expect(corpus.schemaVersion).toBe(6);
    expect(corpus.user.onboardingCompleted).toBe(true);
    expect(corpus.user.locationPrompted).toBe(true);
    expect(corpus.days[0]?.sourceId).toBe("old-day");
    expect(corpus.days[0]?.closedAt).toBe("2026-07-01T08:00:00.000Z");
    expect(corpus.days[0]?.lines[0]?.sourceId).toBe("old-line");
    expect(corpus.days[0]?.lines[0]?.completedAt).toBe("2026-07-01T08:00:00.000Z");
    expect(corpusPreviewRequest(corpus)).toEqual({
      days: [{ sourceId: "old-day", phase: "closed", lineSourceIds: ["old-line"] }],
      hasProfile: true,
    });
  });

  test("rejects duplicate source ids before any corpus data is uploaded", () => {
    const duplicate = v6Corpus({
      days: [
        v6Corpus().days[0],
        { ...v6Corpus().days[0], id: "old-day" },
      ],
    });
    expect(() => parseTrainingCorpus(duplicate)).toThrow("duplicate day source ids");
  });

  test("re-encrypts every private value under the destination account key", async () => {
    const destinationDek = await generateDek();
    const otherDek = await generateDek();
    setSessionDek(destinationDek);
    const corpus = parseTrainingCorpus(v6Corpus());
    const wire = await prepareCorpusRestore(corpus, "replace");
    const day = wire.days[0]!;
    const line = day.lines[0]!;
    expect(await decryptText(destinationDek, line.labelCiphertext, line.labelIv, "eaj-label")).toBe("Tea");
    expect(await decryptText(destinationDek, day.journalCiphertext!, day.journalIv!, "eaj-journal")).toBe(
      "A good, quiet day.",
    );
    expect(await decryptText(destinationDek, line.detailsCiphertext!, line.detailsIv!, "eaj-task-details")).toBe("Slowly.");
    await expect(decryptText(otherDek, line.labelCiphertext, line.labelIv, "eaj-label")).rejects.toThrow();
  });
});
