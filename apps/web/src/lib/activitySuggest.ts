import {
  MOVEMENT_FAMILIES,
  deriveMovementProgress,
  type MovementProgress,
} from "./activityCatalog";
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
  /** Playful card title override (movement families). */
  title?: string;
  /** Lower-impact alternative, always offered next to a movement dose. */
  alternative?: { label: string; typicalCost: number };
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
  /**
   * Per-family movement progression from the shared intelligence model.
   * When absent, it is derived from `candidates` (day-scoped, so usually
   * starter tiers); passing the full-history signals personalizes the dose.
   */
  movement?: MovementProgress[];
};

const DRY_WEATHER: WeatherKind[] = ["sun", "cloud"];
const OUTDOOR_WORDS = /\b(walk|hike|run|jog|bike|cycle|garden|outside|outdoor)\b/i;

/** Labels stay private on-device; this heuristic only classifies decrypted text locally. */
export function isOutdoorActivity(label: string): boolean {
  return OUTDOOR_WORDS.test(label);
}

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

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * One movement family per day, rotated deterministically by date so the guide
 * stays varied without being random. Each variant's dose comes from its own
 * history (starter tiers unless that exact variant proved comfortable), and a
 * lower-impact alternative is always offered as an equal choice so nobody has
 * to negotiate with a suggestion that assumes ability.
 */
function movementSuggestion(
  ctx: ActivitySuggestContext,
  otherLabels: string[],
): (ActivitySuggestion & { score: number }) | null {
  const progress = ctx.movement ?? deriveMovementProgress(
    ctx.candidates
      .filter((c) => c.label)
      .map((c) => ({
        side: c.side,
        label: c.label!,
        useCount: c.useCount,
        typicalDifficulty: c.typicalDifficulty,
        difficultyCount: c.difficultyCount,
      })),
  );
  const byFamily = new Map(progress.map((p) => [p.familyId, p]));
  const start = hashSeed(ctx.date) % MOVEMENT_FAMILIES.length;

  for (let i = 0; i < MOVEMENT_FAMILIES.length; i++) {
    const family = MOVEMENT_FAMILIES[(start + i) % MOVEMENT_FAMILIES.length]!;
    const p = byFamily.get(family.id);
    const primary = p?.primary ?? { tier: 0 as const, uses: 0, familiar: false };
    const gentler = p?.gentler ?? { tier: 0 as const, uses: 0, familiar: false };
    const dose = family.primary.tiers[primary.tier];
    const gentle = family.gentler.tiers[gentler.tier];
    if (dose.cost > ctx.available) continue;
    // Any same-family movement already on the day (any tier, either variant)
    // suppresses the whole family — one movement moment per family per day.
    if (otherLabels.some((label) => family.matcher.test(label))) continue;

    const familiar = primary.familiar || gentler.familiar;
    const doseNote =
      primary.tier >= 1
        ? "Your own ratings show this dose has been comfortable, so it steps up a little."
        : familiar
          ? "The dose stays small until your own ratings show it feels easy."
          : "Starting tiny on purpose — finishing a small set beats planning a big one.";
    return {
      id: `movement:${family.id}`,
      title: family.title,
      label: dose.label,
      typicalCost: dose.cost,
      reason: `${doseNote}${p && p.because.length > 0 ? ` ${p.because.join(" ")}` : ""}`,
      research: family.research,
      sourceUrl: family.sourceUrl,
      familiar,
      alternative: { label: gentle.label, typicalCost: gentle.cost },
      score: familiar ? 15 : ctx.withdrawalHeavy ? 12 : 9,
    };
  }
  return null;
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

    const outdoor = isOutdoorActivity(label);
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

  // Suppress a movement family when any same-family label is already on the
  // day or among the ranked suggestions, whatever its tier or variant.
  const movement = movementSuggestion(ctx, [
    ...ctx.existingLabels,
    ...ranked.map((entry) => entry.label),
  ]);

  const top = ranked
    .sort((a, b) => b.score - a.score || Number(b.familiar) - Number(a.familiar))
    .slice(0, 3);
  // Movement keeps a reserved slot after the top picks: a rich familiar
  // catalog should never crowd the day's one movement moment out entirely.
  if (movement) top.push(movement);
  return top.map(({ score: _score, ...suggestion }) => suggestion);
}
