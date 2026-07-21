/**
 * Research-backed suggestion corpus for the tips engine.
 *
 * Each entry stores its trigger conditions alongside a short note on the
 * research it draws from, so the selection logic (and any future
 * embedding-based ranking) works from stored knowledge rather than
 * hardcoded strings scattered through the UI.
 */

import type { WeatherKind } from "./weatherUi";

export type CorpusContext = {
  weatherKind: WeatherKind;
  /** Open-Meteo daily max UV index; null when location is unset. */
  uvMax: number | null;
  /** Gate UV tips: daily max is only actionable while the sun is up. */
  isDaylight: boolean;
  available: number;
  depositTotal: number;
  withdrawalTotal: number;
  incompleteWithdrawals: number;
};

export type CorpusEntry = {
  id: string;
  title: string;
  body: string;
  /** Why this suggestion exists — kept with the data, shown nowhere (yet). */
  research: string;
  /** Higher wins when more tips match than fit. */
  priority: number;
  matches: (ctx: CorpusContext) => boolean;
};

const DRY_KINDS: WeatherKind[] = ["sun", "cloud"];

export const TIPS_CORPUS: CorpusEntry[] = [
  {
    id: "uv-low-walk",
    title: "Green light for the outdoors",
    body: "Today's UV max is low, so sunscreen logistics stay light. A 20-minute walk or short hike is one of the cheapest energy deposits on the menu.",
    research:
      "Green-exercise meta-analyses (Barton & Pretty 2010) find mood and self-esteem gains from even 5-minute outdoor doses; low UV removes the sunburn cost.",
    priority: 8,
    matches: (c) =>
      c.isDaylight &&
      c.uvMax != null &&
      c.uvMax <= 2 &&
      DRY_KINDS.includes(c.weatherKind) &&
      c.available >= 10,
  },
  {
    id: "uv-moderate-outside",
    title: "Outdoor window is open",
    body: "Today's UV peaks in the moderate range — outside is very doable with a hat or a shady route. Daylight now also helps tonight's sleep, which can make the next ledger's 100 points easier to protect.",
    research:
      "Morning/afternoon daylight advances circadian phase and improves sleep quality (Wright et al. 2013); moderate UV (3–5) is safe with basic shade.",
    priority: 6,
    matches: (c) =>
      c.isDaylight &&
      c.uvMax != null &&
      c.uvMax >= 3 &&
      c.uvMax <= 5 &&
      DRY_KINDS.includes(c.weatherKind) &&
      c.available >= 10,
  },
  {
    id: "uv-high-shift",
    title: "Sun is spicy today",
    body: "Today's UV max is high. If you want outdoor time, lean toward early morning or evening, or pick a shaded route — same deposit, lower burn tax.",
    research:
      "WHO UV index guidance recommends limiting midday exposure above UV 6; timing shifts preserve the mood benefit of outdoor activity.",
    priority: 7,
    matches: (c) =>
      c.isDaylight && c.uvMax != null && c.uvMax >= 6 && DRY_KINDS.includes(c.weatherKind),
  },
  {
    id: "rain-indoor",
    title: "Rainy day rhythm",
    body: "Outdoor withdrawals cost extra in the rain. Indoor play deposits — music, a fiction chapter, a slow stretch — refill without fighting the weather.",
    research:
      "Weather–mood studies show rain modestly raises perceived effort for outdoor tasks; substituting indoor restorative activity avoids the penalty.",
    priority: 6,
    matches: (c) => c.weatherKind === "rain" || c.weatherKind === "thunder",
  },
  {
    id: "snow-gentle",
    title: "Snow day economics",
    body: "Snow makes everything cost a little more — travel, errands, even getting dressed. Budget generously for withdrawals and let one thing slide guilt-free.",
    research:
      "Energy Accounting practice (Toudal & Attwood) recommends inflating withdrawal estimates under adverse conditions to avoid end-of-day deficit surprises.",
    priority: 6,
    matches: (c) => c.weatherKind === "snow",
  },
  {
    id: "fog-light",
    title: "Low-light day",
    body: "Grey, foggy light can quietly drain alertness. A bright lamp, a warm drink, and one small finished task beat forcing a big push.",
    research:
      "Reduced daylight exposure lowers alertness and mood via melanopsin pathways; bright indoor light partially compensates (Cajochen 2007).",
    priority: 5,
    matches: (c) => c.weatherKind === "fog",
  },
  {
    id: "rebalance-play",
    title: "Withdrawals are ahead",
    body: "The ledger is tilting toward withdrawals. A play deposit isn't slacking — it helps you finish the day with more energy remaining.",
    research:
      "Attwood's Energy Accounting frames deliberate deposits as the corrective for withdrawal-heavy days; play styles follow Stuart Brown's taxonomy.",
    priority: 7,
    matches: (c) => c.withdrawalTotal > c.depositTotal,
  },
  {
    id: "boundaries",
    title: "Protect the remaining pool",
    body: "Several withdrawals are still open. Finishing one frees capacity — and saying no to a brand-new drain counts as a deposit of boundary energy.",
    research:
      "Task-switching and open-loop tasks carry attentional residue (Leroy 2009); closing loops returns capacity faster than starting new ones.",
    priority: 6,
    matches: (c) => c.incompleteWithdrawals >= 3,
  },
  {
    id: "deposit-window",
    title: "Room for a deposit",
    body: "There's meaningful capacity left today. A short restorative deposit now often steadies the whole rest of the day — compounding interest, but for energy.",
    research:
      "Micro-break research (Albulescu et al. 2022) shows breaks as short as 10 minutes measurably reduce fatigue and boost vigor.",
    priority: 5,
    matches: (c) => c.available >= 30 && c.depositTotal <= c.withdrawalTotal,
  },
  {
    id: "sun-general",
    title: "Sunlight window",
    body: "Bright weather makes a short outdoor anything a strong deposit. Match the size of the outing to the capacity you actually have left.",
    research:
      "Sunlight exposure correlates with serotonin turnover (Lambert et al. 2002); dose-matching prevents the deposit from becoming a withdrawal.",
    priority: 4,
    matches: (c) => c.weatherKind === "sun",
  },
];

/** Highest-priority matching entries, capped. Deterministic: same input, same tips. */
export function selectFromCorpus(ctx: CorpusContext, max: number): CorpusEntry[] {
  return TIPS_CORPUS.filter((e) => e.matches(ctx))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max);
}
