/** Play-category starters that add energy when the day is depleting (Stuart Brown / NIFPlay). */

import PROMPTS_JSON from "../content/play-prompts.json";

export type PlayCategory =
  | "creator"
  | "explorer"
  | "competitor"
  | "organizer"
  | "dreamer"
  | "mover";

export type PlayPrompt = {
  category: PlayCategory;
  label: string;
  typicalCost: number;
  /** When true, skip if the person prefers non-physical activity suggestions. */
  physical: boolean;
};

const PROMPTS: PlayPrompt[] = PROMPTS_JSON as PlayPrompt[];

const CATEGORY_LABEL: Record<PlayCategory, string> = {
  creator: "Creator",
  explorer: "Explorer",
  competitor: "Competitor",
  organizer: "Organizer",
  dreamer: "Dreamer",
  mover: "Mover",
};

export function playCategoryTitle(c: PlayCategory): string {
  return CATEGORY_LABEL[c];
}

/** Pick rotating play options that add energy, preferring familiar labels when possible. */
export function suggestPlayDeposits(opts: {
  existingLabels: string[];
  count?: number;
  daySeed: string;
  /** Default true: include walks, dance, stretch, mover prompts. */
  includePhysicalActivities?: boolean;
}): PlayPrompt[] {
  const count = opts.count ?? 3;
  const includePhysical = opts.includePhysicalActivities !== false;
  const lower = new Set(opts.existingLabels.map((l) => l.toLowerCase()));
  const seed = hashSeed(opts.daySeed);
  const pool = includePhysical ? PROMPTS : PROMPTS.filter((p) => !p.physical);
  const ranked = [...pool].sort((a, b) => {
    const aHit = lower.has(a.label.toLowerCase()) ? 0 : 1;
    const bHit = lower.has(b.label.toLowerCase()) ? 0 : 1;
    if (aHit !== bHit) return aHit - bHit;
    return (hashSeed(a.label + seed) % 97) - (hashSeed(b.label + seed) % 97);
  });
  const seen = new Set<PlayCategory>();
  const out: PlayPrompt[] = [];
  for (const p of ranked) {
    if (seen.has(p.category) && out.length < count) continue;
    if (out.some((o) => o.label === p.label)) continue;
    out.push(p);
    seen.add(p.category);
    if (out.length >= count) break;
  }
  return out;
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
