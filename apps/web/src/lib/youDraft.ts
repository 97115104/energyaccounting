/**
 * youDraft: turn a person's own history into a first draft of "how to work with
 * me", on-device and fully explainable.
 *
 * Two pure steps, both testable without a DOM:
 *   extractYouFeatures  aggregates counts and patterns from PersonalData
 *   draftWorkWithYou    turns qualified features into evidence-backed lines
 *
 * Every line carries "because" evidence and a stable id, so a person can accept,
 * edit, or dismiss each one and the choice survives re-computation. Drafts grow
 * richer as history grows; thin history simply yields fewer or no lines. Nothing
 * is ever written into the profile silently.
 */

import type { AcceptedTrait } from "./butterflyTraits";
import { mean, weekdayName } from "./dateIso";
import type { PersonalData } from "./personalData";

export type DraftField = "about" | "communication" | "support";

export type DraftLine = {
  /** Stable across recomputation so accept/dismiss persist. */
  id: string;
  field: DraftField;
  text: string;
  because: string[];
};

export type YouFeatures = {
  interests: { label: string; count: number }[];
  givers: { label: string; count: number }[];
  takers: { label: string; count: number; hard: boolean }[];
  journalDays: number;
  heavyWeekday: { day: string; net: number } | null;
  lowFeelGivers: { label: string; count: number }[];
};

const MIN_USE = 3;
const MIN_CLOSED_FOR_RHYTHM = 10;

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Aggregate the raw signals a draft can draw on. Pure and linear in size. */
export function extractYouFeatures(data: PersonalData): YouFeatures {
  const byUse = [...data.catalog].sort((a, b) => b.useCount - a.useCount);
  const interests = byUse
    .filter((c) => c.label.trim() && c.useCount >= MIN_USE + 2)
    .slice(0, 3)
    .map((c) => ({ label: c.label, count: c.useCount }));
  const givers = byUse
    .filter((c) => c.side === "deposit" && c.label.trim() && c.useCount >= MIN_USE)
    .slice(0, 3)
    .map((c) => ({ label: c.label, count: c.useCount }));
  const takers = byUse
    .filter((c) => c.side === "withdrawal" && c.label.trim() && c.useCount >= MIN_USE)
    .slice(0, 3)
    .map((c) => ({
      label: c.label,
      count: c.useCount,
      hard: c.typicalDifficulty != null && c.difficultyCount >= 2 && c.typicalDifficulty >= 7,
    }));

  const journalDays = data.days.filter((d) => (d.journal ?? "").trim().length > 0).length;

  // Heaviest weekday by average net energy across closed days.
  const closed = data.days.filter((d) => d.phase === "closed");
  let heavyWeekday: YouFeatures["heavyWeekday"] = null;
  if (closed.length >= MIN_CLOSED_FOR_RHYTHM) {
    const byDay = new Map<string, number[]>();
    for (const d of closed) {
      const key = weekdayName(d.date);
      const list = byDay.get(key) ?? [];
      list.push(d.attwoodNet);
      byDay.set(key, list);
    }
    for (const [day, nets] of byDay) {
      if (nets.length < 3) continue;
      const avg = mean(nets);
      if (avg < 0 && (!heavyWeekday || avg < heavyWeekday.net)) heavyWeekday = { day, net: avg };
    }
  }

  // What restores energy specifically on the roughest days (feel rating <= 2).
  const lowFeelCounts = new Map<string, number>();
  for (const d of data.days) {
    if (d.feelRating != null && d.feelRating <= 2) {
      for (const t of d.tasks) {
        if (t.side === "deposit" && t.label.trim()) {
          lowFeelCounts.set(t.label, (lowFeelCounts.get(t.label) ?? 0) + 1);
        }
      }
    }
  }
  const lowFeelGivers = [...lowFeelCounts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([label, count]) => ({ label, count }));

  return { interests, givers, takers, journalDays, heavyWeekday, lowFeelGivers };
}

/**
 * Draft evidence-backed lines for the "how to work with me" fields. Accepted
 * traits are folded in so the draft reflects what the person already confirmed.
 * Dismissed ids are filtered out.
 */
export function draftWorkWithYou(
  data: PersonalData,
  accepted: AcceptedTrait[] = [],
  dismissedIds: ReadonlySet<string> = new Set(),
): DraftLine[] {
  const f = extractYouFeatures(data);
  const out: DraftLine[] = [];

  // About: interests and reflective habits.
  const acceptedInterests = accepted.filter((t) => t.kind === "interest").map((t) => t.label);
  const interestLabels = [
    ...new Set([...acceptedInterests, ...f.interests.map((i) => i.label)]),
  ].slice(0, 3);
  if (interestLabels.length > 0) {
    out.push({
      id: "about:interests",
      field: "about",
      text: `I keep coming back to ${joinList(interestLabels)}. Time on these tends to steady me.`,
      because: f.interests.map((i) => `Logged ${i.label} ${i.count} times.`),
    });
  }
  if (f.journalDays >= 5) {
    out.push({
      id: "about:reflection",
      field: "about",
      text: "I process my days in writing, so a short recap helps me more than a quick verbal check-in.",
      because: [`Wrote a journal entry on ${f.journalDays} days.`],
    });
  }

  // Communication: rhythms and what drains me.
  if (f.heavyWeekday) {
    out.push({
      id: `communication:weekday:${f.heavyWeekday.day.toLowerCase()}`,
      field: "communication",
      text: `${f.heavyWeekday.day}s usually cost me more energy than they give, so lighter asks early that day work best.`,
      because: [
        `${f.heavyWeekday.day}s average ${Math.round(f.heavyWeekday.net)} net energy across your closed days.`,
      ],
    });
  }
  const hardTaker = f.takers.find((t) => t.hard);
  if (hardTaker) {
    out.push({
      id: `communication:hard:${hardTaker.label.toLowerCase()}`,
      field: "communication",
      text: `Things like ${hardTaker.label} take real effort for me, so notice ahead of time and a clear scope help.`,
      because: [`Used energy on ${hardTaker.label} ${hardTaker.count} times, usually rated hard.`],
    });
  }

  // Support: what reliably restores energy.
  const acceptedGivers = accepted.filter((t) => t.kind === "energy-giver").map((t) => t.label);
  const supportLabels = [
    ...new Set([
      ...f.lowFeelGivers.map((g) => g.label),
      ...acceptedGivers,
      ...f.givers.map((g) => g.label),
    ]),
  ].slice(0, 3);
  if (supportLabels.length > 0) {
    const because: string[] = [];
    for (const g of f.lowFeelGivers) because.push(`Helped on ${g.count} of your hardest days.`);
    for (const g of f.givers) because.push(`Added energy ${g.count} times.`);
    out.push({
      id: "support:givers",
      field: "support",
      text: `On a hard day, ${joinList(supportLabels)} help me recover. Pointing me back to one of these is kinder than pushing.`,
      because: because.slice(0, 3),
    });
  }

  return out.filter((l) => !dismissedIds.has(l.id));
}
