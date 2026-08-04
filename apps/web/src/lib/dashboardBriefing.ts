import { mean } from "./dateIso";
import type { StatLinePoint, StatPoint } from "./insights";

export type DayChartRow = {
  id: "planned-use" | "planned-add" | "projected-close";
  label: string;
  value: number;
  compare: string;
  tone: "withdrawal" | "deposit" | "signed";
  width: number;
};

export type DayBriefing = {
  headline: string;
  primaryValue: number | string;
  primaryLabel: string;
  completionText: string;
  chartRows: DayChartRow[];
  insight: string;
};

export type TrendMetric = {
  label: string;
  tone: "signed" | "neutral";
  recent: number;
  delta: number | null;
};

export type DashboardRange = "day" | "week" | "month" | "year";

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayMs(dateIso: string) {
  return Date.parse(`${dateIso}T12:00:00Z`);
}

function pointDayMs(point: Pick<StatPoint, "date" | "startedAt" | "closedAt">) {
  const lifecycleAt = point.closedAt ?? point.startedAt;
  const day = lifecycleAt.slice(0, 10) || point.date;
  const ms = utcDayMs(day);
  return Number.isFinite(ms) ? ms : Date.parse(lifecycleAt);
}

function closedDaysByDate(points: StatPoint[]) {
  return points
    .filter((point) => point.phase === "closed")
    .sort((a, b) => pointDayMs(a) - pointDayMs(b));
}

function closedWithin(points: StatPoint[], todayMs: number, days: number) {
  const startMs = todayMs - (days - 1) * DAY_MS;
  return points.filter((point) => {
    const dayMs = pointDayMs(point);
    return Number.isFinite(dayMs) && dayMs >= startMs && dayMs <= todayMs;
  });
}

function spanDays(points: StatPoint[]) {
  if (points.length < 2) return points.length;
  const first = pointDayMs(points[0]!);
  const last = pointDayMs(points[points.length - 1]!);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return points.length;
  return Math.floor((last - first) / DAY_MS) + 1;
}

function distinctMonthCount(points: StatPoint[]) {
  return new Set(points.map((point) => (point.date || point.startedAt.slice(0, 10)).slice(0, 7))).size;
}

export function chooseDashboardRange(points: StatPoint[], todayIso: string): DashboardRange {
  const closed = closedDaysByDate(points);
  if (closed.length < 2) return "day";

  const todayMs = utcDayMs(todayIso);
  if (!Number.isFinite(todayMs)) return "day";

  const week = closedWithin(closed, todayMs, 7);
  const month = closedWithin(closed, todayMs, 30);
  const year = closedWithin(closed, todayMs, 365);

  if (year.length >= 45 && spanDays(year) >= 90 && distinctMonthCount(year) >= 4) {
    return "year";
  }
  if (month.length >= 8 && spanDays(month) >= 12) {
    return "month";
  }
  if (week.length >= 3) {
    return "week";
  }
  if (month.length >= 4 && spanDays(month) >= 7) {
    return "month";
  }
  return "day";
}

function recentClosedBefore(latest: StatPoint, history: StatPoint[]) {
  const latestStart = Date.parse(latest.closedAt ?? latest.startedAt);
  return history
    .filter((point) => point.phase === "closed" && Date.parse(point.closedAt ?? point.startedAt) < latestStart)
    .sort((a, b) => Date.parse(a.closedAt ?? a.startedAt) - Date.parse(b.closedAt ?? b.startedAt));
}

function roundedMean(points: StatPoint[], pick: (point: StatPoint) => number) {
  return Math.round(mean(points.map(pick)));
}

function compareLabel(current: number, average: number | null, noun: string) {
  if (average == null) return "Baseline grows after three closed days";
  const delta = current - average;
  if (Math.abs(delta) <= 4) return `Near your recent ${noun} average of ${average}`;
  return delta > 0
    ? `${delta} above your recent ${noun} average of ${average}`
    : `${Math.abs(delta)} below your recent ${noun} average of ${average}`;
}

export function sideLabel(side: StatLinePoint["side"]) {
  return side === "deposit" ? "Add energy" : "Use energy";
}

function sameActivityMovedSide(latest: StatPoint, history: StatPoint[]) {
  const previous = [...history].reverse().find((point) => point.lines?.some((line) => line.labelHash));
  if (!previous?.lines?.length || !latest.lines?.length) return null;
  const previousByHash = new Map(
    previous.lines
      .filter((line) => line.labelHash)
      .map((line) => [line.labelHash!, line]),
  );
  for (const line of latest.lines) {
    if (!line.labelHash) continue;
    const prior = previousByHash.get(line.labelHash);
    if (!prior || prior.side === line.side) continue;
    const label = line.label?.trim() || prior.label?.trim() || "A recurring activity";
    return `${label} moved to ${sideLabel(line.side)} today after appearing in ${sideLabel(prior.side)} on the previous closed day. That pattern points to context shaping whether it gives or uses energy.`;
  }
  return null;
}

export function buildDayBriefing(latest: StatPoint | undefined, history: StatPoint[] = []): DayBriefing {
  if (!latest) {
    return {
      headline: "Close a day to begin building a useful energy history.",
      primaryValue: "Unavailable",
      primaryLabel: "projected energy at close",
      completionText: "Add a line to build today's plan.",
      chartRows: [],
      insight: "After you close more days, this briefing will compare today's plan with your own closed-day baseline.",
    };
  }

  const closed = recentClosedBefore(latest, history);
  const recent = closed.slice(-7);
  const enoughHistory = recent.length >= 3;
  const plannedAverage = enoughHistory ? roundedMean(recent, (point) => point.plannedTotal) : null;
  const useAverage = enoughHistory ? roundedMean(recent, (point) => point.withdrawalTotal) : null;
  const addAverage = enoughHistory ? roundedMean(recent, (point) => point.depositTotal) : null;
  const closeAverage = enoughHistory ? roundedMean(recent, (point) => point.closingBalance) : null;
  const values = [
    latest.withdrawalTotal,
    latest.depositTotal,
    Math.abs(latest.closingBalance),
    Math.abs(useAverage ?? 0),
    Math.abs(addAverage ?? 0),
    Math.abs(closeAverage ?? 0),
  ];
  const max = Math.max(1, ...values);
  const widthFor = (value: number) => Math.max(6, Math.min(100, Math.round((Math.abs(value) / max) * 100)));
  const available = latest.availableCapacity ?? 0;
  const plannedComparison = plannedAverage == null
    ? `${latest.plannedTotal} points planned today with ${available} available now.`
    : latest.plannedTotal >= plannedAverage
      ? `${latest.plannedTotal} points planned today, ${latest.plannedTotal - plannedAverage} above your recent closed-day average.`
      : `${latest.plannedTotal} points planned today, ${plannedAverage - latest.plannedTotal} below your recent closed-day average.`;

  const movedInsight = sameActivityMovedSide(latest, closed);
  let insight = movedInsight;
  if (!insight && enoughHistory && useAverage != null && addAverage != null) {
    if (latest.withdrawalTotal > useAverage + 5 && latest.depositTotal < addAverage - 5) {
      insight = "Today's use plan is above your recent baseline while add energy is below it. The useful check is whether one short add-energy line belongs before the largest demand.";
    } else if (latest.withdrawalTotal > useAverage + 5 && latest.depositTotal > addAverage + 5) {
      insight = "Today is heavier on both sides than recent days. The plan is asking more and also creating more recovery inside the same day.";
    } else if (latest.depositTotal > addAverage + 5) {
      insight = "Today includes more add energy than your recent baseline. Watch whether those lines happen early enough to change the day while it is still underway.";
    } else {
      insight = "Today sits close to your recent baseline. The useful signal is whether completion changes available energy before the evening audit.";
    }
  }
  insight ??= "After you close more days, this briefing will compare today's plan with your own closed-day baseline.";

  return {
    headline: plannedComparison,
    primaryValue: latest.closingBalance,
    primaryLabel: latest.phase === "closed" ? "energy remaining at close" : "projected energy at close",
    completionText: latest.taskCount
      ? `${latest.completedCount} of ${latest.taskCount} planned lines completed today.`
      : "Add a line to build today's plan.",
    chartRows: [
      {
        id: "planned-use",
        label: "Planned use",
        value: latest.withdrawalTotal,
        compare: compareLabel(latest.withdrawalTotal, useAverage, "use"),
        tone: "withdrawal",
        width: widthFor(latest.withdrawalTotal),
      },
      {
        id: "planned-add",
        label: "Planned add",
        value: latest.depositTotal,
        compare: compareLabel(latest.depositTotal, addAverage, "add"),
        tone: "deposit",
        width: widthFor(latest.depositTotal),
      },
      {
        id: "projected-close",
        label: latest.phase === "closed" ? "Closed with" : "Projected close",
        value: latest.closingBalance,
        compare: compareLabel(latest.closingBalance, closeAverage, "close"),
        tone: "signed",
        width: widthFor(latest.closingBalance),
      },
    ],
    insight,
  };
}

function trendDriver(metrics: TrendMetric[]) {
  const sourceMovements = metrics.filter(
    (metric) =>
      (metric.label === "Energy used / day" || metric.label === "Energy added / day") &&
      metric.delta != null,
  );
  const candidates = sourceMovements.length
    ? sourceMovements
    : metrics.filter((metric) => metric.label !== "Energy at close" && metric.delta != null);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))[0]!;
}

function driverPhrase(metric: TrendMetric | null) {
  if (!metric || metric.delta == null) return "the comparison window is still filling in";
  const delta = Math.round(metric.delta);
  const amount = Math.abs(delta);
  if (metric.label === "Energy used / day") {
    return delta >= 0 ? `energy used rose by ${amount} points per day` : `energy used fell by ${amount} points per day`;
  }
  if (metric.label === "Energy added / day") {
    return delta >= 0 ? `energy added rose by ${amount} points per day` : `energy added fell by ${amount} points per day`;
  }
  if (metric.label === "Attwood net") {
    return delta >= 0 ? `Attwood net improved by ${amount} points` : `Attwood net fell by ${amount} points`;
  }
  return delta >= 0 ? `${metric.label} rose by ${amount}` : `${metric.label} fell by ${amount}`;
}

export function buildTrendNarrative(metrics: TrendMetric[], closedCount: number): string {
  if (closedCount < 2 || metrics.length === 0) {
    return "Close a few more days and this view will start comparing the last seven closes with the window before them.";
  }
  const close = metrics.find((metric) => metric.label === "Energy at close");
  if (!close || close.delta == null) {
    return "This view is using the closed days available so far. After a few more closes, the comparison will show which part of the system is moving first, namely use, add, net, or close.";
  }
  const recentClose = Math.round(close.recent);
  const closeDelta = Math.round(close.delta);
  const driver = driverPhrase(trendDriver(metrics));
  if (closeDelta <= -5) {
    return `Your average close across the last seven closed days is ${recentClose}, down ${Math.abs(closeDelta)} points from the prior window. The strongest companion movement is that ${driver}. The next useful check is whether high-use days have enough Add energy planned before the largest demand.`;
  }
  if (closeDelta >= 5) {
    return `Your average close across the last seven closed days is ${recentClose}, up ${closeDelta} points from the prior window. The strongest companion movement is that ${driver}. Look for the repeatable choice in that change so it can be planned again.`;
  }
  return `Your average close across the last seven closed days is ${recentClose}, within ${Math.abs(closeDelta)} points of the prior window. The strongest companion movement is that ${driver}. The useful check is whether this steady range still leaves enough room for the hardest planned days.`;
}
