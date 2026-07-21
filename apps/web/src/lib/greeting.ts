// Time-of-day-aware greeting for the header. Slot + phrase index freeze on the
// first call of the visit so the headline doesn't churn mid-session.

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

// {name} is replaced when the user has one; name-less variants otherwise.
const PHRASES: Record<Slot, { named: string[]; anonymous: string[] }> = {
  morning: {
    named: [
      "Good morning, {name}",
      "Hi {name} — what do we have on today?",
      "Morning, {name}. Let's plan the day.",
    ],
    anonymous: ["Good morning", "What do we have on today?", "A fresh sheet awaits."],
  },
  afternoon: {
    named: [
      "Good afternoon, {name}",
      "Hi {name} — how's the balance holding?",
      "{name}, checking in on the ledger?",
    ],
    anonymous: ["Good afternoon", "How's the balance holding?", "Midday check-in."],
  },
  evening: {
    named: [
      "Good evening, {name}",
      "Hi {name} — time to audit the day?",
      "Evening check-in, {name}.",
    ],
    anonymous: ["Good evening", "Time to audit the day?", "Evening check-in."],
  },
  night: {
    named: [
      "Quiet hours, {name}",
      "Hi {name} — the ledger's still open.",
      "{name}, a late look at the sheet.",
    ],
    anonymous: ["Quiet hours", "The ledger's still open.", "A late look at the sheet."],
  },
};

const visitSeed = Math.random();
let frozen: { slot: Slot; index: number } | null = null;

export function greetingFor(
  name: string | null | undefined,
  opts?: { now?: Date; timeZone?: string | null },
): string {
  const now = opts?.now ?? new Date();
  if (!frozen) {
    const slot = slotFor(hourInZone(now, opts?.timeZone));
    // Index against the longer (named) pool so named/anonymous share a pick.
    const index = Math.floor(visitSeed * PHRASES[slot].named.length);
    frozen = { slot, index };
  }
  const trimmed = name?.trim();
  const pool = trimmed ? PHRASES[frozen.slot].named : PHRASES[frozen.slot].anonymous;
  const phrase = pool[frozen.index % pool.length] ?? pool[0]!;
  return trimmed ? phrase.replaceAll("{name}", trimmed) : phrase;
}
