import {
  MOVEMENT_FAMILIES,
  deriveMovementProgress,
  type MovementProgress,
} from "./activityCatalog";
import type { WeatherKind } from "./weatherUi";
import NOVEL_JSON from "../content/novel-activities.json";

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
  /** Defaults to deposit when omitted (legacy novel/movement picks). */
  side?: "deposit" | "withdrawal";
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
  /** Default true. When false, skip movement families and physical novel tips. */
  includePhysicalActivities?: boolean;
};

type NovelCondition = "always" | "outdoorSafe";

type NovelActivityJson = {
  id: string;
  label: string;
  typicalCost: number;
  physical: boolean;
  condition: NovelCondition;
  scoreWhen: Record<string, number>;
  reasonWhen: Record<string, string>;
  research: string;
  sourceUrl: string;
};

const NOVEL_ACTIVITIES = NOVEL_JSON as unknown as NovelActivityJson[];

const DRY_WEATHER: WeatherKind[] = ["sun", "cloud"];
const OUTDOOR_WORDS = /\b(walk|hike|run|jog|bike|cycle|garden|outside|outdoor)\b/i;
// Broader physical/exertion labels for preference gating (gym, yoga, movement families).
const PHYSICAL_WORDS =
  /\b(walk|hike|run|jog|bike|cycle|garden|outside|outdoor|gym|yoga|swim|stretch|push[\s-]?ups?|squats?|jacks?|dance|workout|exercise|pilates|weights?|sit[\s-]?to[\s-]?stands?)\b/i;

/** Labels stay private on-device; this heuristic only classifies decrypted text locally. */
export function isOutdoorActivity(label: string): boolean {
  return OUTDOOR_WORDS.test(label);
}

/** True when a label looks like physical movement/exercise (not stim-only regulation). */
export function isPhysicalActivity(label: string): boolean {
  if (PHYSICAL_WORDS.test(label)) return true;
  return MOVEMENT_FAMILIES.some((family) => family.matcher.test(label));
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
  if (ctx.includePhysicalActivities === false) return null;

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
    // suppresses the whole family, one movement moment per family per day.
    if (otherLabels.some((label) => family.matcher.test(label))) continue;

    const familiar = primary.familiar || gentler.familiar;
    const doseNote =
      primary.tier >= 1
        ? "Your own ratings show this dose has been comfortable, so it steps up a little."
        : familiar
          ? "The dose stays small until your own ratings show it feels easy."
          : "Starting tiny on purpose, finishing a small set beats planning a big one.";
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

function novelScore(
  item: NovelActivityJson,
  flags: {
    lowUv: boolean;
    safeOutdoor: boolean;
    withdrawalHeavy: boolean;
    nonPhysicalPreferred: boolean;
  },
): number {
  const s = item.scoreWhen;
  // Prefer the non-physical boost when that preference is active.
  if (flags.nonPhysicalPreferred && s.nonPhysicalPreferred != null) return s.nonPhysicalPreferred;
  if (flags.withdrawalHeavy && s.withdrawalHeavy != null) return s.withdrawalHeavy;
  // Mindful pause: higher score when the day is heavy or outdoor options are off.
  if ((flags.withdrawalHeavy || !flags.safeOutdoor) && s.withdrawalHeavyOrIndoor != null) {
    return s.withdrawalHeavyOrIndoor;
  }
  if (flags.lowUv && s.lowUv != null) return s.lowUv;
  if (flags.safeOutdoor && s.outdoorSafe != null) return s.outdoorSafe;
  return s.default ?? 8;
}

function novelReason(
  item: NovelActivityJson,
  flags: { lowUv: boolean; safeOutdoor: boolean; withdrawalHeavy: boolean },
): string {
  const r = item.reasonWhen;
  if (flags.withdrawalHeavy && r.withdrawalHeavy) return r.withdrawalHeavy;
  if (flags.lowUv && r.lowUv) return r.lowUv;
  if (flags.safeOutdoor && r.outdoorSafe) return r.outdoorSafe;
  return r.default ?? "";
}

/**
 * Rank familiar encrypted-catalog entries and a small evidence-backed corpus.
 * Labels are supplied only after client-side decryption and never leave the device.
 */
export function suggestActivities(ctx: ActivitySuggestContext): ActivitySuggestion[] {
  if (ctx.available <= 0) return [];
  const includePhysical = ctx.includePhysicalActivities !== false;
  const existing = new Set(ctx.existingLabels.map(normalized));
  const weekday = weekdayBit(ctx.date);
  const dry = DRY_WEATHER.includes(ctx.weatherKind);
  const lowUv = ctx.uvMax != null && ctx.uvMax <= 2;
  const moderateOrLowerUv = ctx.uvMax != null && ctx.uvMax <= 5;
  // Outdoor recommendations require known UV so copy never invents a peak index.
  const safeOutdoor = ctx.isDaylight && dry && moderateOrLowerUv;
  const nonPhysicalPreferred = !includePhysical;

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
    // Prefer not to resurface physical familiar history when movement is off.
    if (!includePhysical && isPhysicalActivity(label)) continue;

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
      side: "deposit",
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

  // Plenty of capacity and a light day: offer familiar ways to use energy
  // healthily, in modest bites, so surplus does not sit idle by default.
  const capacitySurplus =
    ctx.available >= 55 || (ctx.available >= 40 && !ctx.withdrawalHeavy);
  if (capacitySurplus) {
    const maxHealthySpend = Math.min(ctx.available, 30);
    for (const candidate of ctx.candidates) {
      const label = candidate.label?.trim();
      if (
        candidate.side !== "withdrawal" ||
        !label ||
        existing.has(normalized(label)) ||
        candidate.typicalCost > maxHealthySpend ||
        candidate.typicalCost <= 0
      ) {
        continue;
      }
      if (!includePhysical && isPhysicalActivity(label)) continue;

      let score = Math.min(candidate.useCount, 10) * 2;
      if ((candidate.weekdayMask & weekday) !== 0) score += 6;
      if (recentEnough(candidate.lastUsed, ctx.date)) score += 3;
      const difficultyKnown =
        (candidate.difficultyCount ?? 0) >= 3 && candidate.typicalDifficulty != null;
      if (difficultyKnown) {
        // Prefer sustainable effort when the day still has room.
        const easeNudge = 6 - candidate.typicalDifficulty!;
        score += easeNudge;
      }
      // Boost when almost nothing has been spent yet.
      if (ctx.available >= 70) score += 4;
      if (score <= 0) continue;

      ranked.push({
        id: `familiar-use:${candidate.id}`,
        side: "withdrawal",
        label,
        typicalCost: candidate.typicalCost,
        reason: `You still have ${ctx.available} points open. “${label}” is a familiar, sized way to use some of today's capacity well.${
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
  }

  const flags = { lowUv, safeOutdoor, withdrawalHeavy: ctx.withdrawalHeavy, nonPhysicalPreferred };
  for (const item of NOVEL_ACTIVITIES) {
    if (!includePhysical && item.physical) continue;
    const matches =
      item.condition === "always" || (item.condition === "outdoorSafe" && safeOutdoor);
    if (
      matches &&
      item.typicalCost <= ctx.available &&
      !existing.has(normalized(item.label)) &&
      !ranked.some((entry) => normalized(entry.label) === normalized(item.label))
    ) {
      ranked.push({
        id: item.id,
        label: item.label,
        typicalCost: item.typicalCost,
        reason: novelReason(item, flags),
        research: item.research,
        sourceUrl: item.sourceUrl,
        familiar: false,
        score: novelScore(item, flags),
      });
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
