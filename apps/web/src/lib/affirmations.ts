/**
 * Short affirmations for the sign-in card, rotated daily. Copy lives in
 * content/affirmations.json so the pool can grow without touching picker logic.
 * Tone rules: warm, plain language, energy-accounting friendly, never saccharine,
 * and no productivity guilt.
 */
import AFFIRMATIONS_JSON from "../content/affirmations.json";

export const AFFIRMATIONS: string[] = AFFIRMATIONS_JSON;

/**
 * The day's affirmation: a deterministic daily rotation so the line feels
 * intentional rather than slot-machine random, and everyone on a device
 * shares the same one for the day.
 */
export function dailyAffirmation(now: Date = new Date()): string {
  // Key on the local calendar date so the line changes at the person's
  // midnight, not at UTC midnight.
  const dayKey = Math.floor(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000,
  );
  const len = AFFIRMATIONS.length;
  const index = ((dayKey % len) + len) % len;
  return AFFIRMATIONS[index] ?? AFFIRMATIONS[0]!;
}
