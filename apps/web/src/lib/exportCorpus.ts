import { decryptText, getSessionDek } from "./crypto";
import { api } from "./api";

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
  label?: string;
};

type ExportDay = {
  date: string;
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
    lastUsed: string;
  }>;
};

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
      lines.push({
        id: l.id,
        side: l.side,
        sort: l.sort,
        label,
        labelHash: l.labelHash,
        plannedCost: l.plannedCost,
        actualCost: l.actualCost,
        completed: l.completed,
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
      date: d.date,
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
      lastUsed: c.lastUsed,
    });
  }

  const corpus = {
    schemaVersion: raw.schemaVersion,
    exportedAt: raw.exportedAt,
    purpose: "personal energy accounting corpus for optional future model training",
    user: raw.user,
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
