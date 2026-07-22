// Header greeting with selectable flavors. The random pick freezes on the
// first call of the visit so the headline doesn't churn mid-session, but the
// time-of-day slot always tracks the current hour, so a tab left open from
// morning into evening greets accordingly.
// Phrase pools live in content/greetings.json.

import GREETINGS_JSON from "../content/greetings.json";
import { hourInTimezone } from "./timezone";

export type GreetingStyle = "classic" | "humor" | "facts" | "mix";

export const GREETING_STYLES: { value: GreetingStyle; label: string; example: string }[] = [
  { value: "mix", label: "Mix", example: "A little of everything, picked per visit." },
  { value: "classic", label: "Classic", example: "Good morning, ready to plan the day." },
  { value: "humor", label: "ND humor", example: "All 84 brain tabs are open and every one is important." },
  { value: "facts", label: "Fun facts", example: "Wombat poop is cube-shaped. You needed to know." },
];

type Slot = "morning" | "afternoon" | "evening" | "night";

function slotFor(hour: number): Slot {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

type Pool = { named: string[]; anonymous: string[] };

export type FactSource = { label: string; url: string };

/** A phrase inside the fact text that opens a verify link in a new tab. */
export type FactLink = { phrase: string; url: string };

type FactEntry = {
  named: string;
  anonymous: string;
  source: FactSource;
  links?: FactLink[];
};

const CLASSIC = GREETINGS_JSON.classic as Record<Slot, Pool>;
const HUMOR = GREETINGS_JSON.humor as Pool;
const FACTS = GREETINGS_JSON.facts as FactEntry[];

const visitSeed = Math.random();
// A second stream from the same seed so "which pool" and "which phrase"
// don't collapse into one draw for the mix style.
const poolSeed = (visitSeed * 9301 + 0.49297) % 1;

function pickFrom(pool: Pool, named: boolean, seed: number): string {
  const list = named ? pool.named : pool.anonymous;
  const index = Math.floor(seed * list.length) % list.length;
  return list[index] ?? list[0]!;
}

export type GreetingDetail = {
  text: string;
  /** Present only for the "facts" style: where the claim can be verified. */
  factSource?: FactSource;
  /** Inline phrases inside `text` that link out for verification. */
  factLinks?: FactLink[];
};

export type FactSegment = { text: string; url?: string };

/**
 * Split fact copy into plain and linked segments so the UI can underline only
 * the verify words without shipping HTML in the content file.
 */
export function factSegments(text: string, links: FactLink[] = []): FactSegment[] {
  if (links.length === 0) return [{ text }];
  let best: { index: number; link: FactLink } | null = null;
  for (const link of links) {
    if (!link.phrase) continue;
    const index = text.indexOf(link.phrase);
    if (index < 0) continue;
    if (!best || index < best.index) best = { index, link };
  }
  if (!best) return [{ text }];
  const { index, link } = best;
  const before = text.slice(0, index);
  const after = text.slice(index + link.phrase.length);
  return [
    ...(before ? [{ text: before }] : []),
    { text: link.phrase, url: link.url },
    ...factSegments(after, links),
  ];
}

function linksFor(entry: FactEntry): FactLink[] {
  if (entry.links && entry.links.length > 0) return entry.links;
  return [{ phrase: entry.anonymous, url: entry.source.url }];
}

/**
 * Resolve the header greeting and, for fun facts, the reference link that backs
 * the claim. `greetingFor` wraps this for callers that only need the text.
 */
export function greetingDetailFor(
  name: string | null | undefined,
  opts?: { now?: Date; timeZone?: string | null; style?: GreetingStyle | null },
): GreetingDetail {
  const now = opts?.now ?? new Date();
  const slot = slotFor(hourInTimezone(now, opts?.timeZone));
  const trimmed = name?.trim();
  const named = !!trimmed;

  let style = opts?.style ?? "mix";
  if (style === "mix") {
    const options: GreetingStyle[] = ["classic", "humor", "facts"];
    style = options[Math.floor(poolSeed * options.length) % options.length]!;
  }

  const withName = (phrase: string) =>
    trimmed ? phrase.replaceAll("{name}", trimmed) : phrase;

  if (style === "facts") {
    const index = Math.floor(visitSeed * FACTS.length) % FACTS.length;
    const entry = FACTS[index] ?? FACTS[0]!;
    // Facts are did-you-knows; trailing ", {name}" reads as nonsense.
    return {
      text: entry.anonymous,
      factSource: entry.source,
      factLinks: linksFor(entry),
    };
  }

  const pool = style === "humor" ? HUMOR : CLASSIC[slot];
  return { text: withName(pickFrom(pool, named, visitSeed)) };
}

export function greetingFor(
  name: string | null | undefined,
  opts?: { now?: Date; timeZone?: string | null; style?: GreetingStyle | null },
): string {
  return greetingDetailFor(name, opts).text;
}

/**
 * An anonymous fun fact for surfaces without a signed-in profile, like the
 * sign-in screen. Draws fresh per call; callers memoize per visit.
 */
export function randomFact(): {
  text: string;
  source: FactSource;
  links: FactLink[];
} {
  const index = Math.floor(Math.random() * FACTS.length);
  const entry = FACTS[index] ?? FACTS[0]!;
  return {
    text: entry.anonymous,
    source: entry.source,
    links: linksFor(entry),
  };
}
