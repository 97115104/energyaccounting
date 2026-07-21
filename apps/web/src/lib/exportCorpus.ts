import { decryptText, getSessionDek } from "./crypto";
import { api } from "./api";
import type { CatalogEntry } from "./butterflyTraits";
import { loadPersonalData } from "./personalData";
import { decryptYouProfile, type YouProfile } from "./youProfile";

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
  difficulty: number | null;
  detailsCiphertext: string | null;
  detailsIv: string | null;
  label?: string;
};

type ExportDay = {
  id: string;
  date: string;
  startedAt: string;
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

type ExportPayload = {
  schemaVersion: number;
  exportedAt: string;
  user: Record<string, unknown>;
  days: ExportDay[];
  catalog: Array<{
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
  }>;
};

/**
 * Decrypted activity catalog for on-device intelligence (trait suggestions).
 * Delegates to the shared personal-data loader so there is one decrypt path.
 */
export async function fetchDecryptedCatalog(): Promise<CatalogEntry[]> {
  const data = await loadPersonalData();
  return data.catalog;
}

/** Decrypted You profile for the corpus; null when none is saved yet. */
async function fetchDecryptedYouProfile(dek: CryptoKey): Promise<YouProfile | null> {
  const res = await api<{ profile: { ciphertext: string; iv: string } | null }>(
    "/api/you/profile",
  );
  if (!res.profile) return null;
  try {
    return await decryptYouProfile(dek, res.profile.ciphertext, res.profile.iv);
  } catch {
    return null;
  }
}

/** Fetch encrypted export, decrypt labels and journals with the session DEK, download JSON. */
export async function downloadTrainingCorpus(): Promise<void> {
  const dek = getSessionDek();
  if (!dek) throw new Error("Unlock your journal key before exporting.");

  const raw = await api<ExportPayload>("/api/export/days");
  const days = [];
  for (const d of raw.days) {
    const lines = [];
    for (const l of d.lines) {
      let label = "";
      try {
        label = await decryptText(dek, l.labelCiphertext, l.labelIv, "eaj-label");
      } catch {
        label = "";
      }
      let details: string | null = null;
      if (l.detailsCiphertext && l.detailsIv) {
        try {
          details = await decryptText(
            dek,
            l.detailsCiphertext,
            l.detailsIv,
            "eaj-task-details",
          );
        } catch {
          details = null;
        }
      }
      lines.push({
        id: l.id,
        side: l.side,
        sort: l.sort,
        label,
        labelHash: l.labelHash,
        plannedCost: l.plannedCost,
        actualCost: l.actualCost,
        completed: l.completed,
        difficulty: l.difficulty,
        details,
      });
    }
    let journal: string | null = null;
    if (d.journalCiphertext && d.journalIv) {
      try {
        journal = await decryptText(dek, d.journalCiphertext, d.journalIv, "eaj-journal");
      } catch {
        journal = null;
      }
    }
    let compensate: string | null = null;
    if (d.compensateNoteCiphertext && d.compensateNoteIv) {
      try {
        compensate = await decryptText(
          dek,
          d.compensateNoteCiphertext,
          d.compensateNoteIv,
          "eaj-compensate",
        );
      } catch {
        compensate = null;
      }
    }
    days.push({
      id: d.id,
      date: d.date,
      startedAt: d.startedAt,
      openingBalance: d.openingBalance,
      closingBalance: d.closingBalance,
      projectedClosing: d.projectedClosing,
      availableCapacity: d.availableCapacity,
      phase: d.phase,
      feelRating: d.feelRating,
      weather: d.weather,
      isHoliday: d.isHoliday,
      attwood: d.attwood,
      journal,
      compensateNote: compensate,
      lines,
    });
  }

  const catalog = [];
  for (const c of raw.catalog) {
    let label = "";
    try {
      label = await decryptText(dek, c.labelCiphertext, c.labelIv, "eaj-label");
    } catch {
      label = "";
    }
    catalog.push({
      id: c.id,
      side: c.side,
      label,
      labelHash: c.labelHash,
      typicalCost: c.typicalCost,
      weekdayMask: c.weekdayMask,
      useCount: c.useCount,
      typicalDifficulty: c.typicalDifficulty,
      difficultyCount: c.difficultyCount,
      lastUsed: c.lastUsed,
    });
  }

  // The You profile and identity ride along so the corpus captures the whole
  // person, ready for the future personal machine intelligence.
  const youProfile = await fetchDecryptedYouProfile(dek);

  const corpus = {
    schemaVersion: raw.schemaVersion,
    exportedAt: raw.exportedAt,
    purpose: "personal energy accounting corpus for optional future model training",
    user: raw.user,
    youProfile,
    days,
    catalog,
  };

  const blob = new Blob([JSON.stringify(corpus, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `eaj-corpus-${raw.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
