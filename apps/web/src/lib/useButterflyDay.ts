/**
 * Live butterfly state for the signed-in shell.
 *
 * Watches the active day (numbers only; labels stay ciphertext) and resolves
 * the current ButterflyState. Refreshes after any day mutation via the
 * DAY_CHANGED_EVENT hook in api(), on tab focus, and on a slow interval, so
 * the header seal and the You page breathe with the day without polling hard.
 */

import { useCallback, useEffect, useState } from "react";
import { DAY_CHANGED_EVENT, api } from "./api";
import { resolveButterflyState, type ButterflyState } from "./butterflyState";

type ActiveDayNumbers = {
  day: {
    openingBalance: number;
    availableCapacity: number;
    phase: "plan" | "audit" | "closed";
    feelRating: number | null;
    attwood: { attwoodNet: number; depositTotal: number; withdrawalTotal: number };
    lines: { side: string; completed: boolean }[];
  } | null;
};

const REFRESH_MS = 90_000;

export function useButterflyDay(enabled: boolean): ButterflyState {
  const [state, setState] = useState<ButterflyState>(() =>
    resolveButterflyState({
      available: 100,
      opening: 100,
      depositTotal: 0,
      withdrawalTotal: 0,
      incompleteWithdrawals: 0,
      completedCount: 0,
      withdrawalHeavy: false,
      feelRating: null,
      phase: null,
    }),
  );

  const refresh = useCallback(async () => {
    try {
      const res = await api<ActiveDayNumbers>("/api/days/active");
      const day = res.day;
      setState(
        resolveButterflyState(
          day
            ? {
                available: day.availableCapacity,
                opening: day.openingBalance,
                depositTotal: day.attwood.depositTotal,
                withdrawalTotal: day.attwood.withdrawalTotal,
                incompleteWithdrawals: day.lines.filter(
                  (l) => l.side === "withdrawal" && !l.completed,
                ).length,
                completedCount: day.lines.filter((l) => l.completed).length,
                withdrawalHeavy: day.attwood.attwoodNet <= -20,
                feelRating: day.feelRating,
                phase: day.phase,
              }
            : {
                available: 100,
                opening: 100,
                depositTotal: 0,
                withdrawalTotal: 0,
                incompleteWithdrawals: 0,
                completedCount: 0,
                withdrawalHeavy: false,
                feelRating: null,
                phase: null,
              },
        ),
      );
    } catch {
      // Keep the last known pose; the seal degrades gracefully offline.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    let timer: number | null = null;
    const onChange = () => {
      if (timer != null) window.clearTimeout(timer);
      // Coalesce rapid day edits, focus events, and the interval.
      timer = window.setTimeout(() => void refresh(), 400);
    };
    const id = window.setInterval(onChange, REFRESH_MS);
    window.addEventListener(DAY_CHANGED_EVENT, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.clearInterval(id);
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener(DAY_CHANGED_EVENT, onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [enabled, refresh]);

  return state;
}

/** Live media query for prefers-reduced-motion, shared by butterfly surfaces. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
