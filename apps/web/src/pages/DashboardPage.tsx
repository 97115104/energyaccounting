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

function ledgerLabel(p: Pick<Point, "date" | "startedAt">): string {
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
      .catch((e) => setError(e instanceof Error ? e.message : "Stats failed"))
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

  const displayed = useMemo(() => bucketSeries(series), [series]);
  const maxAbs = useMemo(() => {
    let m = 1;
    for (const p of displayed) m = Math.max(m, Math.abs(p.closingBalance), Math.abs(p.attwoodNet));
    return m;
  }, [displayed]);

  const avgClose = series.length
    ? Math.round(series.reduce((a, p) => a + p.closingBalance, 0) / series.length)
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
        ? `Latest ledger ended with ${latest.closingBalance} energy remaining, ${Math.abs(latest.closingBalance - avgClose)} points above this period's average.`
        : `Latest ledger ended with ${latest.closingBalance} energy remaining, ${Math.abs(latest.closingBalance - avgClose)} points below this period's average.`
      : `${latest.availableCapacity ?? 0} points available now · ${latest.closingBalance} projected remaining if plans hold.`
    : "Close a ledger to begin building a useful energy history.";

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
        {loading && <p className="muted">Reading the ledger…</p>}
        <div className="dashboard-primary">
          <div>
            <span className="dashboard-value">{latest?.closingBalance ?? "—"}</span>
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
              : "Energy remaining at ledger close"
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
                    : `${ledgerLabel(p)}, energy remaining ${p.closingBalance}, Attwood net ${p.attwoodNet}, ${p.completedCount} of ${p.taskCount} completed`
                }
                title={
                  bucketing
                    ? `Week of ${weekLabel}: avg remaining ${p.closingBalance}`
                    : `${ledgerLabel(p)}: remaining ${p.closingBalance}, net ${p.attwoodNet}`
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
          {!loading && !series.length && (
            <p className="muted dashboard-empty">No planned or closed days in this range yet.</p>
          )}
        </div>
        <div className="chart-caption">
          <span>Negative</span>
          <span>{bucketing ? "Calendar-week averages" : "Per ledger"}</span>
          <span>Positive</span>
        </div>
      </section>

      <section className="panel capacity-platter">
        <div>
          <p className="ob-eyebrow">Reusable capacity</p>
          <h2>Completed work releases reservations for reuse.</h2>
          <p className="muted">Freed points are throughput within the same ledger; they do not add to energy remaining.</p>
        </div>
        <div className="capacity-values">
          <div><strong>{latest?.availableCapacity ?? 0}</strong><span>Available on latest ledger</span></div>
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
          <h2>All ledgers</h2>
          <button type="button" className="btn secondary" onClick={() => setDetailsOpen((open) => !open)}>
            {detailsOpen ? "Hide details" : "Show details"}
          </button>
        </div>
        {detailsOpen && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Started", "Left", "Attwood", "Feel", "Weather", "Holiday"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      borderBottom: "1px solid var(--line)",
                      padding: "0.5rem",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((p) => (
                <tr
                  key={p.id}
                  className="dashboard-day-row"
                  tabIndex={0}
                  role="link"
                  aria-label={`Open ledger ${ledgerLabel(p)}`}
                  onClick={() => navigate(`/?day=${p.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/?day=${p.id}`);
                    }
                  }}
                >
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--line)" }}>
                    {ledgerLabel(p)}
                  </td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--line)" }}>
                    {p.closingBalance}
                  </td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--line)" }}>
                    {p.attwoodNet}
                  </td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--line)" }}>
                    {p.feelRating ?? "-"}
                  </td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--line)" }}>
                    {p.weather?.tempMax != null
                      ? `${formatTemp(p.weather.tempMax, tempUnit)}${p.weather.precip != null ? `, ${p.weather.precip}mm` : ""}`
                      : "-"}
                  </td>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--line)" }}>
                    {p.isHoliday ? p.weather?.holidayName || "Yes" : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>
    </div>
  );
}
