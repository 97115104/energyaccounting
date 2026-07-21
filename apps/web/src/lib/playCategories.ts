/** Play-category deposit starters when withdrawals dominate (Stuart Brown / NIFPlay styles). */

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
};

const PROMPTS: PlayPrompt[] = [
  { category: "creator", label: "Doodle for ten minutes", typicalCost: 15 },
  { category: "creator", label: "Cook something fun", typicalCost: 25 },
  { category: "creator", label: "Make a short playlist", typicalCost: 10 },
  { category: "explorer", label: "Take a short walk somewhere new", typicalCost: 20 },
  { category: "explorer", label: "Timed wiki rabbit hole", typicalCost: 15 },
  { category: "explorer", label: "Browse a map of a place you like", typicalCost: 10 },
  { category: "competitor", label: "Play a quick game", typicalCost: 15 },
  { category: "competitor", label: "Personal best challenge", typicalCost: 20 },
  { category: "competitor", label: "Puzzle race", typicalCost: 15 },
  { category: "organizer", label: "Tidy one small zone for satisfaction", typicalCost: 15 },
  { category: "organizer", label: "Plan a fun outing", typicalCost: 10 },
  { category: "dreamer", label: "Daydream timer", typicalCost: 10 },
  { category: "dreamer", label: "Read a fiction chapter", typicalCost: 20 },
  { category: "dreamer", label: "Music with eyes closed", typicalCost: 15 },
  { category: "mover", label: "Stretch break", typicalCost: 10 },
  { category: "mover", label: "Dance to one song", typicalCost: 15 },
  { category: "mover", label: "Movement or stim break", typicalCost: 10 },
];

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

/** Pick a rotating set of play deposits, preferring labels already in the catalog when possible. */
export function suggestPlayDeposits(opts: {
  existingLabels: string[];
  count?: number;
  daySeed: string;
}): PlayPrompt[] {
  const count = opts.count ?? 3;
  const lower = new Set(opts.existingLabels.map((l) => l.toLowerCase()));
  const seed = hashSeed(opts.daySeed);
  const ranked = [...PROMPTS].sort((a, b) => {
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
