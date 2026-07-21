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

import { DAILY_ENERGY } from "@eaj/shared";
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
  /** When true, the user must explicitly start a new ledger before this line is added. */
  requiresStart?: boolean;
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
      body: `You freed ${ctx.justFreed} points. Spend them on something restorative, or leave them open — either is valid.`,
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
        // Cross-date duplicates are allowed; only skip labels already on this ledger.
        if (seenLabels.has(key)) return false;
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

// Recovery after close: suggest how to open the *next* ledger, never auto-start it.

export type RecoveryContext = {
  /** The ledger that just closed. */
  dayId: string;
  date: string;
  /** Local calendar date when the user would start the next ledger (defaults to day after `date`). */
  nextStartDate?: string;
  feelRating: number | null;
  openingBalance: number;
  /** Energy remaining at close (stored as closingBalance). */
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

/** Does a calendar weekday historically run a meaningful net drain? */
function weekdayRunsHeavy(series: StatPoint[], dateIso: string): boolean {
  const closed = series.filter((p) => p.phase === "closed" && p.date <= dateIso);
  if (closed.length < 10) return false;
  const weekday = weekdayName(dateIso);
  const sameDay = closed.filter((p) => weekdayName(p.date) === weekday);
  const others = closed.filter((p) => weekdayName(p.date) !== weekday);
  if (sameDay.length < 3 || others.length < 5) return false;
  const sameNet = mean(sameDay.map((p) => p.attwoodNet));
  const otherNet = mean(others.map((p) => p.attwoodNet));
  return sameNet < 0 && sameNet <= otherNet - 10;
}

/**
 * One conservative "start the next ledger gently" recommendation, or null when
 * the closed ledger gives no evidence recovery is needed.
 */
export function recoveryPlan(ctx: RecoveryContext): GuideItem | null {
  const because: string[] = [];
  let strong = 0;
  let weak = 0;

  if (ctx.feelRating != null && ctx.feelRating <= 4) {
    because.push(`Today felt ${ctx.feelRating}/10.`);
    strong += 1;
  }
  const spent = ctx.openingBalance - ctx.closingBalance;
  if (spent >= 15) {
    because.push(`This ledger ended with ${ctx.closingBalance} energy remaining (${spent} points spent from your daily ${DAILY_ENERGY}).`);
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
  const nextStart = ctx.nextStartDate ?? nextIsoDate(ctx.date);
  if (weekdayRunsHeavy(ctx.series, nextStart)) {
    because.push(`${weekdayName(nextStart)}s usually cost you more than they give.`);
    weak += 1;
  }

  if (strong === 0 && weak < 2) return null;

  const nextCapacity = DAILY_ENERGY;
  const pick = ctx.candidates
    .filter((c) => {
      if (c.side !== "deposit" || !c.label?.trim()) return false;
      if (c.typicalCost > nextCapacity || c.typicalCost > 25) return false;
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
      id: `recovery:${ctx.dayId}`,
      kind: "recovery",
      title: "Start your next ledger gently",
      body: `When you start your next ledger, open with “${pick.label}” (${pick.typicalCost} points) — a familiar deposit that fits a fresh ${DAILY_ENERGY} points.`,
      because: [
        ...because,
        `Each new ledger starts at ${DAILY_ENERGY}; energy does not carry over.`,
        `You have used “${pick.label}” ${pick.useCount}× before.`,
      ],
      research,
      personalized: true,
      action: {
        side: "deposit",
        label: pick.label,
        cost: pick.typicalCost,
        requiresStart: true,
      },
      score: 90,
    };
  }

  return {
    id: `recovery:${ctx.dayId}`,
    kind: "recovery",
    title: "Start your next ledger gently",
    body: "When you start again, plan fewer withdrawal points than usual and leave room in your fresh 100.",
    because,
    research,
    personalized: true,
    score: 90,
  };
}
