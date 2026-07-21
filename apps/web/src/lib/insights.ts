// Local heuristics over the user's own numeric history ("machine intelligence"
// without any external calls). Works entirely on the plaintext fields the
// server can aggregate — balances, costs, completion flags, feel ratings —
// so encrypted labels and journals never leave the device's trust boundary.
//
// Tone guardrail: rules fire as celebration, neutral observation, or gentle
// suggestion. A below-average day produces either nothing or the "you showed
// up anyway" framing. Nothing here shames.

export type StatPoint = {
  date: string;
  openingBalance: number;
  closingBalance: number;
  attwoodNet: number;
  depositTotal: number;
  withdrawalTotal: number;
  isHoliday: boolean;
  feelRating: number | null;
  phase: string;
  taskCount: number;
  completedCount: number;
  plannedTotal: number;
  actualTotal: number;
};

export type InsightTone = "celebrate" | "notice" | "gentle";
export type Insight = { id: string; tone: InsightTone; text: string };

/** Closed days strictly before `date`, oldest first. */
const MIN_HISTORY = 5;

function historyBefore(series: StatPoint[], date: string): StatPoint[] {
  return series.filter((p) => p.phase === "closed" && p.date < date);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function weekdayName(dateIso: string): string {
  return new Date(dateIso + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

function prevIsoDate(dateIso: string): string {
  const d = new Date(dateIso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Consecutive closed calendar days ending at `date` (inclusive). */
export function closedStreak(series: StatPoint[], date: string): number {
  const closedDates = new Set(
    series.filter((p) => p.phase === "closed").map((p) => p.date),
  );
  let streak = 0;
  let cursor = date;
  while (closedDates.has(cursor)) {
    streak += 1;
    cursor = prevIsoDate(cursor);
  }
  return streak;
}

/**
 * Insights for the moment a day is closed. `series` should include the just
 * closed day. Returns the top few, best first; empty when history is thin.
 */
export function closeDayInsights(series: StatPoint[], date: string): Insight[] {
  const today = series.find((p) => p.date === date);
  if (!today) return [];
  const history = historyBefore(series, date);
  const recent = history.slice(-30);
  const out: Insight[] = [];

  if (recent.length >= MIN_HISTORY) {
    // Above your average: completed tasks vs the 30-day mean.
    const avgCompleted = mean(recent.map((p) => p.completedCount));
    if (today.completedCount >= avgCompleted + 1.5 && today.completedCount > 0) {
      const avgRounded = Math.round(avgCompleted * 10) / 10;
      out.push({
        id: "above-average-completed",
        tone: "celebrate",
        text: `You completed ${today.completedCount} things today. Your recent average is ${avgRounded}. That gap is real effort.`,
      });
    }

    // Personal best closing balance in the recent window.
    const best = Math.max(...recent.slice(-21).map((p) => p.closingBalance));
    if (today.closingBalance > best) {
      out.push({
        id: "best-balance",
        tone: "celebrate",
        text: `Highest closing balance in ${Math.min(recent.length, 21)} closed days. The bank approves.`,
      });
    }

    // Deposit discipline: banked noticeably more rest than usual.
    const avgDeposit = mean(recent.map((p) => p.depositTotal));
    if (avgDeposit > 0 && today.depositTotal >= avgDeposit * 1.25 && today.depositTotal > 0) {
      out.push({
        id: "deposit-discipline",
        tone: "celebrate",
        text: `You banked more recharge today than you usually do (${today.depositTotal} vs a typical ${Math.round(avgDeposit)}).`,
      });
    }

    // Planning accuracy: |planned - actual| shrinking week over week.
    const lastWeek = history.slice(-7);
    const weekBefore = history.slice(-14, -7);
    if (lastWeek.length >= 4 && weekBefore.length >= 4) {
      const err = (p: StatPoint) => Math.abs(p.plannedTotal - p.actualTotal);
      const recentErr = mean(lastWeek.map(err));
      const priorErr = mean(weekBefore.map(err));
      if (priorErr > 0 && recentErr <= priorErr * 0.8) {
        out.push({
          id: "sharper-estimates",
          tone: "notice",
          text: `Your estimates are getting sharper: off by ${Math.round(recentErr)} on average this week, down from ${Math.round(priorErr)}.`,
        });
      }
    }
  }

  // Streak needs its own consecutive-days check, no average required.
  const streak = closedStreak(series, date);
  if (streak >= 3) {
    out.push({
      id: "streak",
      tone: "celebrate",
      text: `That's ${streak} days audited in a row. The ledger notices consistency.`,
    });
  }

  // Hard day, closed anyway. Fires without history so rough first weeks
  // still get the point of the practice reflected back.
  if (today.closingBalance < today.openingBalance && out.length === 0) {
    out.push({
      id: "showed-up",
      tone: "gentle",
      text: "Today cost more than it gave, and you still showed up to audit it. Logging the hard days is the whole point.",
    });
  }

  const order: Record<InsightTone, number> = { celebrate: 0, notice: 1, gentle: 2 };
  return out.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 3);
}

/**
 * A single gentle hint for the planning phase: does this weekday historically
 * run heavier than the rest of the week? Null when history is thin or the
 * pattern isn't there.
 */
export function planningHint(series: StatPoint[], date: string): Insight | null {
  const history = historyBefore(series, date);
  if (history.length < 10) return null;
  const weekday = weekdayName(date);
  const sameDay = history.filter((p) => weekdayName(p.date) === weekday);
  const others = history.filter((p) => weekdayName(p.date) !== weekday);
  if (sameDay.length < 3 || others.length < 5) return null;
  const sameNet = mean(sameDay.map((p) => p.attwoodNet));
  const otherNet = mean(others.map((p) => p.attwoodNet));
  // Meaningfully heavier than the baseline, and a net drain outright.
  if (sameNet < 0 && sameNet <= otherNet - 10) {
    return {
      id: "weekday-pattern",
      tone: "gentle",
      text: `${weekday}s usually cost you more than they give. Worth planning a deposit up front.`,
    };
  }
  return null;
}
