/**
 * The personal-data boundary: decrypt the export once into a typed in-memory
 * model that on-device intelligence can consume.
 *
 * This is the single place that turns the encrypted `/api/export/days` payload
 * into plaintext. Nothing here is cached to disk; the decrypted model lives only
 * for the life of the call's consumers. AAD values are required at each call so
 * a wrong label can never silently decrypt.
 */

import { api } from "./api";
import type { CatalogEntry } from "./butterflyTraits";
import { decryptText, getSessionDek } from "./crypto";
import { mapConcurrent } from "@eaj/shared";
import { personalDataGeneration } from "./personalDataCache";

export const AAD = {
  label: "eaj-label",
  taskDetails: "eaj-task-details",
  journal: "eaj-journal",
  compensate: "eaj-compensate",
} as const;

type ExportLine = {
  id: string;
  side: string;
  sort: number;
  labelCiphertext: string;
  labelIv: string;
  labelHash: string;
  plannedCost: number;
  actualCost: number | null;
  completed: boolean;
  completedAt?: string | null;
  difficulty: number | null;
  detailsCiphertext: string | null;
  detailsIv: string | null;
};

type ExportDay = {
  id: string;
  date: string;
  startedAt: string;
  closedAt?: string | null;
  durationMinutes?: number | null;
  openingBalance: number;
  closingBalance: number | null;
  projectedClosing: number;
  availableCapacity: number;
  phase: string;
  feelRating: number | null;
  weather: unknown;
  isHoliday: boolean;
  attwood: unknown;
  journalCiphertext: string | null;
  journalIv: string | null;
  compensateNoteCiphertext: string | null;
  compensateNoteIv: string | null;
  lines: ExportLine[];
};

type ExportCatalog = {
  id: string;
  side: string;
  labelCiphertext: string;
  labelIv: string;
  labelHash: string;
  typicalCost: number;
  weekdayMask: number;
  useCount: number;
  typicalDifficulty: number | null;
  difficultyCount: number;
  lastUsed: string;
};

export type ExportPayload = {
  schemaVersion: number;
  exportedAt: string;
  user: Record<string, unknown>;
  days: ExportDay[];
  catalog: ExportCatalog[];
};

/** A decrypted task line for a single day. */
export type PersonalTask = {
  side: "deposit" | "withdrawal" | string;
  label: string;
  plannedCost: number;
  actualCost: number | null;
  completed: boolean;
  completedAt: string | null;
  difficulty: number | null;
  details: string | null;
};

/** A decrypted day with its numeric fields and plaintext journal. */
export type PersonalDay = {
  id: string;
  date: string;
  phase: string;
  startedAt: string;
  closedAt: string | null;
  durationMinutes: number | null;
  feelRating: number | null;
  openingBalance: number;
  closingBalance: number | null;
  attwoodNet: number;
  depositTotal: number;
  withdrawalTotal: number;
  journal: string | null;
  compensateNote: string | null;
  tasks: PersonalTask[];
};

export type PersonalData = {
  schemaVersion: number;
  exportedAt: string;
  user: Record<string, unknown>;
  catalog: CatalogEntry[];
  days: PersonalDay[];
};

/** Decrypt one optional labelled field, returning null on any failure. */
async function decryptOptional(
  dek: CryptoKey,
  ciphertext: string | null,
  iv: string | null,
  aad: string,
): Promise<string | null> {
  if (!ciphertext || !iv) return null;
  try {
    return await decryptText(dek, ciphertext, iv, aad);
  } catch {
    return null;
  }
}

function attwoodOf(day: ExportDay): { net: number; deposit: number; withdrawal: number } {
  const a = (day.attwood ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    net: num(a.attwoodNet),
    deposit: num(a.depositTotal),
    withdrawal: num(a.withdrawalTotal),
  };
}

/**
 * Load and decrypt everything the on-device intelligence needs, once.
 * O(days + tasks + catalog) decrypt operations.
 */
let cachedPersonalData: { dek: CryptoKey; generation: number; value: Promise<PersonalData> } | null = null;

async function loadPersonalDataUncached(dek: CryptoKey): Promise<PersonalData> {
  const raw = await api<ExportPayload>("/api/export/days");

  const catalog = (await mapConcurrent(raw.catalog, 4, async (c) => {
    const label = await decryptOptional(dek, c.labelCiphertext, c.labelIv, AAD.label);
    return label ? {
      side: c.side as CatalogEntry["side"],
      label,
      useCount: c.useCount,
      typicalDifficulty: c.typicalDifficulty,
      difficultyCount: c.difficultyCount,
    } : null;
  })).filter((entry): entry is CatalogEntry => entry !== null);

  const days = await mapConcurrent(raw.days, 4, async (d): Promise<PersonalDay> => {
    const tasks = await mapConcurrent(d.lines, 4, async (l): Promise<PersonalTask> => {
      const label = (await decryptOptional(dek, l.labelCiphertext, l.labelIv, AAD.label)) ?? "";
      const details = await decryptOptional(dek, l.detailsCiphertext, l.detailsIv, AAD.taskDetails);
      return {
        side: l.side,
        label,
        plannedCost: l.plannedCost,
        actualCost: l.actualCost,
        completed: l.completed,
        completedAt: l.completedAt ?? null,
        difficulty: l.difficulty,
        details,
      };
    });
    const attwood = attwoodOf(d);
    return {
      id: d.id,
      date: d.date,
      phase: d.phase,
      startedAt: d.startedAt,
      closedAt: d.closedAt ?? null,
      durationMinutes: d.durationMinutes ?? null,
      feelRating: d.feelRating,
      openingBalance: d.openingBalance,
      closingBalance: d.closingBalance,
      attwoodNet: attwood.net,
      depositTotal: attwood.deposit,
      withdrawalTotal: attwood.withdrawal,
      journal: await decryptOptional(dek, d.journalCiphertext, d.journalIv, AAD.journal),
      compensateNote: await decryptOptional(
        dek,
        d.compensateNoteCiphertext,
        d.compensateNoteIv,
        AAD.compensate,
      ),
      tasks,
    };
  });

  return {
    schemaVersion: raw.schemaVersion,
    exportedAt: raw.exportedAt,
    user: raw.user,
    catalog,
    days,
  };
}

/**
 * Load and decrypt everything the on-device intelligence needs. The snapshot
 * is retained only in memory and is discarded after any source/key mutation.
 */
export async function loadPersonalData(): Promise<PersonalData> {
  const dek = getSessionDek();
  if (!dek) throw new Error("Unlock your journal key first.");
  const generation = personalDataGeneration();
  if (cachedPersonalData?.dek === dek && cachedPersonalData.generation === generation) {
    return cachedPersonalData.value;
  }
  const value = loadPersonalDataUncached(dek);
  cachedPersonalData = { dek, generation, value };
  try {
    return await value;
  } catch (error) {
    if (cachedPersonalData?.value === value) cachedPersonalData = null;
    throw error;
  }
}
