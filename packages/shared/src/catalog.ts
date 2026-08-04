import type { TaskSide } from "./balance";

export type CatalogLine = Readonly<{
  side: TaskSide;
  labelCiphertext: string;
  labelIv: string;
  labelHash: string;
  plannedCost: number;
  difficulty: number | null;
}>;

export type CatalogOccurrence = Readonly<{ date: string; line: CatalogLine }>;

export type FoldedCatalogEntry = Readonly<{
  side: TaskSide;
  labelCiphertext: string;
  labelIv: string;
  labelHash: string;
  typicalCost: number;
  weekdayMask: number;
  useCount: number;
  difficultyTotal: number;
  difficultyCount: number;
  lastUsed: string;
}>;

export function weekdayBit(dateIso: string): number {
  return 1 << new Date(`${dateIso}T12:00:00Z`).getUTCDay();
}

/** Fold retained source lines into their fully-derived activity catalog. */
export function foldCatalog(occurrences: readonly CatalogOccurrence[]): FoldedCatalogEntry[] {
  const entries = new Map<string, FoldedCatalogEntry>();
  for (const { date, line } of occurrences) {
    if (!line.labelHash) continue;
    const key = `${line.side}:${line.labelHash}`;
    const current = entries.get(key);
    entries.set(key, {
      side: line.side,
      labelCiphertext: line.labelCiphertext,
      labelIv: line.labelIv,
      labelHash: line.labelHash,
      typicalCost: line.plannedCost,
      weekdayMask: (current?.weekdayMask ?? 0) | weekdayBit(date),
      useCount: (current?.useCount ?? 0) + 1,
      difficultyTotal: (current?.difficultyTotal ?? 0) + (line.difficulty ?? 0),
      difficultyCount: (current?.difficultyCount ?? 0) + (line.difficulty === null ? 0 : 1),
      lastUsed: date,
    });
  }
  return [...entries.values()];
}
