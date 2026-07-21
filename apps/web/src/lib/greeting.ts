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

type FactEntry = { named: string; anonymous: string; source: FactSource };

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
};

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
    return {
      text: withName(named ? entry.named : entry.anonymous),
      factSource: entry.source,
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
export function randomFact(): { text: string; source: FactSource } {
  const index = Math.floor(Math.random() * FACTS.length);
  const entry = FACTS[index] ?? FACTS[0]!;
  return { text: entry.anonymous, source: entry.source };
}
