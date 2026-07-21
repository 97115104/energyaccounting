// Header greeting with selectable flavors. The time slot and random pick
// freeze on the first call of the visit so the headline doesn't churn
// mid-session; changing the style (Settings) re-resolves the phrase once.

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

/** Hour-of-day in the user's profile timezone when available; else device local. */
function hourInZone(now: Date, timeZone?: string | null): number {
  if (!timeZone) return now.getHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(now);
    const raw = parts.find((p) => p.type === "hour")?.value;
    if (raw == null) return now.getHours();
    return Number(raw) % 24;
  } catch {
    return now.getHours();
  }
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
    anonymous: ["Good morning", "What do we have on today?", "A fresh sheet awaits."],
  },
  afternoon: {
    named: [
      "Good afternoon, {name}",
      "Hi {name}, how's the balance holding?",
      "{name}, checking in on the ledger?",
    ],
    anonymous: ["Good afternoon", "How's the balance holding?", "Midday check-in."],
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
      "Hi {name}, the ledger's still open.",
      "{name}, a late look at the sheet.",
    ],
    anonymous: ["Quiet hours", "The ledger's still open.", "A late look at the sheet."],
  },
};

// Machine-written, ND-relatable one-liners. Dry and warm, never punching down.
const HUMOR: Pool = {
  named: [
    "Hi {name}. All 84 brain tabs are open and every one is important.",
    "Executive function is loading, {name}. Thanks for your patience.",
    "Welcome back, {name}. The hyperfocus chooses you, never the reverse.",
    "{name}, your social battery called. It wants a deposit.",
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
    "Your social battery called. It wants a deposit.",
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

// Machine-written hyperfixation bait. One line each so the h1 wraps politely.
const FACTS: Pool = {
  named: [
    "Hi {name}. Some giraffes can do simple addition with carrots.",
    "Fun fact, {name}: honeybees count landmarks as they fly.",
    "Wombat poop is cube-shaped, {name}. You needed to know.",
    "An octopus has one central brain and eight more in its arms, {name}.",
    "Gentoo penguins propose with a pebble. Anyway, hi {name}.",
    "Sea otters hold hands while they sleep, {name}.",
    "{name}, a day on Venus lasts longer than its year.",
    "Arctic ground squirrels can supercool below freezing in hibernation, {name}.",
    "Some caterpillars drum a secret beat so ants adopt them, {name}.",
    "Crows remember faces for years, {name}. Be nice to crows.",
    "Bananas are berries, {name}. Strawberries are not berries.",
    "Sharks are older than trees, {name}, and older than Saturn's rings.",
    "Skin cells turn over in weeks, {name}, while tooth enamel lasts a lifetime.",
    "Honey from ancient tombs is still edible, {name}.",
    "Axolotls can regrow parts of their own brain, {name}.",
    "Pigeons carry a built-in compass, {name}. Iron-rich cells.",
  ],
  anonymous: [
    "Some giraffes can do simple addition with carrots.",
    "Fun fact: honeybees count landmarks as they fly.",
    "Wombat poop is cube-shaped. You needed to know.",
    "An octopus has one central brain and eight more in its arms.",
    "Gentoo penguins propose with a pebble. Anyway, hello.",
    "Sea otters hold hands while they sleep.",
    "A day on Venus lasts longer than its year.",
    "Arctic ground squirrels can supercool below freezing in hibernation.",
    "Some caterpillars drum a secret beat so ants adopt them.",
    "Crows remember faces for years. Be nice to crows.",
    "Bananas are berries. Strawberries are not berries.",
    "Sharks are older than trees, and older than Saturn's rings.",
    "Skin cells turn over in weeks, while tooth enamel lasts a lifetime.",
    "Honey from ancient tombs is still edible.",
    "Axolotls can regrow parts of their own brain.",
    "Pigeons carry a built-in compass. Iron-rich cells.",
  ],
};

const visitSeed = Math.random();
// A second stream from the same seed so "which pool" and "which phrase"
// don't collapse into one draw for the mix style.
const poolSeed = (visitSeed * 9301 + 0.49297) % 1;
let frozenSlot: Slot | null = null;

function pickFrom(pool: Pool, named: boolean, seed: number): string {
  const list = named ? pool.named : pool.anonymous;
  const index = Math.floor(seed * list.length) % list.length;
  return list[index] ?? list[0]!;
}

export function greetingFor(
  name: string | null | undefined,
  opts?: { now?: Date; timeZone?: string | null; style?: GreetingStyle | null },
): string {
  const now = opts?.now ?? new Date();
  if (!frozenSlot) {
    frozenSlot = slotFor(hourInZone(now, opts?.timeZone));
  }
  const trimmed = name?.trim();
  const named = !!trimmed;

  let style = opts?.style ?? "mix";
  if (style === "mix") {
    const options: GreetingStyle[] = ["classic", "humor", "facts"];
    style = options[Math.floor(poolSeed * options.length) % options.length]!;
  }

  const pool =
    style === "humor" ? HUMOR : style === "facts" ? FACTS : CLASSIC[frozenSlot];
  const phrase = pickFrom(pool, named, visitSeed);
  return trimmed ? phrase.replaceAll("{name}", trimmed) : phrase;
}

/** Test hook: reset the per-visit frozen slot. */
export function resetGreetingStateForTests(): void {
  frozenSlot = null;
}
