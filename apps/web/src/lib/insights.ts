// Local heuristics over the user's own numeric history ("machine intelligence"
// without any external calls). Works entirely on the plaintext fields the
// server can aggregate, including balances, costs, completion flags, and feel ratings,
// so encrypted labels and journals never leave the device's trust boundary.
//
// Tone guardrail: rules fire as celebration, neutral observation, or gentle
// suggestion. A below-average day produces either nothing or the "you showed
// up anyway" framing. Nothing here shames.

import { mean, weekdayName } from "./dateIso";

export type StatPoint = {
  id: string;
  date: string;
  startedAt: string;
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
  pendingReservedEnergy?: number;
  completedFreedEnergy?: number;
  availableCapacity?: number;
  avgDifficulty?: number | null;
  difficultyRatedCount?: number;
  plannedTotal: number;
  actualTotal: number;
};

export type InsightTone = "celebrate" | "notice" | "gentle";
export type Insight = { id: string; tone: InsightTone; text: string };

/** Closed days strictly before the target row, oldest first. */
const MIN_HISTORY = 5;

function historyBefore(series: StatPoint[], target: StatPoint): StatPoint[] {
  const targetStart = Date.parse(target.startedAt);
  return series.filter(
    (p) => p.phase === "closed" && Date.parse(p.startedAt) < targetStart,
  );
}

export function recentClosedCount(series: StatPoint[], withinDays = 7): number {
  const cutoff = Date.now() - withinDays * 86_400_000;
  return series.filter(
    (p) => p.phase === "closed" && Date.parse(p.startedAt) >= cutoff,
  ).length;
}

/**
 * Insights for the moment a day is closed. `series` should include the just
 * closed day. Returns the top few, best first; empty when history is thin.
 */
export function closeDayInsights(series: StatPoint[], dayId: string): Insight[] {
  const today = series.find((p) => p.id === dayId);
  if (!today) return [];
  const history = historyBefore(series, today);
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

    // Personal best energy remaining in the recent window.
    const best = Math.max(...recent.slice(-21).map((p) => p.closingBalance));
    if (today.closingBalance > best) {
      out.push({
        id: "best-balance",
        tone: "celebrate",
        text: `Most energy left at day's end across ${Math.min(recent.length, 21)} closed days. That margin is real.`,
      });
    }

    // High completion on a day that felt hard on average.
    if (
      today.avgDifficulty != null &&
      today.avgDifficulty >= 7 &&
      today.completedCount >= 2 &&
      today.difficultyRatedCount != null &&
      today.difficultyRatedCount >= 2
    ) {
      out.push({
        id: "hard-and-done",
        tone: "celebrate",
        text: `Average difficulty ${today.avgDifficulty}/10 and you still finished ${today.completedCount}. That is not nothing.`,
      });
    }

    // Energy-adding discipline: banked noticeably more rest than usual.
    const avgDeposit = mean(recent.map((p) => p.depositTotal));
    if (avgDeposit > 0 && today.depositTotal >= avgDeposit * 1.25 && today.depositTotal > 0) {
      out.push({
        id: "deposit-discipline",
        tone: "celebrate",
        text: `You logged more recharge today than you usually do (${today.depositTotal} vs a typical ${Math.round(avgDeposit)}).`,
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

  // Recent closes: count by day start time, not calendar gaps.
  const recentClosed = recentClosedCount(series, 7);
  if (recentClosed >= 3) {
    out.push({
      id: "streak",
      tone: "celebrate",
      text: `That's ${recentClosed} energy days closed in the last week. The practice is sticking.`,
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
  const history = series.filter((p) => p.phase === "closed");
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
      text: `${weekday}s usually cost you more than they give. Worth planning something that adds energy up front.`,
    };
  }
  return null;
}
