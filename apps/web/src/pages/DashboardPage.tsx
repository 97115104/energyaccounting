import { isoDate } from "@eaj/shared";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { UserProfile } from "../App";
import { api } from "../lib/api";
import { closeDayInsights, planningHint, type Insight, type StatPoint } from "../lib/insights";
import { defaultTemperatureUnit, formatTemp } from "../lib/weatherUi";

type Point = StatPoint & {
  weather: { tempMax?: number; precip?: number; holidayName?: string | null } | null;
};

type Range = "day" | "week" | "month" | "year";

/** Monday (local) of the calendar week containing dateIso. */
function weekStartIso(dateIso: string): string {
  const d = new Date(dateIso + "T12:00:00");
  const day = d.getDay(); // 0 Sunday
  const delta = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

function summarizeGroup(group: Point[]): Point {
  const mean = (pick: (point: Point) => number) =>
    Math.round((group.reduce((sum, point) => sum + pick(point), 0) / group.length) * 10) / 10;
  const rated = group.filter((point) => point.avgDifficulty != null);
  return {
    ...group[group.length - 1]!,
    date: group[group.length - 1]!.date,
    openingBalance: group[0]!.openingBalance,
    closingBalance: mean((point) => point.closingBalance),
    attwoodNet: mean((point) => point.attwoodNet),
    depositTotal: group.reduce((sum, point) => sum + point.depositTotal, 0),
    withdrawalTotal: group.reduce((sum, point) => sum + point.withdrawalTotal, 0),
    taskCount: group.reduce((sum, point) => sum + point.taskCount, 0),
    completedCount: group.reduce((sum, point) => sum + point.completedCount, 0),
    plannedTotal: group.reduce((sum, point) => sum + point.plannedTotal, 0),
    actualTotal: group.reduce((sum, point) => sum + point.actualTotal, 0),
    pendingReservedEnergy: group.at(-1)?.pendingReservedEnergy,
    completedFreedEnergy: group.reduce(
      (sum, point) => sum + (point.completedFreedEnergy ?? 0),
      0,
    ),
    availableCapacity: group.at(-1)?.availableCapacity,
    avgDifficulty: rated.length
      ? Math.round(
          (rated.reduce((sum, point) => sum + (point.avgDifficulty ?? 0), 0) / rated.length) * 10,
        ) / 10
      : null,
    difficultyRatedCount: group.reduce(
      (sum, point) => sum + (point.difficultyRatedCount ?? 0),
      0,
    ),
    isHoliday: group.some((point) => point.isHoliday),
    weather: null,
  };
}

/** Dense year ranges collapse to calendar-week averages so the chart stays readable. */
function bucketSeries(series: Point[]): Point[] {
  if (series.length <= 62) return series;
  const groups = new Map<string, Point[]>();
  for (const point of series) {
    const key = weekStartIso(point.date);
    const list = groups.get(key);
    if (list) list.push(point);
    else groups.set(key, [point]);
  }
  return [...groups.values()].map(summarizeGroup);
}

function dayLabel(p: Pick<Point, "date" | "startedAt">): string {
  const start = new Date(p.startedAt);
  const time = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${p.date} · ${time}`;
}

function rangeBounds(kind: Range): { from: string; to: string } {
  const to = isoDate();
  const d = new Date(to + "T12:00:00");
  if (kind === "day") {
    /* same day */
  } else if (kind === "week") d.setDate(d.getDate() - 6);
  else if (kind === "month") d.setDate(d.getDate() - 29);
  else d.setFullYear(d.getFullYear() - 1);
  return { from: isoDate(d), to };
}

export function DashboardPage({ user }: { user: UserProfile }) {
  const [range, setRange] = useState<Range>("week");
  const [series, setSeries] = useState<Point[]>([]);
  // Insights need a fixed ~60-day window so streak/average copy is not
  // silently scoped to whatever chart range the user clicked.
  const [insightSeries, setInsightSeries] = useState<StatPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const navigate = useNavigate();
  const tempUnit = user.temperatureUnit ?? defaultTemperatureUnit(user.country);

  useEffect(() => {
    const { from, to } = rangeBounds(range);
    setLoading(true);
    setError(null);
    void api<{ series: Point[] }>(`/api/stats?from=${from}&to=${to}`)
      .then((r) => setSeries(r.series))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your day summary."))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    const to = isoDate();
    const from = new Date(to + "T12:00:00Z");
    from.setUTCDate(from.getUTCDate() - 60);
    const fromIso = from.toISOString().slice(0, 10);
    void api<{ series: StatPoint[] }>(`/api/stats?from=${fromIso}&to=${to}`)
      .then((r) => setInsightSeries(r.series))
      .catch(() => undefined);
  }, []);

  const previousDays = useMemo(
    () => series.filter((point) => point.phase === "closed"),
    [series],
  );
  const displayed = useMemo(() => bucketSeries(previousDays), [previousDays]);
  const maxAbs = useMemo(() => {
    let m = 1;
    for (const p of displayed) m = Math.max(m, Math.abs(p.closingBalance), Math.abs(p.attwoodNet));
    return m;
  }, [displayed]);

  const avgClose = previousDays.length
    ? Math.round(previousDays.reduce((a, p) => a + p.closingBalance, 0) / previousDays.length)
    : 0;

  const insights = useMemo<Insight[]>(() => {
    const lastClosed = [...insightSeries]
      .filter((p) => p.phase === "closed")
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
      .at(-1);
    const out = lastClosed ? closeDayInsights(insightSeries, lastClosed.id) : [];
    const hint = planningHint(insightSeries, isoDate());
    if (hint && !out.some((i) => i.id === hint.id)) out.push(hint);
    return out.slice(0, 3);
  }, [insightSeries]);
  const latest = useMemo(() => {
    const active = [...series].reverse().find((p) => p.phase !== "closed");
    return active ?? series.at(-1);
  }, [series]);
  const bucketing = displayed.length < series.length;
  const completionRate = series.reduce((sum, point) => sum + point.taskCount, 0)
    ? Math.round(
        (series.reduce((sum, point) => sum + point.completedCount, 0) /
          series.reduce((sum, point) => sum + point.taskCount, 0)) *
          100,
      )
    : 0;
  const takeaway = latest
    ? latest.phase === "closed"
      ? latest.closingBalance >= avgClose
        ? `Latest day ended with ${latest.closingBalance} energy remaining, ${Math.abs(latest.closingBalance - avgClose)} points above this period's average.`
        : `Latest day ended with ${latest.closingBalance} energy remaining, ${Math.abs(latest.closingBalance - avgClose)} points below this period's average.`
      : `${latest.availableCapacity ?? 0} points available now · ${latest.closingBalance} projected remaining if plans hold.`
    : "Close a day to begin building a useful energy history.";

  return (
    <div className="dashboard">
      <section className="panel dashboard-hero">
        <div className="dashboard-heading">
          <div>
            <p className="ob-eyebrow">Energy briefing</p>
            <h2>{takeaway}</h2>
          </div>
          <div className="phase-bar dashboard-range" aria-label="Dashboard range">
          {(["day", "week", "month", "year"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              className={`btn ${range === r ? "accent" : "secondary"}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {loading && <p className="muted">Reading your days…</p>}
        <div className="dashboard-primary">
          <div>
            <span className="dashboard-value">{latest?.closingBalance ?? "Unavailable"}</span>
            <span className="muted">latest energy remaining</span>
          </div>
          <p>{completionRate}% of planned lines completed in this period.</p>
        </div>
        <div
          className="balance-chart"
          role="group"
          aria-label={
            bucketing
              ? "Weekly average energy remaining by week"
              : "Energy remaining when the day closed"
          }
        >
          <div className="balance-zero" aria-hidden="true" />
          {displayed.map((p) => {
            const height = Math.max(3, (Math.abs(p.closingBalance) / maxAbs) * 48);
            const positive = p.closingBalance >= 0;
            const weekLabel = bucketing ? weekStartIso(p.date) : p.date;
            return (
              <button
                key={p.id}
                type="button"
                className={`balance-mark ${positive ? "positive" : "negative"} ${p.isHoliday ? "holiday" : ""}`}
                aria-label={
                  bucketing
                    ? `Week of ${weekLabel}, average energy remaining ${p.closingBalance}.`
                    : `${dayLabel(p)}, energy remaining ${p.closingBalance}, Attwood net ${p.attwoodNet}, ${p.completedCount} of ${p.taskCount} completed`
                }
                title={
                  bucketing
                    ? `Week of ${weekLabel}: avg remaining ${p.closingBalance}`
                    : `${dayLabel(p)}: remaining ${p.closingBalance}, net ${p.attwoodNet}`
                }
                onClick={() => navigate(`/?day=${p.id}`)}
              >
                <span
                  className="balance-mark-bar"
                  style={{ height: `${height}%` }}
                  aria-hidden="true"
                />
              </button>
            );
          })}
          {!loading && !previousDays.length && (
            <p className="muted dashboard-empty">No closed days in this range yet.</p>
          )}
        </div>
        <div className="chart-caption">
          <span>Negative</span>
          <span>{bucketing ? "Calendar-week averages" : "Per day"}</span>
          <span>Positive</span>
        </div>
      </section>

      <section className="panel capacity-platter">
        <div>
          <p className="ob-eyebrow">Reusable capacity</p>
          <h2>Completed work releases reservations for reuse.</h2>
          <p className="muted">Freed points are throughput within the same day; they do not add to energy remaining.</p>
        </div>
        <div className="capacity-values">
          <div><strong>{latest?.availableCapacity ?? 0}</strong><span>Available on latest day</span></div>
          <div><strong>{latest?.pendingReservedEnergy ?? 0}</strong><span>Still reserved</span></div>
          <div><strong>{latest?.completedFreedEnergy ?? 0}</strong><span>Freed on that day</span></div>
        </div>
      </section>

      {insights.length > 0 && (
        <section className="panel dashboard-insights">
          <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Insights</h2>
          {insights.map((i) => (
            <div key={i.id} className={`tip-card insight-${i.tone}`}>
              <p style={{ margin: 0 }}>{i.text}</p>
            </div>
          ))}
        </section>
      )}

      <section className="panel dashboard-days">
        <div className="dashboard-heading">
          <div>
            <h2>Previous days</h2>
            <p className="muted">
              Closed days open read-only. From there, choose to edit the record or confirm permanent
              deletion.
            </p>
          </div>
          <button
            type="button"
            className="btn secondary dashboard-details-toggle"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? "Hide details" : "Show details"}
          </button>
        </div>
        {detailsOpen && (
          <ul className="dashboard-day-list">
            {previousDays.map((p) => {
              const weather =
                p.weather?.tempMax != null
                  ? `${formatTemp(p.weather.tempMax, tempUnit)}${p.weather.precip != null ? `, ${p.weather.precip}mm` : ""}`
                  : null;
              const holiday = p.isHoliday ? p.weather?.holidayName || "Holiday" : null;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className="dashboard-day-row"
                    aria-label={`Open day ${dayLabel(p)}`}
                    onClick={() => navigate(`/?day=${p.id}`)}
                  >
                    <span className="dashboard-day-when">{dayLabel(p)}</span>
                    <span className="dashboard-day-meta">
                      <span>
                        <em>Left</em> {p.closingBalance}
                      </span>
                      <span>
                        <em>Attwood</em> {p.attwoodNet}
                      </span>
                      <span>
                        <em>Feel</em> {p.feelRating ?? "—"}
                      </span>
                      {weather && (
                        <span>
                          <em>Weather</em> {weather}
                        </span>
                      )}
                      {holiday && (
                        <span>
                          <em>Holiday</em> {holiday}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {!previousDays.length && (
              <li>
                <p className="muted">Closed energy days will appear here.</p>
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
