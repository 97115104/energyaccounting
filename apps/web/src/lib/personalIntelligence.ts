/**
 * One explainable, on-device model of a person's energy history.
 *
 * Callers provide data they already decrypted or fetched; this module never
 * performs I/O and never persists its output. Every inference carries the
 * evidence used to make it so UI surfaces can disclose rather than overclaim.
 */

import { mean, weekdayName } from "./dateIso";

export type IntelligenceCatalogItem = {
  side: "deposit" | "withdrawal" | string;
  label: string;
  useCount: number;
};

export type IntelligenceDay = {
  date: string;
  phase: string;
  closingBalance: number | null;
  attwoodNet: number;
  depositTotal: number;
  withdrawalTotal: number;
  feelRating: number | null;
};

export type IntelligenceLine = {
  id: string;
  text: string;
  because: string[];
  confidence: "emerging" | "established";
};

export type TipSignals = {
  familiarRestorer: string | null;
  heavyWeekday: string | null;
  recentLowFeel: boolean;
  /** How many recent rated days the low-feel check inspected (0–3). */
  recentRatedSample: number;
};

export type PersonalIntelligence = {
  coverage: {
    closedDays: number;
    journalDays: number;
    catalogItems: number;
  };
  overview: IntelligenceLine[];
  energyMeaning: IntelligenceLine[];
  tipSignals: TipSignals;
};

export type IntelligenceInput = {
  catalog: IntelligenceCatalogItem[];
  days: IntelligenceDay[];
  journalDays?: number;
  forDate?: string;
};

function byDateAsc(a: IntelligenceDay, b: IntelligenceDay): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

function strongest(
  catalog: IntelligenceCatalogItem[],
  side: "deposit" | "withdrawal",
): IntelligenceCatalogItem | null {
  return (
    catalog
      .filter((item) => item.side === side && item.label.trim() && item.useCount >= 3)
      .sort((a, b) => b.useCount - a.useCount || a.label.localeCompare(b.label))[0] ?? null
  );
}

function weekdayPattern(days: IntelligenceDay[]): {
  name: string;
  averageNet: number;
  count: number;
} | null {
  if (days.length < 10) return null;
  const groups = new Map<string, number[]>();
  for (const day of days) {
    const name = weekdayName(day.date);
    groups.set(name, [...(groups.get(name) ?? []), day.attwoodNet]);
  }
  const candidates = [...groups.entries()]
    .filter(([, values]) => values.length >= 3)
    .map(([name, values]) => ({ name, averageNet: mean(values), count: values.length }))
    .sort((a, b) => a.averageNet - b.averageNet);
  const heaviest = candidates[0];
  if (!heaviest || heaviest.averageNet >= -5) return null;
  return heaviest;
}

/**
 * Build the shared model in O(days + catalog) time. Thresholds deliberately
 * favor silence over confident-sounding claims from sparse history.
 */
export function buildPersonalIntelligence(input: IntelligenceInput): PersonalIntelligence {
  // Sort so "recent" windows are date-based even if callers pass unsorted rows.
  const closed = input.days.filter((day) => day.phase === "closed").sort(byDateAsc);
  const restorer = strongest(input.catalog, "deposit");
  const drain = strongest(input.catalog, "withdrawal");
  const heavy = weekdayPattern(closed);
  const overview: IntelligenceLine[] = [];
  const energyMeaning: IntelligenceLine[] = [];

  if (restorer) {
    overview.push({
      id: `restorer:${restorer.label.toLocaleLowerCase()}`,
      text: `“${restorer.label}” is one of your most familiar ways to add energy.`,
      because: [`You have logged it ${restorer.useCount} times as something that adds energy.`],
      confidence: restorer.useCount >= 6 ? "established" : "emerging",
    });
  }
  if (drain) {
    overview.push({
      id: `drain:${drain.label.toLocaleLowerCase()}`,
      text: `“${drain.label}” is a recurring demand on your energy.`,
      because: [`You have logged it ${drain.useCount} times as something that uses energy.`],
      confidence: drain.useCount >= 6 ? "established" : "emerging",
    });
  }
  if (heavy) {
    overview.push({
      id: `rhythm:${heavy.name.toLocaleLowerCase()}`,
      text: `${heavy.name}s tend to take more energy than they add.`,
      because: [
        `Across ${heavy.count} closed ${heavy.name}s, your average energy added minus energy used is ${Math.round(heavy.averageNet)} points.`,
      ],
      confidence: heavy.count >= 5 ? "established" : "emerging",
    });
  }

  if (closed.length >= 5) {
    const window = closed.slice(-30);
    const typicalClose = Math.round(mean(window.map((day) => day.closingBalance ?? 0)));
    energyMeaning.push({
      id: "typical-close",
      text: `You typically finish a logged day with about ${typicalClose} of your 100 points remaining.`,
      because: [`Based on your ${window.length} most recent closed days.`],
      confidence: closed.length >= 10 ? "established" : "emerging",
    });

    const typicalUse = Math.round(mean(window.map((day) => day.withdrawalTotal)));
    energyMeaning.push({
      id: "typical-use",
      text: `A usual logged day uses about ${typicalUse} energy points.`,
      because: [`This is the average energy used across ${window.length} closed days.`],
      confidence: closed.length >= 10 ? "established" : "emerging",
    });
  }

  const recentRatings = closed
    .filter((day) => day.feelRating != null)
    .slice(-3)
    .map((day) => day.feelRating as number);
  // Align tip triggers with overview silence: wait for enough closed history
  // and at least three rated days before personalizing from feel.
  const recentLowFeel =
    closed.length >= 5 &&
    recentRatings.length >= 3 &&
    recentRatings.filter((rating) => rating <= 4).length >= 2;
  const forDate = input.forDate;
  return {
    coverage: {
      closedDays: closed.length,
      journalDays: input.journalDays ?? 0,
      catalogItems: input.catalog.length,
    },
    overview,
    energyMeaning,
    tipSignals: {
      familiarRestorer: restorer?.label ?? null,
      heavyWeekday:
        forDate && heavy?.name === weekdayName(forDate) ? heavy.name : null,
      recentLowFeel,
      recentRatedSample: recentRatings.length,
    },
  };
}
