import type { WeatherKind } from "./weatherUi";

export type ActivityCandidate = {
  id: string;
  side: "deposit" | "withdrawal";
  label?: string;
  typicalCost: number;
  weekdayMask: number;
  useCount: number;
  typicalDifficulty?: number | null;
  difficultyCount?: number;
  lastUsed: string;
};

export type ActivitySuggestion = {
  id: string;
  label: string;
  typicalCost: number;
  reason: string;
  research: string;
  sourceUrl: string;
  familiar: boolean;
};

export type ActivitySuggestContext = {
  date: string;
  available: number;
  weatherKind: WeatherKind;
  uvMax: number | null;
  isDaylight: boolean;
  withdrawalHeavy: boolean;
  existingLabels: string[];
  candidates: ActivityCandidate[];
};

const DRY_WEATHER: WeatherKind[] = ["sun", "cloud"];
const OUTDOOR_WORDS = /\b(walk|hike|run|jog|bike|cycle|garden|outside|outdoor)\b/i;

function normalized(label: string): string {
  return label.trim().toLocaleLowerCase();
}

function weekdayBit(dateIso: string): number {
  return 1 << new Date(`${dateIso}T12:00:00Z`).getUTCDay();
}

function recentEnough(lastUsed: string, date: string): boolean {
  const age = Date.parse(`${date}T12:00:00Z`) - Date.parse(`${lastUsed}T12:00:00Z`);
  return Number.isFinite(age) && age >= 0 && age <= 14 * 86_400_000;
}

/**
 * Rank familiar encrypted-catalog entries and a small evidence-backed corpus.
 * Labels are supplied only after client-side decryption and never leave the device.
 */
export function suggestActivities(ctx: ActivitySuggestContext): ActivitySuggestion[] {
  if (ctx.available <= 0) return [];
  const existing = new Set(ctx.existingLabels.map(normalized));
  const weekday = weekdayBit(ctx.date);
  const dry = DRY_WEATHER.includes(ctx.weatherKind);
  const lowUv = ctx.uvMax != null && ctx.uvMax <= 2;
  const moderateOrLowerUv = ctx.uvMax != null && ctx.uvMax <= 5;
  // Outdoor recommendations require known UV so copy never invents a peak index.
  const safeOutdoor = ctx.isDaylight && dry && moderateOrLowerUv;

  const ranked: Array<ActivitySuggestion & { score: number }> = [];
  for (const candidate of ctx.candidates) {
    const label = candidate.label?.trim();
    if (
      candidate.side !== "deposit" ||
      !label ||
      existing.has(normalized(label)) ||
      candidate.typicalCost > ctx.available
    ) {
      continue;
    }

    const outdoor = OUTDOOR_WORDS.test(label);
    // Outdoor history stays suppressed when weather/daylight/UV are wrong.
    if (outdoor && !safeOutdoor) continue;

    let score = Math.min(candidate.useCount, 10) * 2;
    if ((candidate.weekdayMask & weekday) !== 0) score += 6;
    if (recentEnough(candidate.lastUsed, ctx.date)) score += 3;
    if (outdoor) score += lowUv ? 10 : 6;
    const difficultyKnown =
      (candidate.difficultyCount ?? 0) >= 3 && candidate.typicalDifficulty != null;
    if (difficultyKnown) {
      const easeNudge = 6 - candidate.typicalDifficulty!;
      score += (ctx.withdrawalHeavy || ctx.available < 25 ? 2 : 1) * easeNudge;
    }
    if (score <= 0) continue;

    const conditionReason =
      outdoor && lowUv
        ? " Dry weather and low UV make the timing favorable."
        : outdoor
          ? " Current daylight and weather fit an outdoor activity that adds energy."
          : "";
    ranked.push({
      id: `familiar:${candidate.id}`,
      label,
      typicalCost: candidate.typicalCost,
      reason: `You have used this to add energy ${candidate.useCount}×.${conditionReason}${
        difficultyKnown
          ? ` You usually rate it ${candidate.typicalDifficulty}/10 for difficulty.`
          : ""
      }`,
      research: "Personal history, ranked locally on this device.",
      sourceUrl: "",
      familiar: true,
      score,
    });
  }

  const novel: Array<ActivitySuggestion & { score: number; matches: boolean }> = [
    {
      id: "healthy:short-walk",
      label: "Take a short walk",
      typicalCost: 15,
      reason: lowUv
        ? "It is dry and today's peak UV is low."
        : "It is dry, daylight, and today's peak UV is moderate or lower.",
      research: "WHO: all physical activity counts; nature-based walking can support wellbeing.",
      sourceUrl: "https://www.who.int/news-room/fact-sheets/detail/physical-activity",
      familiar: false,
      score: lowUv ? 18 : 14,
      matches: safeOutdoor,
    },
    {
      id: "healthy:mindful-pause",
      label: "Try a 5-minute mindfulness pause",
      typicalCost: 10,
      reason: ctx.withdrawalHeavy
        ? "More energy is going out than coming in, so a low-demand reset may fit."
        : "A brief, low-demand pause can be an easy way to add energy.",
      research: "Brief mindfulness and acceptance-based practices may reduce immediate anxiety.",
      sourceUrl: "https://doi.org/10.3389/fpsyg.2024.1412928",
      familiar: false,
      score: ctx.withdrawalHeavy || !safeOutdoor ? 13 : 7,
      matches: true,
    },
    {
      id: "healthy:microbreak",
      label: "Take a 10-minute screen break",
      typicalCost: 10,
      reason: "A short break can reduce fatigue without asking much of the remaining capacity.",
      research: "A meta-analysis found micro-breaks improved vigor and reduced fatigue.",
      sourceUrl: "https://doi.org/10.1371/journal.pone.0272460",
      familiar: false,
      score: ctx.withdrawalHeavy ? 12 : 8,
      matches: true,
    },
    {
      id: "healthy:gentle-stretch",
      label: "Do a gentle stretch",
      typicalCost: 10,
      reason: safeOutdoor
        ? "A light movement option is available if going outside feels too large."
        : "Conditions favor simple indoor movement that adds energy.",
      research: "WHO recommends replacing sedentary time with movement of any intensity.",
      sourceUrl: "https://www.who.int/publications/i/item/9789240015128",
      familiar: false,
      score: safeOutdoor ? 6 : 11,
      matches: true,
    },
  ];

  for (const item of novel) {
    if (
      item.matches &&
      item.typicalCost <= ctx.available &&
      !existing.has(normalized(item.label)) &&
      !ranked.some((entry) => normalized(entry.label) === normalized(item.label))
    ) {
      ranked.push(item);
    }
  }

  return ranked
    .sort((a, b) => b.score - a.score || Number(b.familiar) - Number(a.familiar))
    .slice(0, 3)
    .map(({ score: _score, ...suggestion }) => suggestion);
}
