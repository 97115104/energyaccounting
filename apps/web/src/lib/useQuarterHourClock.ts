import { useEffect, useState } from "react";

const QUARTER_MS = 15 * 60_000;

/** Align to the next :00 / :15 / :30 / :45 so weather-now can flip with the forecast. */
function msUntilNextQuarter(now = Date.now()): number {
  const elapsed = now % QUARTER_MS;
  return elapsed === 0 ? QUARTER_MS : QUARTER_MS - elapsed;
}

/**
 * Re-render on each quarter-hour boundary (and immediately when enabled).
 * Used so quips, sky kind, and the Energy Guide track forecast conditions without a refresh.
 */
export function useQuarterHourClock(enabled = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return;
    // Snap to "now" on enable so history→active doesn't keep a frozen bucket.
    setNow(new Date());
    let intervalId = 0;
    const tick = () => setNow(new Date());
    const timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, QUARTER_MS);
    }, msUntilNextQuarter());
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [enabled]);

  return now;
}
