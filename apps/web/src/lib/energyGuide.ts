/**
 * The Energy Guide: one deterministic, explainable recommendation engine.
 *
 * Every surface that used to compete for attention (corpus tips, activity
 * ranking, play prompts, trend hints, recovery advice) is normalized into a
 * single ranked list of GuideItems. Each item carries the concrete signals
 * that made it fire ("because") separately from its research grounding, so
 * the UI can disclose reasoning without conflating personal inference with
 * scientific certainty. Everything runs on-device from decrypted-locally
 * labels and plaintext numbers; nothing here talks to a network.
 */

import { openingBalance } from "@eaj/shared";
import { suggestActivities, type ActivityCandidate } from "./activitySuggest";
import type { Insight, StatPoint } from "./insights";
import { playCategoryTitle, suggestPlayDeposits } from "./playCategories";
import { selectFromCorpus, type CorpusContext, type CorpusEntry } from "./tipsCorpus";
import type { WeatherKind } from "./weatherUi";

export type GuideAction = {
  side: "deposit";
  /** Activity label to add to the ledger. */
  label: string;
  cost: number;
  /** ISO date to add the line to; omitted means the current day. */
  targetDate?: string;
};

export type GuideKind = "event" | "recovery" | "trend" | "activity" | "play" | "context";

export type GuideItem = {
  id: string;
  kind: GuideKind;
  title: string;
  body: string;
  /** Concrete, verifiable signals behind the suggestion ("Why this?"). */
  because: string[];
  /** Research grounding, kept separate from personal claims. */
  research?: string;
  sourceUrl?: string;
  /** True when ranked from the user's own history on this device. */
  personalized: boolean;
  /** Overrides the default provenance label (e.g. "Getting started"). */
  provenance?: string;
  action?: GuideAction;
  score: number;
};

export type GuideContext = {
  date: string;
  available: number;
  depositTotal: number;
  withdrawalTotal: number;
  incompleteWithdrawals: number;
  weatherKind: WeatherKind;
  uvMax: number | null;
  isDaylight: boolean;
  withdrawalHeavy: boolean;
  existingLabels: string[];
  candidates: ActivityCandidate[];
  /** Points just freed by completing a task; produces the event item. */
  justFreed?: number;
  /** Weekday trend hint from the numeric insight engine, when it fired. */
  planningHint?: Insight | null;
  dismissedIds?: ReadonlySet<string>;
};

export type Guide = {
  /** Best single proactive suggestion; null when nothing earns attention. */
  primary: GuideItem | null;
  /** Full ranked list for the guide sheet, primary included. */
  items: GuideItem[];
};

/** Items below this score stay in the sheet and never interrupt inline. */
const PRIMARY_THRESHOLD = 45;
const MAX_ITEMS = 6;

function normalizedLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

/** Concrete day-state signals for a corpus tip, derived from its trigger domain. */
function corpusBecause(entry: CorpusEntry, ctx: GuideContext): string[] {
  const out: string[] = [];
  const mentionsUv = entry.id.startsWith("uv-");
  if (mentionsUv && ctx.uvMax != null) {
    out.push(`Today's UV max is ${Math.round(ctx.uvMax)}.`);
  }
  if (entry.id.startsWith("rain") || entry.id.startsWith("snow") || entry.id.startsWith("fog")) {
    out.push(`Today's forecast is ${ctx.weatherKind}.`);
  }
  if (entry.id === "sun-general") out.push("Today's forecast is sunny.");
  if (entry.id === "rebalance-play") {
    out.push(
      `Withdrawals (${ctx.withdrawalTotal}) are ahead of deposits (${ctx.depositTotal}) right now.`,
    );
  }
  if (entry.id === "boundaries") {
    out.push(`${ctx.incompleteWithdrawals} withdrawals are still open.`);
  }
  if (entry.id === "deposit-window") {
    out.push(`${ctx.available} points remain available today.`);
  }
  if (out.length === 0) {
    out.push(`Withdrawals ${ctx.withdrawalTotal}, deposits ${ctx.depositTotal}, ${ctx.available} points available.`);
  }
  return out;
}

/**
 * Build the ranked guide. Deterministic: same context, same guide.
 * `extra` lets callers inject items computed elsewhere (e.g. recovery).
 */
export function buildGuide(ctx: GuideContext, extra: GuideItem[] = []): Guide {
  const items: GuideItem[] = [...extra];

  // Event: reacting to what the user just did always leads.
  if (ctx.justFreed && ctx.justFreed > 0) {
    items.push({
      id: "event:freed",
      kind: "event",
      title: "Capacity opened up",
      body: `You freed ${ctx.justFreed} points. Spend them on something restorative, or leave them banked — the ledger won't judge either way.`,
      because: [`You just completed a task that reserved ${ctx.justFreed} points.`],
      personalized: true,
      score: 100,
    });
  }

  // Trend: the weekday pattern hint from numeric history.
  if (ctx.planningHint) {
    items.push({
      id: `trend:${ctx.planningHint.id}`,
      kind: "trend",
      title: "A pattern worth planning for",
      body: ctx.planningHint.text,
      because: ["Computed from the balance numbers of your recent closed days."],
      personalized: true,
      score: 55,
    });
  }

  // Activities: familiar catalog entries and evidence-backed novel options.
  const activities = suggestActivities({
    date: ctx.date,
    available: ctx.available,
    weatherKind: ctx.weatherKind,
    uvMax: ctx.uvMax,
    isDaylight: ctx.isDaylight,
    withdrawalHeavy: ctx.withdrawalHeavy,
    existingLabels: ctx.existingLabels,
    candidates: ctx.candidates,
  });
  activities.forEach((suggestion, index) => {
    items.push({
      id: `activity:${suggestion.id}`,
      kind: "activity",
      title: suggestion.familiar ? "A deposit you know works" : "A deposit that fits now",
      body: `${suggestion.label} fits the ${ctx.available} points available now.`,
      because: [suggestion.reason],
      // Familiar items are personal inference, not research; keep the
      // research slot for actual evidence so provenance stays honest.
      research: suggestion.familiar ? undefined : suggestion.research,
      sourceUrl: suggestion.sourceUrl || undefined,
      personalized: suggestion.familiar,
      action: { side: "deposit", label: suggestion.label, cost: suggestion.typicalCost },
      score: 50 - index * 5,
    });
  });

  // Play: rebalancing prompts when withdrawals dominate.
  if (ctx.withdrawalHeavy && ctx.available > 0) {
    const plays = suggestPlayDeposits({
      existingLabels: ctx.existingLabels,
      daySeed: ctx.date,
      count: 2,
    });
    for (const play of plays) {
      if (play.typicalCost > ctx.available) continue;
      items.push({
        id: `play:${play.label}`,
        kind: "play",
        title: `Play deposit · ${playCategoryTitle(play.category)}`,
        body: `${play.label} — a ${playCategoryTitle(play.category).toLowerCase()}-style way to tilt the ledger back.`,
        because: [
          `Withdrawals (${ctx.withdrawalTotal}) are ahead of deposits (${ctx.depositTotal}) right now.`,
        ],
        research: "Play styles follow Stuart Brown and the National Institute for Play.",
        personalized: false,
        action: { side: "deposit", label: play.label, cost: play.typicalCost },
        score: 35,
      });
    }
  }

  // Context: research corpus tips matched to weather, UV, and balance state.
  const corpusCtx: CorpusContext = {
    weatherKind: ctx.weatherKind,
    uvMax: ctx.uvMax,
    isDaylight: ctx.isDaylight,
    available: ctx.available,
    depositTotal: ctx.depositTotal,
    withdrawalTotal: ctx.withdrawalTotal,
    incompleteWithdrawals: ctx.incompleteWithdrawals,
  };
  for (const entry of selectFromCorpus(corpusCtx, 3)) {
    items.push({
      id: `context:${entry.id}`,
      kind: "context",
      title: entry.title,
      body: entry.body,
      because: corpusBecause(entry, ctx),
      research: entry.research,
      personalized: false,
      score: entry.priority * 4,
    });
  }

  // Dedupe by id and by action label, drop dismissed, rank, cap.
  const seenIds = new Set<string>();
  const seenLabels = new Set(ctx.existingLabels.map(normalizedLabel));
  const ranked = items
    .filter((item) => {
      if (ctx.dismissedIds?.has(item.id)) return false;
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      if (item.action) {
        const key = normalizedLabel(item.action.label);
        // Cross-date actions (tomorrow) may repeat today's labels.
        if (!item.action.targetDate && seenLabels.has(key)) return false;
        seenLabels.add(key);
      }
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ITEMS);

  const top = ranked[0];
  return {
    primary: top && top.score >= PRIMARY_THRESHOLD ? top : null,
    items: ranked,
  };
}

// ---------------------------------------------------------------------------
// Tomorrow recovery: the intelligent replacement for the old free-text
// "what can I schedule tomorrow to compensate?" field.
// ---------------------------------------------------------------------------

export type RecoveryContext = {
  /** The day that just closed. */
  date: string;
  feelRating: number | null;
  openingBalance: number;
  /** The actual closing balance from the close call. */
  closingBalance: number;
  plannedTotal: number;
  actualTotal: number;
  incompleteWithdrawals: number;
  /** Numeric history, used for the next-weekday pattern check. */
  series: StatPoint[];
  /** Decrypted personal catalog for picking a familiar deposit. */
  candidates: ActivityCandidate[];
};

export function nextIsoDate(dateIso: string): string {
  const d = new Date(dateIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function weekdayName(dateIso: string): string {
  return new Date(dateIso + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Does tomorrow's weekday historically run a meaningful net drain? */
function tomorrowRunsHeavy(series: StatPoint[], tomorrow: string): boolean {
  const closed = series.filter((p) => p.phase === "closed" && p.date < tomorrow);
  if (closed.length < 10) return false;
  const weekday = weekdayName(tomorrow);
  const sameDay = closed.filter((p) => weekdayName(p.date) === weekday);
  const others = closed.filter((p) => weekdayName(p.date) !== weekday);
  if (sameDay.length < 3 || others.length < 5) return false;
  const sameNet = mean(sameDay.map((p) => p.attwoodNet));
  const otherNet = mean(others.map((p) => p.attwoodNet));
  return sameNet < 0 && sameNet <= otherNet - 10;
}

/**
 * One conservative "make tomorrow gentler" recommendation, or null when today
 * gives no evidence recovery is needed. Fires on one strong signal (rough
 * feel, real deficit) or two weaker ones; never invents an activity when no
 * familiar low-cost deposit fits tomorrow's expected capacity.
 *
 * Only call this AFTER the day has closed: tomorrow's opening balance is
 * derived server-side from the last closed day, so creating tomorrow's row
 * any earlier would freeze a stale opening.
 */
export function recoveryPlan(ctx: RecoveryContext): GuideItem | null {
  const because: string[] = [];
  let strong = 0;
  let weak = 0;

  if (ctx.feelRating != null && ctx.feelRating <= 4) {
    because.push(`Today felt ${ctx.feelRating}/10.`);
    strong += 1;
  }
  const deficit = ctx.openingBalance - ctx.closingBalance;
  if (deficit >= 15) {
    because.push(`Today is closing ${deficit} points below where it opened.`);
    strong += 1;
  }
  if (ctx.plannedTotal > 0 && ctx.actualTotal >= ctx.plannedTotal + 15) {
    because.push(`Tasks cost ${ctx.actualTotal - ctx.plannedTotal} points more than planned.`);
    weak += 1;
  }
  if (ctx.incompleteWithdrawals >= 3) {
    because.push(`${ctx.incompleteWithdrawals} withdrawals are still open.`);
    weak += 1;
  }
  const tomorrow = nextIsoDate(ctx.date);
  if (tomorrowRunsHeavy(ctx.series, tomorrow)) {
    because.push(`${weekdayName(tomorrow)}s usually cost you more than they give.`);
    weak += 1;
  }

  if (strong === 0 && weak < 2) return null;

  // Tomorrow opens at 100 + today's closing balance (see @eaj/shared).
  const tomorrowOpening = openingBalance(ctx.closingBalance);
  const tomorrowCapacity = Math.max(0, tomorrowOpening);
  const pick = ctx.candidates
    .filter((c) => {
      if (c.side !== "deposit" || !c.label?.trim()) return false;
      if (c.typicalCost > tomorrowCapacity || c.typicalCost > 25) return false;
      const easyKnown =
        (c.difficultyCount ?? 0) >= 3 && c.typicalDifficulty != null && c.typicalDifficulty <= 4;
      return easyKnown || c.useCount >= 3;
    })
    .sort((a, b) => {
      const aEasy = (a.difficultyCount ?? 0) >= 3 && (a.typicalDifficulty ?? 10) <= 4 ? 0 : 1;
      const bEasy = (b.difficultyCount ?? 0) >= 3 && (b.typicalDifficulty ?? 10) <= 4 ? 0 : 1;
      if (aEasy !== bEasy) return aEasy - bEasy;
      return b.useCount - a.useCount;
    })[0];

  const research =
    "Energy Accounting (Toudal & Attwood) schedules deliberate deposits after depleting days.";

  if (pick?.label) {
    return {
      id: `recovery:${ctx.date}`,
      kind: "recovery",
      title: "Make tomorrow gentler",
      body: `Plan “${pick.label}” (${pick.typicalCost} points) for tomorrow — a familiar deposit that fits the ${tomorrowCapacity} points tomorrow should open with.`,
      because: [
        ...because,
        `Tomorrow opens at ${tomorrowOpening} (100 + today's closing balance).`,
        `You have used “${pick.label}” ${pick.useCount}× before.`,
      ],
      research,
      personalized: true,
      action: {
        side: "deposit",
        label: pick.label,
        cost: pick.typicalCost,
        targetDate: tomorrow,
      },
      score: 90,
    };
  }

  return {
    id: `recovery:${ctx.date}`,
    kind: "recovery",
    title: "Make tomorrow gentler",
    body: "Tomorrow deserves a buffer: plan fewer withdrawal points than usual and leave room for the balance to recover.",
    because,
    research,
    personalized: true,
    score: 90,
  };
}
