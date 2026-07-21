// Header greeting with selectable flavors. The random pick freezes on the
// first call of the visit so the headline doesn't churn mid-session, but the
// time-of-day slot always tracks the current hour, so a tab left open from
// morning into evening greets accordingly.

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

// {name} is replaced when the user has one; name-less variants otherwise.
const CLASSIC: Record<Slot, Pool> = {
  morning: {
    named: [
      "Good morning, {name}",
      "Hi {name}, what do we have on today?",
      "Morning, {name}. Let's plan the day.",
    ],
    anonymous: ["Good morning", "What do we have on today?", "A fresh day awaits."],
  },
  afternoon: {
    named: [
      "Good afternoon, {name}",
      "Hi {name}, how's your energy holding?",
      "{name}, checking in on your day?",
    ],
    anonymous: ["Good afternoon", "How's your energy holding?", "Midday check-in."],
  },
  evening: {
    named: [
      "Good evening, {name}",
      "Hi {name}, time to audit the day?",
      "Evening check-in, {name}.",
    ],
    anonymous: ["Good evening", "Time to audit the day?", "Evening check-in."],
  },
  night: {
    named: [
      "Quiet hours, {name}",
      "Hi {name}, your day's still open.",
      "{name}, a late look at your day.",
    ],
    anonymous: ["Quiet hours", "Your day's still open.", "A late look at your day."],
  },
};

// Machine-written, ND-relatable one-liners. Dry and warm, never punching down.
const HUMOR: Pool = {
  named: [
    "Hi {name}. All 84 brain tabs are open and every one is important.",
    "Executive function is loading, {name}. Thanks for your patience.",
    "Welcome back, {name}. The hyperfocus chooses you, never the reverse.",
    "{name}, your social battery called. Please add energy.",
    "One quick weather check later, {name}, it's 3 am and you know everything about orcas.",
    "Hi {name}. Today's plan: one thing. Today's brain: forty things.",
    "The dopamine is stored in the checked-off task, {name}.",
    "Body doubling counts, {name}. This journal is your body double.",
    "Routine is a load-bearing wall, {name}. Wear the comfort hoodie.",
    "Task initiation sold separately, {name}. Batteries not included.",
    "Time is a suggestion, {name}. Waiting mode is a lifestyle.",
    "{name}, five-minute task, three-hour side quest. Log both.",
    "Your 293rd hobby says hi back, {name}.",
    "Small talk survived. Emergency exit located. Hi {name}.",
    "Pattern recognition champion reporting for duty, {name}.",
    "Comfort hoodie activated. Hi {name}.",
  ],
  anonymous: [
    "All 84 brain tabs are open and every one is important.",
    "Executive function is loading. Thanks for your patience.",
    "The hyperfocus chooses you, never the reverse.",
    "Your social battery called. Please add energy.",
    "One quick weather check later, it's 3 am and you know everything about orcas.",
    "Today's plan: one thing. Today's brain: forty things.",
    "The dopamine is stored in the checked-off task.",
    "Body doubling counts. This journal is your body double.",
    "Routine is a load-bearing wall. Wear the comfort hoodie.",
    "Task initiation sold separately. Batteries not included.",
    "Time is a suggestion. Waiting mode is a lifestyle.",
    "Five-minute task, three-hour side quest. Log both.",
    "Your 293rd hobby says hi back.",
    "Small talk survived. Emergency exit located.",
    "Pattern recognition champion reporting for duty.",
    "Comfort hoodie activated.",
  ],
};

export type FactSource = { label: string; url: string };

// Machine-written hyperfixation bait. Each fact carries a reference so the
// header can link out to where the claim is documented or explained.
type FactEntry = { named: string; anonymous: string; source: FactSource };

const FACTS: FactEntry[] = [
  {
    named: "Hi {name}. Some giraffes can tell larger quantities from smaller ones.",
    anonymous: "Some giraffes can tell larger quantities from smaller ones.",
    source: { label: "Animal Cognition", url: "https://doi.org/10.1007/s10071-021-01507-2" },
  },
  {
    named: "Fun fact, {name}: honeybees can count landmarks as they fly.",
    anonymous: "Fun fact: honeybees can count landmarks as they fly.",
    source: { label: "Springer", url: "https://doi.org/10.1007/s00114-008-0464-y" },
  },
  {
    named: "Wombat poop is cube-shaped, {name}. You needed to know.",
    anonymous: "Wombat poop is cube-shaped. You needed to know.",
    source: {
      label: "National Geographic",
      url: "https://www.nationalgeographic.com/animals/article/why-does-wombat-poop-cube-shaped-scientists-narrow-in-on-the-answer",
    },
  },
  {
    named: "An octopus has one central brain and eight more in its arms, {name}.",
    anonymous: "An octopus has one central brain and eight more in its arms.",
    source: {
      label: "Scientific American",
      url: "https://www.scientificamerican.com/article/the-mind-of-an-octopus/",
    },
  },
  {
    named: "Gentoo penguins propose with a pebble. Anyway, hi {name}.",
    anonymous: "Gentoo penguins propose with a pebble. Anyway, hello.",
    source: { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Gentoo_penguin" },
  },
  {
    named: "Sea otters hold hands while they sleep, {name}.",
    anonymous: "Sea otters hold hands while they sleep.",
    source: { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Sea_otter" },
  },
  {
    named: "{name}, a day on Venus lasts longer than its year.",
    anonymous: "A day on Venus lasts longer than its year.",
    source: { label: "NASA", url: "https://science.nasa.gov/venus/venus-facts/" },
  },
  {
    named: "Arctic ground squirrels can supercool below freezing in hibernation, {name}.",
    anonymous: "Arctic ground squirrels can supercool below freezing in hibernation.",
    source: {
      label: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/Arctic_ground_squirrel",
    },
  },
  {
    named: "Some caterpillars drum a secret beat so ants adopt them, {name}.",
    anonymous: "Some caterpillars drum a secret beat so ants adopt them.",
    source: {
      label: "Science",
      url: "https://www.science.org/content/article/caterpillar-uses-vibrations-summon-army-ant-bodyguards",
    },
  },
  {
    named: "Crows remember faces for years, {name}. Be nice to crows.",
    anonymous: "Crows remember faces for years. Be nice to crows.",
    source: {
      label: "Univ. of Washington",
      url: "https://www.washington.edu/news/2011/09/13/crows-can-distinguish-faces-in-a-crowd/",
    },
  },
  {
    named: "Bananas are berries, {name}. Strawberries are not berries.",
    anonymous: "Bananas are berries. Strawberries are not berries.",
    source: { label: "Britannica", url: "https://www.britannica.com/story/is-a-banana-a-berry" },
  },
  {
    named: "Sharks are older than trees, {name}, and older than Saturn's rings.",
    anonymous: "Sharks are older than trees, and older than Saturn's rings.",
    source: {
      label: "Natural History Museum",
      url: "https://www.nhm.ac.uk/discover/how-old-are-sharks.html",
    },
  },
  {
    named: "Tooth enamel is the hardest substance your body makes, {name}.",
    anonymous: "Tooth enamel is the hardest substance your body makes.",
    source: {
      label: "Cleveland Clinic",
      url: "https://my.clevelandclinic.org/health/body/22458-tooth-enamel",
    },
  },
  {
    named: "Honey basically never spoils, {name}.",
    anonymous: "Honey basically never spoils.",
    source: {
      label: "Smithsonian",
      url: "https://www.smithsonianmag.com/science-nature/the-science-behind-honeys-eternal-shelf-life-1218690/",
    },
  },
  {
    named: "Axolotls can regrow parts of their own brain, {name}.",
    anonymous: "Axolotls can regrow parts of their own brain.",
    source: { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Axolotl" },
  },
  {
    named: "Pigeons can sense Earth's magnetic field, {name}.",
    anonymous: "Pigeons can sense Earth's magnetic field.",
    source: { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Magnetoreception" },
  },
  // Butterfly facts: the app's own symbol earns a deeper bench in the pool.
  {
    named: "Butterflies taste with their feet, {name}.",
    anonymous: "Butterflies taste with their feet.",
    source: {
      label: "Smithsonian",
      url: "https://www.si.edu/spotlight/buginfo/butterfly",
    },
  },
  {
    named: "{name}, monarchs navigate thousands of miles with a sun compass in their antennae.",
    anonymous: "Monarchs navigate thousands of miles with a sun compass in their antennae.",
    source: {
      label: "Science",
      url: "https://www.science.org/doi/10.1126/science.1176221",
    },
  },
  {
    named: "Inside the chrysalis a caterpillar mostly dissolves before becoming a butterfly, {name}.",
    anonymous: "Inside the chrysalis a caterpillar mostly dissolves before becoming a butterfly.",
    source: {
      label: "Scientific American",
      url: "https://www.scientificamerican.com/article/caterpillar-butterfly-metamorphosis-explainer/",
    },
  },
  {
    named: "Some butterflies remember what they learned as caterpillars, {name}.",
    anonymous: "Some butterflies remember what they learned as caterpillars.",
    source: {
      label: "PLOS ONE",
      url: "https://doi.org/10.1371/journal.pone.0001736",
    },
  },
  {
    named: "Morpho wings are not blue pigment, {name}. The color is built from microscopic structure.",
    anonymous: "Morpho wings are not blue pigment. The color is built from microscopic structure.",
    source: {
      label: "Natural History Museum",
      url: "https://www.nhm.ac.uk/discover/how-do-butterflies-get-their-colour.html",
    },
  },
  {
    named: "Butterflies can see ultraviolet patterns on wings that people cannot, {name}.",
    anonymous: "Butterflies can see ultraviolet patterns on wings that people cannot.",
    source: {
      label: "Wikipedia",
      url: "https://en.wikipedia.org/wiki/Butterfly#Senses",
    },
  },
];

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
