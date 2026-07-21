import { isoDate } from "@eaj/shared";
import { useEffect, useMemo, useState } from "react";
import type { UserProfile } from "../App";
import { api } from "../lib/api";
import { closeDayInsights, planningHint, type Insight, type StatPoint } from "../lib/insights";
import { defaultTemperatureUnit, formatTemp } from "../lib/weatherUi";

type Point = StatPoint & {
  weather: { tempMax?: number; precip?: number; holidayName?: string | null } | null;
};

type Range = "day" | "week" | "month" | "year";

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
  const tempUnit = user.temperatureUnit ?? defaultTemperatureUnit(user.country);

  useEffect(() => {
    const { from, to } = rangeBounds(range);
    void api<{ series: Point[] }>(`/api/stats?from=${from}&to=${to}`)
      .then((r) => setSeries(r.series))
      .catch((e) => setError(e instanceof Error ? e.message : "Stats failed"));
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

  const maxAbs = useMemo(() => {
    let m = 1;
    for (const p of series) m = Math.max(m, Math.abs(p.closingBalance), Math.abs(p.attwoodNet));
    return m;
  }, [series]);

  const avgClose = series.length
    ? Math.round(series.reduce((a, p) => a + p.closingBalance, 0) / series.length)
    : 0;

  const insights = useMemo<Insight[]>(() => {
    const lastClosed = [...insightSeries].reverse().find((p) => p.phase === "closed");
    const out = lastClosed ? closeDayInsights(insightSeries, lastClosed.date) : [];
    const hint = planningHint(insightSeries, isoDate());
    if (hint && !out.some((i) => i.id === hint.id)) out.push(hint);
    return out.slice(0, 3);
  }, [insightSeries]);

  return (
    <div>
      <div className="panel">
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Energy balance</h2>
        <div className="phase-bar">
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
        {error && <p className="error">{error}</p>}
        <div className="stats">
          <div className="stat">
            <div className="label">Days</div>
            <div className="value">{series.length}</div>
          </div>
          <div className="stat">
            <div className="label">Avg closing</div>
            <div className="value">{avgClose}</div>
          </div>
          <div className="stat">
            <div className="label">Holidays</div>
            <div className="value">{series.filter((p) => p.isHoliday).length}</div>
          </div>
          <div className="stat">
            <div className="label">Latest Attwood net</div>
            <div className="value">{series.at(-1)?.attwoodNet ?? "-"}</div>
          </div>
        </div>
        <p className="muted" style={{ marginTop: "1rem" }}>
          Bars show closing balance. Orange ticks mark holidays. Weather is from Open-Meteo when a
          location is set in Settings.
        </p>
        <div className="chart" aria-label="Closing balance chart">
          {series.map((p) => {
            const h = Math.max(4, (Math.abs(p.closingBalance) / maxAbs) * 140);
            const delta = p.closingBalance - avgClose;
            const deltaText =
              series.length > 1
                ? `, ${delta >= 0 ? "+" : ""}${delta} vs period average`
                : "";
            return (
              <div
                key={p.date}
                className={`bar ${p.closingBalance < 0 ? "neg" : ""} ${p.isHoliday ? "holiday" : ""}`}
                style={{ height: h }}
                title={`${p.date}: close ${p.closingBalance}${deltaText}, net ${p.attwoodNet}, ${p.completedCount}/${p.taskCount} done${
                  p.weather?.tempMax != null ? `, max ${formatTemp(p.weather.tempMax, tempUnit)}` : ""
                }`}
              />
            );
          })}
          {!series.length && <p className="muted">No closed or planned days in this range yet.</p>}
        </div>
      </div>

      {insights.length > 0 && (
        <div className="panel" style={{ marginTop: "1rem" }}>
          <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Insights</h2>
          {insights.map((i) => (
            <div key={i.id} className={`tip-card insight-${i.tone}`}>
              <p style={{ margin: 0 }}>{i.text}</p>
            </div>
          ))}
        </div>
      )}

      <div className="panel" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Day detail</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Close", "Attwood", "Feel", "Weather", "Holiday"].map((h) => (
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
                <tr key={p.date}>
                  <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--line)" }}>{p.date}</td>
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
      </div>
    </div>
  );
}
