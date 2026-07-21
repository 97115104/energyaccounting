/**
 * Research-backed suggestion corpus for the tips engine.
 *
 * Each entry stores its trigger conditions alongside a short note on the
 * research it draws from, so the selection logic (and any future
 * embedding-based ranking) works from stored knowledge, with no hardcoded
 * strings scattered through the UI.
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
  firstName?: string;
  recentLowFeel?: boolean;
  /** Count of recent rated days inspected for the low-feel signal (0–3). */
  recentRatedSample?: number;
  timeOfDay?: "morning" | "afternoon" | "evening";
  familiarRestorer?: string | null;
  heavyWeekday?: string | null;
  /** Default true. When false, skip tips that recommend outdoor/physical activity. */
  includePhysicalActivities?: boolean;
};

export type CorpusEntry = {
  id: string;
  title: string;
  body: string;
  /** Why this suggestion exists, surfaced in the guide's "Why this?" panel. */
  research: string;
  /** Citation link for the research basis, opened from the guide card. */
  sourceUrl: string;
  /** Higher wins when more tips match than fit. */
  priority: number;
  /** True only when matching depends on the person's own history. */
  personalized?: boolean;
  /** Tips that recommend walks/outdoor activity; filtered when physical is off. */
  physical?: boolean;
  matches: (ctx: CorpusContext) => boolean;
};

const DRY_KINDS: WeatherKind[] = ["sun", "cloud"];

export const TIPS_CORPUS: CorpusEntry[] = [
  {
    id: "low-feel-nourish",
    title: "A steadier next step",
    body: "A little tired lately{firstName}? Before another push, pause for water and something simple with a fruit or vegetable plus protein. This is ordinary care, not a cure for a hard stretch of days.",
    research:
      "CDC healthy-eating guidance recommends varied fruits, vegetables, and protein foods as part of an eating pattern that supports health and well-being. It does not claim food will change how recent days felt.",
    sourceUrl: "https://www.cdc.gov/healthy-weight-growth/healthy-eating/index.html",
    priority: 11,
    // Personal history times the tip; the research is general nutrition, not mood causation.
    personalized: true,
    matches: (c) => !!c.recentLowFeel && c.available >= 5,
  },
  {
    id: "afternoon-microbreak",
    title: "Interrupt the afternoon drain",
    body: "Your day is using more energy than it is adding{firstName}. A short, screen-free pause now can reduce fatigue before you decide what deserves the next points.",
    research:
      "A 2022 meta-analysis found that micro-breaks improve vigor and reduce fatigue, with longer breaks tending to produce larger effects.",
    sourceUrl: "https://doi.org/10.1371/journal.pone.0272460",
    priority: 10,
    matches: (c) =>
      c.timeOfDay === "afternoon" &&
      c.withdrawalTotal > c.depositTotal &&
      c.available >= 5,
  },
  {
    id: "personal-restorer",
    title: "Use what already works for you",
    body: "Your history keeps returning to “{familiarRestorer}” as a way to add energy. A small version may fit the day you have now.",
    research:
      "Energy Accounting emphasizes deliberately scheduling personally restorative activities rather than relying on generic recommendations.",
    sourceUrl: "https://energyaccounting.com/",
    priority: 10,
    personalized: true,
    matches: (c) => !!c.familiarRestorer && c.available >= 5,
  },
  {
    id: "heavy-weekday",
    title: "Plan the heavier weekday gently",
    body: "{heavyWeekday}s usually cost you more than they give{firstName}. Leave a little room in today’s 100, or schedule one small way to add energy early.",
    research:
      "Energy Accounting practice recommends planning restorative activity on historically depleting weekdays before the day overruns.",
    sourceUrl: "https://energyaccounting.com/",
    priority: 10,
    personalized: true,
    matches: (c) => !!c.heavyWeekday && c.available >= 5,
  },
  {
    id: "uv-low-walk",
    title: "Green light for the outdoors",
    body: "Today's UV max is low, so sunscreen logistics stay light. A 20-minute walk or short hike is one of the least costly ways to add energy.",
    research:
      "Green-exercise meta-analyses (Barton & Pretty 2010) find mood and self-esteem gains from even 5-minute outdoor doses; low UV removes the sunburn cost.",
    sourceUrl: "https://doi.org/10.1021/es903183r",
    priority: 8,
    physical: true,
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
    body: "Today's UV peaks in the moderate range, so outside is very doable with a hat or a shady route. Daylight now also helps tonight's sleep, which can make the next day's 100 points easier to protect.",
    research:
      "Morning/afternoon daylight advances circadian phase and improves sleep quality (Wright et al. 2013); moderate UV (3–5) is safe with basic shade.",
    sourceUrl: "https://doi.org/10.1016/j.cub.2013.06.039",
    priority: 6,
    physical: true,
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
    body: "Today's UV max is high. If you want outdoor time, lean toward early morning or evening, or pick a shaded route to add the same energy with a lower burn tax.",
    research:
      "WHO UV index guidance recommends limiting midday exposure above UV 6; timing shifts preserve the mood benefit of outdoor activity.",
    sourceUrl:
      "https://www.who.int/news-room/questions-and-answers/item/radiation-the-ultraviolet-(uv)-index",
    priority: 7,
    physical: true,
    matches: (c) =>
      c.isDaylight && c.uvMax != null && c.uvMax >= 6 && DRY_KINDS.includes(c.weatherKind),
  },
  {
    id: "rain-indoor",
    title: "Rainy day rhythm",
    body: "Things that use energy outdoors can cost extra in the rain. Indoor play, including music, a fiction chapter, and a slow stretch, can add energy without fighting the weather.",
    research:
      "Weather–mood studies (Denissen et al. 2008) show rain modestly raises perceived effort for outdoor tasks; substituting indoor restorative activity avoids the penalty.",
    sourceUrl: "https://doi.org/10.1037/1528-3542.8.5.662",
    priority: 6,
    matches: (c) => c.weatherKind === "rain" || c.weatherKind === "thunder",
  },
  {
    id: "snow-gentle",
    title: "Snow day economics",
    body: "Snow makes everything cost a little more, including travel, errands, and even getting dressed. Budget generously for things that use energy and let one thing slide guilt-free.",
    research:
      "Energy Accounting practice (Toudal & Attwood) recommends increasing estimates for things that use energy under adverse conditions to avoid end-of-day deficit surprises.",
    sourceUrl: "https://energyaccounting.com/",
    priority: 6,
    matches: (c) => c.weatherKind === "snow",
  },
  {
    id: "fog-light",
    title: "Low-light day",
    body: "Grey, foggy light can quietly drain alertness. A bright lamp, a warm drink, and one small finished task beat forcing a big push.",
    research:
      "Reduced daylight exposure lowers alertness and mood via melanopsin pathways; bright indoor light partially compensates (Cajochen 2007).",
    sourceUrl: "https://doi.org/10.1016/j.smrv.2007.07.009",
    priority: 5,
    matches: (c) => c.weatherKind === "fog",
  },
  {
    id: "rebalance-play",
    title: "More energy is going out than coming in",
    body: "The day is taking away more energy than it adds. Play that adds energy is useful work because it helps you finish with more remaining.",
    research:
      "Attwood's Energy Accounting frames deliberate energy-adding activities as the corrective for depleting days; play styles follow Stuart Brown's taxonomy.",
    sourceUrl: "https://energyaccounting.com/",
    priority: 7,
    matches: (c) => c.withdrawalTotal > c.depositTotal,
  },
  {
    id: "boundaries",
    title: "Protect the remaining pool",
    body: "Several things that use energy are still open. Finishing one frees capacity, and saying no to a brand-new drain protects your energy.",
    research:
      "Task-switching and open-loop tasks carry attentional residue (Leroy 2009); closing loops returns capacity faster than starting new ones.",
    sourceUrl: "https://doi.org/10.1016/j.obhdp.2009.04.002",
    priority: 6,
    matches: (c) => c.incompleteWithdrawals >= 3,
  },
  {
    id: "deposit-window",
    title: "Room to add energy",
    body: "There's meaningful capacity left today. A short restorative activity can add energy now and often steadies the rest of the day, with an effect that resembles compounding interest.",
    research:
      "Micro-break research (Albulescu et al. 2022) shows breaks as short as 10 minutes measurably reduce fatigue and boost vigor.",
    sourceUrl: "https://doi.org/10.1371/journal.pone.0272460",
    priority: 5,
    matches: (c) => c.available >= 30 && c.depositTotal <= c.withdrawalTotal,
  },
  {
    id: "sun-general",
    title: "Sunlight window",
    body: "Bright weather makes a short outdoor activity a strong way to add energy. Match the size of the outing to the capacity you actually have left.",
    research:
      "Sunlight exposure correlates with serotonin turnover (Lambert et al. 2002); dose-matching helps an energy-adding activity avoid using energy.",
    sourceUrl: "https://doi.org/10.1016/s0140-6736(02)11737-5",
    priority: 4,
    physical: true,
    matches: (c) => c.weatherKind === "sun",
  },
];

/** Highest-priority matching entries, capped. Deterministic: same input, same tips. */
export function selectFromCorpus(ctx: CorpusContext, max: number): CorpusEntry[] {
  const includePhysical = ctx.includePhysicalActivities !== false;
  return TIPS_CORPUS.filter((e) => (includePhysical || !e.physical) && e.matches(ctx))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max);
}
