import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { isWithdrawalHeavy, isoDate } from "@eaj/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { UserProfile } from "../App";
import { HelpTip } from "../components/HelpTip";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { SiteFooter } from "../components/SiteFooter";
import { WeatherDetailModal } from "../components/WeatherDetailModal";
import { WeatherGlyph } from "../components/WeatherGlyph";
import { api } from "../lib/api";
import {
  decryptText,
  encryptText,
  getSessionDek,
  labelHash,
} from "../lib/crypto";
import {
  buildGuide,
  recoveryPlan,
  type GuideItem,
} from "../lib/energyGuide";
import {
  closeDayInsights,
  planningHint,
  type Insight,
  type StatPoint,
} from "../lib/insights";
import {
  buildPersonalIntelligence,
  type IntelligenceCatalogItem,
  type IntelligenceDay,
} from "../lib/personalIntelligence";
import { loadPersonalData } from "../lib/personalData";
import { recentDisabledReason } from "../lib/planShortcuts";
import { withPreservedScroll } from "../lib/preserveScroll";
import { prefetchSuggestModel, suggestCost } from "../lib/suggest";
import { liveTimezone } from "../lib/timezone";
import { parseDayWeather } from "../lib/weatherInsight";
import {
  defaultTemperatureUnit,
  formatTemp,
  formatTempRange,
  isDaylightPeriod,
  skyPeriod,
  weatherKindFromCode,
  weatherLabel,
  weatherQuip,
} from "../lib/weatherUi";

type Line = {
  id: string;
  side: "deposit" | "withdrawal";
  sort: number;
  labelCiphertext: string;
  labelIv: string;
  plannedCost: number;
  actualCost: number | null;
  completed: boolean;
  difficulty: number | null;
  detailsCiphertext: string | null;
  detailsIv: string | null;
  details?: string;
  label?: string;
};

type Suggestion = {
  id: string;
  side: "deposit" | "withdrawal";
  labelCiphertext: string;
  labelIv: string;
  labelHash: string;
  typicalCost: number;
  weekdayMask: number;
  useCount: number;
  typicalDifficulty: number | null;
  difficultyCount: number;
  lastUsed: string;
  label?: string;
};

/** Slim shape of the suggestions API `recent` collection (prior-ledger lines). */
type RecentActivity = {
  id: string;
  side: "deposit" | "withdrawal";
  labelCiphertext: string;
  labelIv: string;
  labelHash: string;
  typicalCost: number;
  lastUsed: string;
  label?: string;
};

type DayPayload = {
  id: string;
  date: string;
  startedAt: string;
  openingBalance: number;
  closingBalance: number | null;
  projectedClosing: number;
  availableCapacity: number;
  phase: string;
  feelRating: number | null;
  journalCiphertext: string | null;
  journalIv: string | null;
  compensateNoteCiphertext: string | null;
  compensateNoteIv: string | null;
  weather: Record<string, unknown> | null;
  isHoliday: boolean;
  attwood: { depositTotal: number; withdrawalTotal: number; attwoodNet: number };
  lines: Line[];
};

// Details are capped so one note cannot balloon the encrypted payload; the
// warning threshold surfaces the counter before typing or dictation hits it.
const DETAILS_MAX = 5000;
const DETAILS_WARN_AT = 4500;

type SpeechTarget = "journal" | "details";

type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

async function fetchRecentStats(): Promise<StatPoint[]> {
  const to = isoDate();
  const from = new Date(to + "T12:00:00Z");
  from.setUTCDate(from.getUTCDate() - 60);
  const fromIso = from.toISOString().slice(0, 10);
  const res = await api<{ series: StatPoint[] }>(`/api/stats?from=${fromIso}&to=${to}`);
  return res.series;
}

/** One trend line for the card/modal, Apple-Trends style: a recent average
    compared against the average of the closed days before it. */
type TrendWindow = { recent: number; delta: number | null };

function average(nums: number[]): number {
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

/**
 * Last-7-closed-days average vs the (up to 30) closed days before them.
 * Delta stays null until there are at least 3 prior days, so early arrows
 * never over-claim a pattern.
 */
function trendWindow(values: number[]): TrendWindow | null {
  if (values.length < 2) return null;
  const recent = values.slice(-7);
  const prior = values.slice(0, -7).slice(-30);
  const recentAvg = average(recent);
  return {
    recent: recentAvg,
    delta: prior.length >= 3 ? recentAvg - average(prior) : null,
  };
}

/** Tiny line chart with a soft area fill; colors come from currentColor. */
function TrendSpark({ values, className }: { values: number[]; className?: string }) {
  const w = 120;
  const h = 34;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => ({
    x: i * step,
    y: h - 3 - ((v - min) / span) * (h - 6),
  }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="currentColor" opacity="0.12" stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Direction arrow for a trend delta. "signed" tones color the arrow by
 * direction (for metrics where up is unambiguously more energy left);
 * "neutral" keeps it muted, since using more energy is not a failure here.
 */
function TrendArrow({ delta, tone = "signed" }: { delta: number; tone?: "signed" | "neutral" }) {
  const up = delta >= 0;
  const cls = tone === "signed" ? (up ? " up" : " down") : "";
  return (
    <span className={`trend-arrow${cls}`} aria-hidden="true">
      {up ? "↗" : "↘"}
    </span>
  );
}

function guideDismissKey(dayId: string): string {
  return `eaj-guide-dismissed:${dayId}`;
}

function loadDismissedGuideIds(dayId: string): Set<string> {
  try {
    const raw = localStorage.getItem(guideDismissKey(dayId));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
      />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2Zm-2 18a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-1h-4v1Z"
      />
    </svg>
  );
}

export function TodayPage({ user }: { user: UserProfile }) {
  const [params, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const historyDayId = params.get("day");
  const isHistoryView = !!historyDayId;
  const [day, setDay] = useState<DayPayload | null>(null);
  const [noActive, setNoActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // Per-side recent activities shown inside the add dialog (server-ranked by ledger recency).
  const [recent, setRecent] = useState<RecentActivity[]>([]);
  // Guards Continue / Back / Close against double-submit while the phase PATCH awaits.
  const [phaseBusy, setPhaseBusy] = useState(false);
  const phaseBusyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [journal, setJournal] = useState("");
  // Which surface the microphone is feeding, or null when idle.
  const [listening, setListening] = useState<SpeechTarget | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [detailLineId, setDetailLineId] = useState<string | null>(null);
  const [detailDifficulty, setDetailDifficulty] = useState<number | null>(null);
  const [detailText, setDetailText] = useState("");
  const [detailError, setDetailError] = useState<string | null>(null);
  // Non-error status for the details dialog, e.g. dictation hit the cap.
  const [detailNotice, setDetailNotice] = useState<string | null>(null);
  const [dismissedGuideIds, setDismissedGuideIds] = useState<Set<string>>(() => new Set());
  // The welcome walkthrough dismisses once, forever, and not once per day.
  const [welcomeDismissed, setWelcomeDismissed] = useState(() => {
    try {
      return localStorage.getItem("eaj-guide-welcome-dismissed") === "1";
    } catch {
      return true;
    }
  });
  // Which column shows on small screens (segmented tab view).
  const [mobileCol, setMobileCol] = useState<"withdrawal" | "deposit">("withdrawal");
  const [justFreed, setJustFreed] = useState<number | undefined>();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dndBusy, setDndBusy] = useState(false);
  // Swallow the click that browsers fire immediately after a drag ends.
  const suppressOpenRef = useRef(false);
  // Explicit edit mode for a closed day opened from history: amendments
  // correct the record without reopening the day's lifecycle.
  const [amending, setAmending] = useState(false);
  const [deletingDay, setDeletingDay] = useState(false);
  const deletingDayRef = useRef(false);
  // In-app confirmation for deleting a previous day (styled like other dialogs).
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Confirm before the irreversible close-day transition from the stepper.
  const [confirmingClose, setConfirmingClose] = useState(false);
  // End-of-day insights modal, populated when the day closes.
  const [closeCelebration, setCloseCelebration] = useState<{
    closingBalance: number;
    insights: Insight[];
    recovery: GuideItem | null;
  } | null>(null);
  // Numeric history, feeding the planning hint and the recovery plan.
  const [statSeries, setStatSeries] = useState<StatPoint[]>([]);
  // Full decrypted history for tipSignals, same corpus as You, not the
  // day-filtered suggestions list used for add-to-day ranking.
  const [intelCatalog, setIntelCatalog] = useState<IntelligenceCatalogItem[]>([]);
  const [intelDays, setIntelDays] = useState<IntelligenceDay[]>([]);
  // The Trends stat card's detail dialog.
  const [trendsOpen, setTrendsOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const speechRef = useRef<SpeechRec | null>(null);
  // Bumps on every stop/start so late Web Speech callbacks cannot touch state.
  const speechGenerationRef = useRef(0);
  // Text committed before/while dictating, per active target; interim results render on top of it.
  const speechBaseRef = useRef("");
  const journalRef = useRef("");
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    journalRef.current = journal;
  }, [journal]);

  useEffect(() => {
    deletingDayRef.current = deletingDay;
  }, [deletingDay]);

  useEffect(() => {
    setJustFreed(undefined);
    setStatSeries([]);
    setDetailLineId(null);
    setAmending(false);
    setWeatherOpen(false);
    if (day?.id) setDismissedGuideIds(loadDismissedGuideIds(day.id));
  }, [day?.id, historyDayId]);

  useEffect(() => {
    return () => {
      stopLiveSpeech();
    };
  }, []);

  // Closing the details dialog (escape, scrim, cancel, save, date change)
  // also releases the microphone.
  useEffect(() => {
    if (!detailLineId && listening === "details") stopLiveSpeech();
  }, [detailLineId, listening]);

  const [draftSide, setDraftSide] = useState<"deposit" | "withdrawal" | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCost, setDraftCost] = useState("20");
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  // Which recent row is mid-add, so a slow request cannot be double-tapped.
  // The ref is the synchronous lock; the state drives the busy rendering.
  const [addingRecentId, setAddingRecentId] = useState<string | null>(null);
  const addingRecentRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
  );

  const load = useCallback(async (forcedDayId?: string, opts?: { soft?: boolean }) => {
    const generation = ++loadGenerationRef.current;
    // Soft loads must not move the viewport when metrics/guide reflow after paint.
    const savedScroll = opts?.soft
      ? { x: window.scrollX, y: window.scrollY }
      : null;
    const restoreScroll = () => {
      if (!savedScroll) return;
      if (window.scrollX !== savedScroll.x || window.scrollY !== savedScroll.y) {
        window.scrollTo(savedScroll.x, savedScroll.y);
      }
    };
    // A soft load refreshes data in place without blanking the page or the
    // error banner, e.g. after a repeat conflict.
    if (!opts?.soft) {
      // Close day-bound overlays before swapping payloads so stale open state
      // cannot briefly render the next day's content.
      setWeatherOpen(false);
      setError(null);
      setLoading(true);
    }
    try {
    const dek = getSessionDek();
    if (!dek) {
      setLoading(false);
      return;
    }
    let d: DayPayload | null;
    if (forcedDayId) {
      d = await api<DayPayload>(`/api/days/${forcedDayId}`);
      if (generation !== loadGenerationRef.current) return;
      setNoActive(false);
    } else if (historyDayId) {
      d = await api<DayPayload>(`/api/days/${historyDayId}`);
      if (generation !== loadGenerationRef.current) return;
      // History deep-links open read-only (with an explicit edit toggle);
      // a still-open day belongs on the active view instead.
      if (d && d.phase !== "closed") {
        setSearchParams({}, { replace: true });
        setLoading(false);
        return;
      }
      setNoActive(false);
    } else {
      const active = await api<{ day: DayPayload | null }>(`/api/days/active`);
      if (generation !== loadGenerationRef.current) return;
      d = active.day;
      setNoActive(d === null);
    }
    if (!d) {
      setDay(null);
      setSuggestions([]);
      setRecent([]);
      setLoading(false);
      return;
    }
    const lines: Line[] = [];
    for (const l of d.lines) {
      try {
        const label = await decryptText(dek, l.labelCiphertext, l.labelIv, "eaj-label");
        let details = "";
        if (l.detailsCiphertext && l.detailsIv) {
          try {
            details = await decryptText(
              dek,
              l.detailsCiphertext,
              l.detailsIv,
              "eaj-task-details",
            );
          } catch {
            details = "";
          }
        }
        lines.push({ ...l, completed: !!l.completed, label, details });
      } catch {
        lines.push({ ...l, completed: !!l.completed, label: "(unable to decrypt)", details: "" });
      }
    }
    if (generation !== loadGenerationRef.current) return;
    setDay({ ...d, lines });
    setDismissedGuideIds(loadDismissedGuideIds(d.id));
    let decryptedJournal = "";
    if (d.journalCiphertext && d.journalIv) {
      try {
        decryptedJournal = await decryptText(
          dek,
          d.journalCiphertext,
          d.journalIv,
          "eaj-journal",
        );
      } catch {
        decryptedJournal = "";
      }
    }
    if (generation !== loadGenerationRef.current) return;
    setJournal(decryptedJournal);

    const sug = await api<{ suggestions: Suggestion[]; recent?: RecentActivity[] }>(
      `/api/suggestions/${d.id}`,
    );
    const decryptAll = async <T extends { labelCiphertext: string; labelIv: string; label?: string }>(
      items: T[],
    ) => {
      const out: T[] = [];
      for (const s of items) {
        try {
          const label = await decryptText(dek, s.labelCiphertext, s.labelIv, "eaj-label");
          out.push({ ...s, label });
        } catch {
          /* skip */
        }
      }
      return out;
    };
    const decrypted = await decryptAll(sug.suggestions);
    const decryptedRecent = await decryptAll(sug.recent ?? []);
    if (generation !== loadGenerationRef.current) return;
    setSuggestions(decrypted);
    setRecent(decryptedRecent);
    setLoading(false);
    } finally {
      if (savedScroll) {
        restoreScroll();
        requestAnimationFrame(() => {
          restoreScroll();
          requestAnimationFrame(restoreScroll);
        });
      }
    }
  }, [historyDayId, setSearchParams]);

  useEffect(() => {
    void load().catch((e) => {
      setError(e instanceof Error ? e.message : "Could not load your day.");
      setLoading(false);
    });
  }, [load]);

  const dayPhase = day?.phase;
  // Numeric history feeds the planning hint during plan and the Trends card
  // in every phase, so it loads once per day view.
  useEffect(() => {
    if (!day?.id) return;
    let cancelled = false;
    void fetchRecentStats()
      .then((series) => {
        if (!cancelled) setStatSeries(series);
      })
      .catch(() => {
        if (!cancelled) setStatSeries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [day?.id]);

  // Tip personalization needs the full catalog and closed-day feel history,
  // which the suggestions endpoint deliberately truncates and weekday-filters.
  useEffect(() => {
    if (!getSessionDek()) return;
    let cancelled = false;
    void loadPersonalData()
      .then((data) => {
        if (cancelled) return;
        setIntelCatalog(
          data.catalog.map((item) => ({
            side: item.side,
            label: item.label,
            useCount: item.useCount,
            typicalDifficulty: item.typicalDifficulty,
            difficultyCount: item.difficultyCount,
          })),
        );
        setIntelDays(
          data.days.map((d) => ({
            date: d.date,
            phase: d.phase,
            closingBalance: d.closingBalance,
            attwoodNet: d.attwoodNet,
            depositTotal: d.depositTotal,
            withdrawalTotal: d.withdrawalTotal,
            feelRating: d.feelRating,
          })),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setIntelCatalog([]);
        setIntelDays([]);
      });
    return () => {
      cancelled = true;
    };
  }, [day?.id]);

  // Keep keyboard focus inside the destructive confirmation.
  useEffect(() => {
    if (!confirmingDelete) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.getElementById("delete-day-modal");
    const focusables = () =>
      modal
        ? Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => !element.hasAttribute("disabled"))
        : [];
    const focusId = window.requestAnimationFrame(() => focusables()[0]?.focus({ preventScroll: true }));
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deletingDayRef.current) {
        setConfirmingDelete(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [confirmingDelete]);

  // Keep keyboard focus inside the close-day confirmation.
  useEffect(() => {
    if (!confirmingClose) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.getElementById("close-day-modal");
    const focusables = () =>
      modal
        ? Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => !element.hasAttribute("disabled"))
        : [];
    const focusId = window.requestAnimationFrame(() => focusables()[0]?.focus({ preventScroll: true }));
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !phaseBusyRef.current) {
        setConfirmingClose(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [confirmingClose]);

  // Escape closes the celebration modal; Tab stays inside it.
  useEffect(() => {
    if (!closeCelebration) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.getElementById("insight-modal");
    const focusables = () =>
      modal
        ? Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute("disabled"))
        : [];

    // Move focus in after paint so the dialog node exists.
    const focusId = window.requestAnimationFrame(() => {
      const first = focusables()[0];
      first?.focus({ preventScroll: true });
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCloseCelebration(null);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      window.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [closeCelebration]);

  // Escape closes the add-item sheet; Tab stays inside (same contract as the
  // other dialogs). Initial focus lands on the first useful control: the
  // first addable Recent row when one exists, otherwise the label field.
  useEffect(() => {
    if (!draftSide) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.getElementById("add-item-modal");
    const focusables = () =>
      modal
        ? Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute("disabled"))
        : [];

    const focusId = window.requestAnimationFrame(() => {
      const list = focusables();
      const firstUseful = list.find((el) => el.getAttribute("aria-disabled") !== "true");
      (firstUseful ?? list[0])?.focus({ preventScroll: true });
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDraftSide(null);
        setDraftLabel("");
        setDraftCost("20");
        setSuggestNote(null);
        setAddingRecentId(null);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      window.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [draftSide]);

  // Escape closes task details; Tab stays inside the dialog (same contract as close celebration).
  useEffect(() => {
    if (!detailLineId) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.getElementById("task-detail-modal");
    const focusables = () =>
      modal
        ? Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute("disabled"))
        : [];

    const focusId = window.requestAnimationFrame(() => {
      const first = focusables()[0];
      first?.focus({ preventScroll: true });
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        stopLiveSpeech();
        setDetailLineId(null);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      window.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [detailLineId, listening]);

  // Escape closes the guide sheet; Tab stays inside (same contract as the
  // other dialogs on this page).
  useEffect(() => {
    if (!guideOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.getElementById("guide-sheet");
    const focusables = () =>
      modal
        ? Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute("disabled"))
        : [];

    const focusId = window.requestAnimationFrame(() => {
      focusables()[0]?.focus({ preventScroll: true });
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setGuideOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      window.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [guideOpen]);

  useEffect(() => {
    if (!draftLabel.trim() || !day) return;
    const catalog = [
      ...day.lines
        .filter((l) => l.label)
        .map((l) => ({ label: l.label!, typicalCost: l.plannedCost, useCount: 1 })),
      ...suggestions
        .filter((s) => s.label)
        .map((s) => ({ label: s.label!, typicalCost: s.typicalCost, useCount: s.useCount })),
    ];
    const t = window.setTimeout(() => {
      void suggestCost(draftLabel, catalog).then((r) => {
        setDraftCost(String(r.cost));
        setSuggestNote(
          r.source === "default"
            ? null
            : `Suggested ${r.cost} from your history (${r.source}).`,
        );
      });
    }, 400);
    return () => window.clearTimeout(t);
  }, [draftLabel, day, suggestions]);

  const deposits = useMemo(
    () => (day?.lines.filter((l) => l.side === "deposit") ?? []).sort((a, b) => a.sort - b.sort),
    [day],
  );
  const withdrawals = useMemo(
    () =>
      (day?.lines.filter((l) => l.side === "withdrawal") ?? []).sort((a, b) => a.sort - b.sort),
    [day],
  );

  const parsedWeather = useMemo(() => parseDayWeather(day?.weather ?? null), [day?.weather]);
  const weatherKind = weatherKindFromCode(parsedWeather?.weathercode);
  const uvMax = parsedWeather?.uvMax ?? null;
  const tempUnit = user.temperatureUnit ?? defaultTemperatureUnit(user.country);

  // Let the global sky scene react to today's conditions.
  useEffect(() => {
    document.documentElement.dataset.weather = weatherKind;
    return () => {
      delete document.documentElement.dataset.weather;
    };
  }, [weatherKind]);

  const playHeavy = day ? isWithdrawalHeavy(day.attwood) : false;
  const currentSkyPeriod = skyPeriod(user.lat, user.lon, liveTimezone(user.timezone));

  // Trend hint while planning; recovery only at close (never during audit,
  // so tomorrow's day row is not created before today locks).
  const dayDate = day?.date ?? isoDate();
  const spansMidnight = !!day && !isHistoryView && day.date < isoDate() && day.phase !== "closed";
  const weatherQuipLine = useMemo(
    () =>
      parsedWeather
        ? weatherQuip({
            kind: weatherKind,
            uvMax,
            tempMax: parsedWeather.tempMax,
            date: dayDate,
          })
        : "Set a location to unlock today's weather commentary.",
    [parsedWeather, weatherKind, uvMax, dayDate],
  );

  const hint = useMemo(
    () => (dayPhase === "plan" && day ? planningHint(statSeries, day.date) : null),
    [dayPhase, statSeries, day],
  );

  const personalIntel = useMemo(
    () =>
      buildPersonalIntelligence({
        catalog: intelCatalog,
        days: intelDays,
        forDate: dayDate,
      }),
    [intelCatalog, intelDays, dayDate],
  );

  // Closed days in date order power the Trends card and its detail dialog.
  const closedStats = useMemo(
    () =>
      statSeries
        .filter((p) => p.phase === "closed")
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    [statSeries],
  );
  const closingTrend = useMemo(
    () => trendWindow(closedStats.map((p) => p.closingBalance)),
    [closedStats],
  );
  const trendMetrics = useMemo(() => {
    if (closedStats.length < 2) return [];
    const defs: { label: string; values: number[]; tone: "signed" | "neutral" }[] = [
      { label: "Energy at close", values: closedStats.map((p) => p.closingBalance), tone: "signed" },
      { label: "Attwood net", values: closedStats.map((p) => p.attwoodNet), tone: "signed" },
      { label: "Energy added / day", values: closedStats.map((p) => p.depositTotal), tone: "neutral" },
      { label: "Energy used / day", values: closedStats.map((p) => p.withdrawalTotal), tone: "neutral" },
    ];
    return defs.flatMap((d) => {
      const w = trendWindow(d.values);
      return w ? [{ label: d.label, tone: d.tone, ...w }] : [];
    });
  }, [closedStats]);

  // Escape closes the trends dialog, matching the other lightweight modals.
  useEffect(() => {
    if (!trendsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTrendsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trendsOpen]);

  const guide = useMemo(() => {
    if (!day) return { primary: null, items: [] as GuideItem[] };
    const extra: GuideItem[] = [];
    // First contact: teach the loop where it happens instead of in slides.
    if (!welcomeDismissed && day.lines.length === 0 && day.phase === "plan") {
      extra.push({
        id: "welcome",
        kind: "event",
        title: "Start with one honest line",
        body: "Add something that will use energy today, and something that will add energy back. Completing a task frees its reserved points back into Available.",
        because: ["This day is empty, and you haven't dismissed this walkthrough."],
        provenance: "Getting started",
        personalized: false,
        score: 70,
      });
    }
    return buildGuide(
      {
        date: day.date,
        available: day.availableCapacity,
        depositTotal: day.attwood.depositTotal,
        withdrawalTotal: day.attwood.withdrawalTotal,
        incompleteWithdrawals: withdrawals.filter((w) => !w.completed).length,
        weatherKind,
        uvMax,
        isDaylight: isDaylightPeriod(currentSkyPeriod),
        withdrawalHeavy: playHeavy,
        existingLabels: day.lines.map((line) => line.label ?? ""),
        candidates: suggestions,
        movement: personalIntel.tipSignals.movement,
        includePhysicalActivities: user.includePhysicalActivities !== false,
        firstName: user.displayName?.trim().split(/\s+/)[0],
        recentLowFeel: personalIntel.tipSignals.recentLowFeel,
        recentRatedSample: personalIntel.tipSignals.recentRatedSample,
        timeOfDay:
          new Date().getHours() < 12
            ? "morning"
            : new Date().getHours() < 17
              ? "afternoon"
              : "evening",
        familiarRestorer: personalIntel.tipSignals.familiarRestorer,
        heavyWeekday: personalIntel.tipSignals.heavyWeekday,
        justFreed,
        planningHint: hint,
        dismissedIds: dismissedGuideIds,
      },
      extra,
    );
  }, [
    day,
    withdrawals,
    weatherKind,
    uvMax,
    currentSkyPeriod,
    playHeavy,
    suggestions,
    user.displayName,
    user.includePhysicalActivities,
    personalIntel,
    justFreed,
    hint,
    dismissedGuideIds,
    welcomeDismissed,
  ]);

  const detailLine = day?.lines.find((line) => line.id === detailLineId) ?? null;

  function openTaskDetails(line: Line) {
    if (dndBusy || activeDragId || suppressOpenRef.current) return;
    stopLiveSpeech();
    setDetailLineId(line.id);
    setDetailDifficulty(line.difficulty);
    setDetailText(line.details ?? "");
    setDetailError(null);
    setDetailNotice(null);
    setGuideOpen(false);
  }

  function dismissGuideItem(id: string) {
    // The freed-capacity item reflects a transient event; dismissing clears
    // the event instead of muting future completions for the whole day.
    if (id === "event:freed") {
      setJustFreed(undefined);
      return;
    }
    if (id === "welcome") {
      setWelcomeDismissed(true);
      try {
        localStorage.setItem("eaj-guide-welcome-dismissed", "1");
      } catch {
        // Storage unavailable; state alone hides it for this session.
      }
      return;
    }
    if (!day) return;
    setDismissedGuideIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(guideDismissKey(day.id), JSON.stringify([...next]));
      } catch {
        // Storage unavailable; the item can reappear after reload.
      }
      return next;
    });
  }

  async function addLine(
    side: "deposit" | "withdrawal",
    label: string,
    cost: number,
    hash?: string,
    dayId?: string,
  ): Promise<boolean> {
    const dek = getSessionDek();
    const targetDayId = dayId ?? day?.id;
    if (!dek || !targetDayId) return false;
    // Closed-day amendments record what happened; capacity only limits live
    // withdrawal planning. Deposits restore energy and stay plannable.
    if (
      !dayId &&
      day &&
      day.phase !== "closed" &&
      side === "withdrawal" &&
      cost > day.availableCapacity
    ) {
      setError(
        `That uses ${cost} points, and only ${day.availableCapacity} remain available to allocate.`,
      );
      return false;
    }
    const { ciphertext, iv } = await encryptText(dek, label.trim(), "eaj-label");
    const lh = hash ?? (await labelHash(label));
    try {
      await api(`/api/days/${targetDayId}/lines`, {
        method: "POST",
        body: JSON.stringify({
          side,
          labelCiphertext: ciphertext,
          labelIv: iv,
          labelHash: lh,
          plannedCost: cost,
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the item.");
      return false;
    }
    await withPreservedScroll(() => load(undefined, { soft: true }));
    return true;
  }

  async function startNewDay(): Promise<string | null> {
    setStarting(true);
    setError(null);
    try {
      setSearchParams({}, { replace: true });
      const created = await api<DayPayload>("/api/days/start", {
        method: "POST",
        body: JSON.stringify({ date: isoDate() }),
      });
      setNoActive(false);
      setCloseCelebration(null);
      await load(created.id);
      return created.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start a new day.");
      return null;
    } finally {
      setStarting(false);
    }
  }

  async function deletePreviousDay() {
    if (!day || day.phase !== "closed") return;
    setDeletingDay(true);
    setError(null);
    try {
      await api(`/api/days/${day.id}`, { method: "DELETE" });
      navigate("/dashboard", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete this previous day.");
      setConfirmingDelete(false);
      setDeletingDay(false);
    }
  }

  /** Apply a guide action (primary or lower-impact alternative); returns whether the line was added. */
  async function applyGuideAction(item: GuideItem, useAlt = false): Promise<boolean> {
    const action = useAlt ? item.altAction : item.action;
    if (!action) return false;
    let targetDayId = day?.id;
    if (action.requiresStart) {
      if (day && day.phase !== "closed") {
        setError("Close your active day before starting a new one.");
        return false;
      }
      targetDayId = (await startNewDay()) ?? undefined;
      if (!targetDayId) return false;
    }
    const ok = await addLine(action.side, action.label, action.cost, undefined, targetDayId);
    if (ok) dismissGuideItem(item.id);
    return ok;
  }

  function closeDraft() {
    setDraftSide(null);
    setDraftLabel("");
    setDraftCost("20");
    setSuggestNote(null);
    setAddingRecentId(null);
  }

  async function submitDraft() {
    if (!draftSide || !draftLabel.trim()) return;
    const cost = Math.max(0, Math.min(100, Number(draftCost) || 20));
    await addLine(draftSide, draftLabel, cost);
    closeDraft();
  }

  /** One-tap add from a Recent row (column or add sheet). Closes the sheet
   * only when it was open and the add succeeds. */
  async function addRecent(s: RecentActivity) {
    if (!s.label || addingRecentRef.current) return;
    addingRecentRef.current = true;
    setAddingRecentId(s.id);
    try {
      const ok = await addLine(s.side, s.label, s.typicalCost, s.labelHash);
      if (ok && draftSide) closeDraft();
    } finally {
      addingRecentRef.current = false;
      setAddingRecentId(null);
    }
  }

  async function updateActual(line: Line, actual: number | null) {
    if (!day) return;
    await api(`/api/days/${day.id}/lines/${line.id}`, {
      method: "PATCH",
      body: JSON.stringify({ actualCost: actual }),
    });
    await withPreservedScroll(() => load(undefined, { soft: true }));
  }

  async function toggleComplete(line: Line) {
    if (!day) return;
    const next = !line.completed;
    await withPreservedScroll(async () => {
      if (next) setJustFreed(line.plannedCost);
      await api(`/api/days/${day.id}/lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: next }),
      });
      await load(undefined, { soft: true });
    });
  }

  async function saveTaskDetails() {
    if (!detailLine || !day || (day.phase === "closed" && !amending)) return;
    const dek = getSessionDek();
    if (!dek) return;
    // Release the mic first so nothing lands in the field after we snapshot it.
    if (listening === "details") stopLiveSpeech();
    setDetailError(null);
    try {
      const text = detailText.trim();
      const encrypted = text
        ? await encryptText(dek, text, "eaj-task-details")
        : { ciphertext: null, iv: null };
      await api(`/api/days/${day.id}/lines/${detailLine.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          difficulty: detailDifficulty,
          detailsCiphertext: encrypted.ciphertext,
          detailsIv: encrypted.iv,
        }),
      });
      setDetailLineId(null);
      await withPreservedScroll(() => load(undefined, { soft: true }));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Could not save task details.");
    }
  }

  async function removeLine(id: string) {
    await api(`/api/days/${day!.id}/lines/${id}`, { method: "DELETE" });
    await withPreservedScroll(() => load(undefined, { soft: true }));
  }

  async function setPhase(phase: "plan" | "audit" | "closed") {
    if (!day || phaseBusyRef.current) return;
    phaseBusyRef.current = true;
    setPhaseBusy(true);
    setError(null);
    const leavingAudit = day.phase === "audit" && phase !== "audit";
    try {
      // Leaving audit unmounts the journal; stop dictation and persist first.
      if (leavingAudit) stopLiveSpeech();
      if (leavingAudit || phase === "closed") await saveJournal();

      if (phase === "closed") {
        const res = await api<{ closingBalance: number }>(`/api/days/${day.id}/close`, {
          method: "POST",
        });
        const recoveryId = `recovery:${day.id}`;
        const closedRecovery =
          !dismissedGuideIds.has(recoveryId)
            ? recoveryPlan({
                dayId: day.id,
                date: day.date,
                nextStartDate: isoDate(),
                feelRating: day.feelRating,
                openingBalance: day.openingBalance,
                closingBalance: res.closingBalance,
                plannedTotal: day.lines.reduce((sum, l) => sum + l.plannedCost, 0),
                actualTotal: day.lines.reduce(
                  (sum, l) => sum + (l.actualCost ?? l.plannedCost),
                  0,
                ),
                incompleteWithdrawals: day.lines.filter(
                  (l) => l.side === "withdrawal" && !l.completed,
                ).length,
                series: statSeries,
                candidates: suggestions,
                includePhysicalActivities: user.includePhysicalActivities !== false,
              })
            : null;
        try {
          const series = await fetchRecentStats();
          setDay((prev) =>
            prev
              ? {
                  ...prev,
                  phase: "closed",
                  closingBalance: res.closingBalance,
                  projectedClosing: res.closingBalance,
                }
              : prev,
          );
          setNoActive(true);
          setCloseCelebration({
            closingBalance: res.closingBalance,
            insights: closeDayInsights(series, day.id),
            recovery: closedRecovery,
          });
        } catch {
          setDay((prev) =>
            prev
              ? {
                  ...prev,
                  phase: "closed",
                  closingBalance: res.closingBalance,
                  projectedClosing: res.closingBalance,
                }
              : prev,
          );
          setNoActive(true);
          setCloseCelebration({
            closingBalance: res.closingBalance,
            insights: [],
            recovery: closedRecovery,
          });
        }
        return;
      }
      await api(`/api/days/${day.id}`, {
        method: "PATCH",
        body: JSON.stringify({ phase }),
      });
      // Soft refresh keeps the page mounted so scroll position and the
      // stepper stay put while the new phase paints with its transition.
      setDay((prev) => (prev ? { ...prev, phase } : prev));
      await withPreservedScroll(() => load(undefined, { soft: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the day phase.");
    } finally {
      phaseBusyRef.current = false;
      setPhaseBusy(false);
    }
  }

  async function saveJournal() {
    const dek = getSessionDek();
    if (!dek || !day) return;
    const j = await encryptText(dek, journalRef.current, "eaj-journal");
    await api(`/api/days/${day.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        journalCiphertext: j.ciphertext,
        journalIv: j.iv,
        feelRating: day?.feelRating ?? null,
      }),
    });
  }

  async function setFeel(n: number) {
    if (!day) return;
    await api(`/api/days/${day.id}`, {
      method: "PATCH",
      body: JSON.stringify({ feelRating: n }),
    });
    await withPreservedScroll(() => load(undefined, { soft: true }));
  }

  function stopLiveSpeech() {
    const rec = speechRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.stop();
      speechRef.current = null;
    }
    speechGenerationRef.current += 1;
    setListening(null);
  }

  function startLiveSpeech(target: SpeechTarget) {
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec })
        .webkitSpeechRecognition;
    if (!SR) {
      const msg =
        "Dictation is not available in this browser. The keyboard still believes in you.";
      if (target === "details") setDetailError(msg);
      else setError(msg);
      return;
    }
    stopLiveSpeech();
    speechGenerationRef.current += 1;
    const generation = speechGenerationRef.current;
    speechBaseRef.current = target === "journal" ? journal : detailText;
    if (target === "details") {
      setDetailNotice(null);
      setDetailError(null);
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (ev) => {
      if (generation !== speechGenerationRef.current || speechRef.current !== rec) return;
      let interim = "";
      let finals = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        if (r.isFinal) finals += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finals) {
        speechBaseRef.current = (speechBaseRef.current + " " + finals).trim();
      }
      const next = (speechBaseRef.current + (interim ? " " + interim : "")).trim();
      if (target === "journal") {
        setJournal(next);
        return;
      }
      if (next.length >= DETAILS_MAX) {
        const capped = next.slice(0, DETAILS_MAX);
        speechBaseRef.current = capped;
        setDetailText(capped);
        setDetailNotice("Character limit reached, dictation stopped.");
        speechGenerationRef.current += 1;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
        if (speechRef.current === rec) speechRef.current = null;
        setListening(null);
        return;
      }
      setDetailText(next);
    };
    rec.onerror = () => {
      if (generation !== speechGenerationRef.current) return;
      setListening(null);
    };
    rec.onend = () => {
      if (generation !== speechGenerationRef.current) return;
      setListening(null);
    };
    speechRef.current = rec;
    rec.start();
    setListening(target);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveDragId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveDragId(null);
    // The browser often synthesizes a click after pointer-up from a drag.
    suppressOpenRef.current = true;
    window.setTimeout(() => {
      suppressOpenRef.current = false;
    }, 200);
    if (!day || (day.phase === "closed" && !amending) || dndBusy) return;
    setDndBusy(true);
    try {
      const activeId = String(e.active.id);
      const overId = e.over ? String(e.over.id) : null;
      if (!overId) return;

      const line = day.lines.find((l) => l.id === activeId);
      if (!line) return;

      let targetSide: "deposit" | "withdrawal" = line.side;
      if (overId === "col-deposit") targetSide = "deposit";
      else if (overId === "col-withdrawal") targetSide = "withdrawal";
      else {
        const overLine = day.lines.find((l) => l.id === overId);
        if (overLine) targetSide = overLine.side;
      }

      const sourceList = (
        targetSide === line.side
          ? day.lines.filter((l) => l.side === line.side)
          : day.lines.filter((l) => l.side === targetSide)
      ).sort((a, b) => a.sort - b.sort);

      let newIndex = sourceList.findIndex((l) => l.id === overId);
      if (overId === "col-deposit" || overId === "col-withdrawal") {
        newIndex = sourceList.length;
      }
      if (newIndex < 0) newIndex = sourceList.length;

      if (targetSide === line.side) {
        const oldIndex = sourceList.findIndex((l) => l.id === activeId);
        if (oldIndex < 0) return;
        const reordered = arrayMove(
          sourceList,
          oldIndex,
          Math.min(newIndex, sourceList.length - 1),
        );
        await Promise.all(
          reordered.map((l, i) =>
            api(`/api/days/${day.id}/lines/${l.id}`, {
              method: "PATCH",
              body: JSON.stringify({ sort: i, side: l.side }),
            }),
          ),
        );
      } else {
        const without = sourceList.filter((l) => l.id !== activeId);
        const insertAt = Math.min(newIndex, without.length);
        const next = [
          ...without.slice(0, insertAt),
          { ...line, side: targetSide },
          ...without.slice(insertAt),
        ];
        await api(`/api/days/${day.id}/lines/${activeId}`, {
          method: "PATCH",
          body: JSON.stringify({ side: targetSide, sort: insertAt }),
        });
        await Promise.all(
          next.map((l, i) =>
            api(`/api/days/${day.id}/lines/${l.id}`, {
              method: "PATCH",
              body: JSON.stringify({ sort: i, side: targetSide }),
            }),
          ),
        );
      }
      await withPreservedScroll(() => load(undefined, { soft: true }));
    } finally {
      setDndBusy(false);
    }
  }

  const closeCelebrationModal =
    closeCelebration && (
      <div
        className="insight-scrim"
        onClick={(e) => {
          if (e.target === e.currentTarget) setCloseCelebration(null);
        }}
      >
        <div
          id="insight-modal"
          className="panel insight-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="insight-title"
        >
          <ModalCloseButton label="Close day closed dialog" onClick={() => setCloseCelebration(null)} />
          <h2 id="insight-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
            Day closed
          </h2>
          <p className="muted">
            Ended with {closeCelebration.closingBalance} energy remaining. Your next day starts
            fresh at 100 when you start it.
          </p>
          {closeCelebration.insights.map((i) => (
            <div key={i.id} className={`tip-card insight-${i.tone}`}>
              <p style={{ margin: 0 }}>{i.text}</p>
            </div>
          ))}
          {closeCelebration.insights.length === 0 && (
            <p className="muted">The day is closed. Rest is also productive.</p>
          )}
          {closeCelebration.recovery && (
            <GuideCard
              item={closeCelebration.recovery}
              closed={false}
              actionLabel="Start new day · Add energy"
              onAction={(item) => {
                void applyGuideAction(item).then((ok) => {
                  if (ok) {
                    setCloseCelebration((c) => (c ? { ...c, recovery: null } : c));
                  }
                });
              }}
              onDismiss={(id) => {
                dismissGuideItem(id);
                setCloseCelebration((c) => (c ? { ...c, recovery: null } : c));
              }}
              dismissLabel="Not now"
            />
          )}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn accent"
              disabled={starting}
              onClick={() => {
                setCloseCelebration(null);
                void startNewDay();
              }}
            >
              {starting ? "Starting…" : "Start new day"}
            </button>
          </div>
        </div>
      </div>
    );

  if (loading && !closeCelebration) {
    return <p className="muted">Loading your day…</p>;
  }

  if (noActive && !isHistoryView && !closeCelebration) {
    return (
      <div className="panel today-start">
        <p className="ob-eyebrow">Your day, your boundary</p>
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Start when you&apos;re ready</h2>
        <p className="muted">
          Your energy day follows you, not the clock. Irregular sleep, long focus stretches, shift
          work, and time blindness are all normal here, and there is no missed-day penalty. Start a
          day when you want to plan; it stays open until you close it, even across midnight.
        </p>
        {error && <p className="error">{error}</p>}
        <button
          type="button"
          className="btn accent"
          disabled={starting}
          onClick={() => void startNewDay()}
        >
          {starting ? "Starting…" : "Start new day"}
        </button>
      </div>
    );
  }

  if (!day && closeCelebration) {
    return <div className="today-root">{closeCelebrationModal}</div>;
  }

  if (!day) {
    return (
      <div className="panel">
        <p className="muted">
          {isHistoryView ? "That day could not be found." : "Nothing to show yet."}
        </p>
        {isHistoryView && (
          <button
            type="button"
            className="btn secondary"
            style={{ marginTop: "1rem" }}
            onClick={() => setSearchParams({}, { replace: true })}
          >
            Back to active day
          </button>
        )}
      </div>
    );
  }

  const closed = day?.phase === "closed";
  const readOnly = !!day && day.phase === "closed" && !amending;
  const activeLine = activeDragId ? day.lines.find((l) => l.id === activeDragId) : null;

  return (
    <div className="today-root">
      <div
        aria-hidden={
          closeCelebration ||
          confirmingDelete ||
          confirmingClose ||
          detailLineId ||
          guideOpen ||
          (draftSide && !readOnly)
            ? true
            : undefined
        }
      >
      <div className="panel">
        <p className="ob-eyebrow">Energy day · started {dayDate}</p>
        {spansMidnight && (
          <p className="muted day-span-note">
            This is still your active energy day; close it when your day is actually done.
          </p>
        )}
        {isHistoryView && closed && (
          <div style={{ marginBottom: "0.75rem" }}>
            <p className="muted">
              {amending
                ? "Editing a closed day. Changes update its recorded energy remaining."
                : "Viewing a closed day from Previous days in read-only mode."}
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setSearchParams({}, { replace: true })}
              >
                Back to active day
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setAmending((v) => !v)}
              >
                {amending ? "Done editing" : "Edit this day"}
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={deletingDay}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete this day
              </button>
              <HelpTip label="deleting a previous day">
                Deleting removes this closed day and all of its entries from Previous days and
                Dashboard trends. Your active day is never affected. This cannot be undone.
              </HelpTip>
            </div>
          </div>
        )}
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Signed in as {user.email}
          {day.isHoliday ? " · Holiday" : ""}
        </p>
        <div className="weather-row">
          <p className="weather-quip">{weatherQuipLine}</p>
          <button
            type="button"
            className="weather-chip"
            data-kind={weatherKind}
            aria-haspopup={parsedWeather ? "dialog" : undefined}
            disabled={!parsedWeather}
            onClick={() => setWeatherOpen(true)}
          >
            <WeatherGlyph kind={weatherKind} isNight={!isDaylightPeriod(currentSkyPeriod)} />
            <div>
              <strong>{weatherLabel(weatherKind)}</strong>
              {parsedWeather ? (
                <span>
                  {" "}
                  {parsedWeather.tempMin != null && parsedWeather.tempMax != null
                    ? formatTempRange(parsedWeather.tempMin, parsedWeather.tempMax, tempUnit)
                    : parsedWeather.tempMax != null
                      ? formatTemp(parsedWeather.tempMax, tempUnit)
                      : parsedWeather.tempMin != null
                        ? formatTemp(parsedWeather.tempMin, tempUnit)
                        : "Details available"}
                  {parsedWeather.precip != null ? ` · ${parsedWeather.precip} mm` : ""}
                </span>
              ) : (
                <span> Set location in settings.</span>
              )}
              {uvMax != null && <span>{` · UV ${Math.round(uvMax)}`}</span>}
            </div>
          </button>
        </div>
        <div className="stats" style={{ marginTop: "1rem" }}>
          <div className="stat">
            <div className="label">
              Daily energy
              <HelpTip label="daily energy">
                Your full daily charge: 100 points, fresh for each day you start. Energy does not
                carry between days.
              </HelpTip>
            </div>
            <div className="value">{day.openingBalance}</div>
          </div>
          <div className="stat">
            <div className="label">
              Available
              <HelpTip label="available capacity">
                Points not yet reserved by pending tasks. Completing a task frees its reservation
                back into this number.
              </HelpTip>
            </div>
            <div className="value">{day.availableCapacity}</div>
          </div>
          <div className="stat">
            <div className="label">
              {closed ? "Energy remaining" : "Projected remaining"}
              <HelpTip label={closed ? "energy remaining" : "projected remaining"}>
                {closed
                  ? "The recorded energy remaining when this day closed, including any later amendments."
                  : "Energy left at close if every planned line costs what you estimated. Closing the day records the real number."}
              </HelpTip>
            </div>
            <div className="value">
              {closed ? day.closingBalance ?? day.projectedClosing : day.projectedClosing}
            </div>
          </div>
          <div className="stat">
            <div className="label">
              Attwood net
              <HelpTip label="Attwood net">
                Energy added minus energy used, the core Energy Accounting measure from Maja Toudal
                and Dr. Tony Attwood. Positive means today gave more than it took.
              </HelpTip>
            </div>
            <div className="value">{day.attwood.attwoodNet}</div>
          </div>
          <div className="stat">
            <div className="label">
              Add energy / use energy
              <HelpTip label="energy added and used">
                The first number is energy added today. The second is energy used.
              </HelpTip>
            </div>
            <div className="value" style={{ fontSize: "1.2rem" }}>
              {day.attwood.depositTotal} / {day.attwood.withdrawalTotal}
            </div>
          </div>
          <button
            type="button"
            className="stat stat-trends"
            aria-haspopup="dialog"
            onClick={() => setTrendsOpen(true)}
          >
            <div className="label">Trends</div>
            {closingTrend ? (
              <div className="trend-body">
                <div className="value trend-value">
                  {closingTrend.delta != null && <TrendArrow delta={closingTrend.delta} />}
                  {Math.round(closingTrend.recent)}
                </div>
                <div className="trend-side">
                  <TrendSpark
                    values={closedStats.slice(-14).map((p) => p.closingBalance)}
                    className="trend-spark"
                  />
                  <span className="muted trend-caption">Energy at close · 7-day avg</span>
                </div>
              </div>
            ) : (
              <span className="muted trend-caption trend-caption-empty">
                Your history will grow here
              </span>
            )}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className={`day-flow${guide.primary && !closed ? " has-guide" : ""}`}>
        <div className="day-flow-rhythm">
          <div className="panel day-rhythm-panel">
            <HelpTip label="the daily rhythm">
              Your day moves through three phases: planning, auditing real costs and how it felt,
              then closing. Previous days open read-only on the Dashboard; choose Edit
              this day to amend one, or confirm before deleting it. Your next day starts fresh at 100
              when you choose to start it.
            </HelpTip>
            <div className="day-rhythm-copy">
              <div className="day-rhythm-status">
                <span className="day-rhythm-label">
                  {closed
                    ? "Day closed"
                    : day.phase === "audit"
                      ? "Evening audit"
                      : "Morning plan"}
                </span>
              </div>
              {!closed && (
                <p className="phase-step-hint muted" key={day.phase}>
                  {day.phase === "plan"
                    ? "When you’re ready, tap Audit to record how things actually felt."
                    : "When you’re ready, tap Close to finish the day and lock in today’s energy."}
                </p>
              )}
            </div>
            <ol className="phase-stepper" aria-label="Day phases">
              {(
                [
                  { id: "plan" as const, label: "Plan" },
                  { id: "audit" as const, label: "Audit" },
                  { id: "closed" as const, label: "Close" },
                ]
              ).map((step, index, steps) => {
                const currentIndex = closed ? 2 : day.phase === "audit" ? 1 : 0;
                const state =
                  index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
                const clickable = !closed && !phaseBusy && state !== "current";
                return (
                  <li
                    key={step.id}
                    className={`phase-step phase-step-${state}${clickable ? " phase-step-clickable" : ""}`}
                    aria-current={state === "current" ? "step" : undefined}
                  >
                    <button
                      type="button"
                      className="phase-step-btn"
                      disabled={!clickable}
                      aria-label={
                        step.id === "plan"
                          ? "Morning plan"
                          : step.id === "audit"
                            ? "Evening audit"
                            : "Close day"
                      }
                      onClick={() => {
                        if (step.id === "closed") {
                          setConfirmingClose(true);
                          return;
                        }
                        void setPhase(step.id);
                      }}
                    >
                      <span className="phase-step-dot" aria-hidden="true">
                        {state === "done" ? "✓" : index + 1}
                      </span>
                      <span className="phase-step-name">{step.label}</span>
                    </button>
                    {index < steps.length - 1 && (
                      <span className="phase-step-rail" aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
        {guide.primary && !closed && (
          <div className="panel day-flow-guide">
            <GuideCard
              item={guide.primary}
              closed={readOnly}
              onAction={(item, useAlt) => void applyGuideAction(item, useAlt)}
              onDismiss={dismissGuideItem}
            />
          </div>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={(e) => void onDragEnd(e)}
      >
        <div className="col-tabs" role="group" aria-label="Choose day column">
          <button
            type="button"
            className={`col-tab${mobileCol === "withdrawal" ? " active" : ""}`}
            aria-pressed={mobileCol === "withdrawal"}
            onClick={() => setMobileCol("withdrawal")}
          >
            Use energy
          </button>
          <button
            type="button"
            className={`col-tab${mobileCol === "deposit" ? " active" : ""}`}
            aria-pressed={mobileCol === "deposit"}
            onClick={() => setMobileCol("deposit")}
          >
            Add energy
          </button>
        </div>
        <div className="day-board">
          <Column
            title="Use energy"
            side="withdrawal"
            droppableId="col-withdrawal"
            className={`withdraw-col${mobileCol !== "withdrawal" ? " mobile-hidden" : ""}`}
            lines={withdrawals}
            closed={readOnly}
            audit={day.phase === "audit" || (closed && amending)}
            recent={recent.filter((s) => s.side === "withdrawal" && s.label)}
            phase={day.phase}
            availableCapacity={day.availableCapacity}
            addingRecentId={addingRecentId}
            onAdd={() => setDraftSide("withdrawal")}
            onAddRecent={(s) => void addRecent(s)}
            onActual={updateActual}
            onComplete={(l) => void toggleComplete(l)}
            onRemove={(id) => void removeLine(id)}
            onOpen={openTaskDetails}
          />
          <Column
            title="Add energy"
            side="deposit"
            droppableId="col-deposit"
            className={`deposit-col${mobileCol !== "deposit" ? " mobile-hidden" : ""}`}
            lines={deposits}
            closed={readOnly}
            audit={day.phase === "audit" || (closed && amending)}
            recent={recent.filter((s) => s.side === "deposit" && s.label)}
            phase={day.phase}
            availableCapacity={day.availableCapacity}
            addingRecentId={addingRecentId}
            onAdd={() => setDraftSide("deposit")}
            onAddRecent={(s) => void addRecent(s)}
            onActual={updateActual}
            onComplete={(l) => void toggleComplete(l)}
            onRemove={(id) => void removeLine(id)}
            onOpen={openTaskDetails}
          />
        </div>
        <SiteFooter />
        <DragOverlay>
          {activeLine ? (
            <div className="task-row drag-overlay">
              <div>{activeLine.label}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {(day.phase === "audit" || closed) && (
        <div className="panel" style={{ marginTop: "1rem" }}>
          <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Evening audit</h2>
          <p className="muted">How do you feel, on a scale from 1 to 10?</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "1rem" }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className={`btn ${day.feelRating === n ? "accent" : "secondary"}`}
                disabled={readOnly}
                onClick={() => void setFeel(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="journal">Journal</label>
            <textarea
              id="journal"
              value={journal}
              disabled={readOnly}
              onChange={(e) => setJournal(e.target.value)}
              placeholder="What shaped your energy today?"
            />
            {listening === "journal" && (
              <p className="listening-pill">Listening · your words appear as you talk</p>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {listening !== "journal" ? (
              <button
                type="button"
                className="btn secondary mic-btn"
                disabled={readOnly}
                title="Typing is hard sometimes. Talk instead."
                aria-label="Dictate journal"
                onClick={() => startLiveSpeech("journal")}
              >
                <MicIcon /> Dictate
              </button>
            ) : (
              <button
                type="button"
                className="btn danger mic-btn"
                aria-label="Stop dictating journal"
                onClick={stopLiveSpeech}
              >
                <span className="rec-dot" aria-hidden="true" /> Stop dictating
              </button>
            )}
            <button
              type="button"
              className="btn secondary"
              disabled={readOnly}
              onClick={() => void saveJournal()}
            >
              Save journal
            </button>
          </div>
        </div>
      )}

      </div>

      {/* No suggestions, no lightbulb: the FAB earns its place or leaves.
          Stays while the sheet is open so dismissing the last item doesn't
          yank the control out from underneath. */}
      {(guide.items.length > 0 || guideOpen) && (
        <button
          type="button"
          className={`tips-fab${guideOpen ? " open" : ""}`}
          aria-label={
            guideOpen
              ? "Close energy guide"
              : `Open energy guide (${guide.items.length} suggestions)`
          }
          aria-expanded={guideOpen}
          title="Energy guide"
          onClick={() => {
            prefetchSuggestModel();
            setGuideOpen((o) => !o);
          }}
        >
          <LightbulbIcon />
          {guide.items.length > 0 && !guideOpen && (
            <span className="tips-badge" aria-hidden="true">
              {guide.items.length}
            </span>
          )}
        </button>
      )}

      {guideOpen && (
        <div
          className="guide-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setGuideOpen(false);
          }}
        >
          <div
            id="guide-sheet"
            className="tips-sheet panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
            aria-describedby="guide-privacy"
          >
            <ModalCloseButton label="Close energy guide" onClick={() => setGuideOpen(false)} />
            <div className="col-head">
              <h2 id="guide-title">Energy guide</h2>
            </div>
            {guide.items.length === 0 && (
              <p className="muted">
                Nothing to suggest right now. Keep planning your day and completing what you can,
                and the guide will speak up when it has something concrete.
              </p>
            )}
            {guide.items.map((item) => (
              <GuideCard
                key={item.id}
                item={item}
                closed={readOnly}
                inSheet
                onAction={(entry, useAlt) => {
                  void applyGuideAction(entry, useAlt).then((ok) => {
                    if (ok) setGuideOpen(false);
                  });
                }}
                onDismiss={dismissGuideItem}
              />
            ))}
            <p id="guide-privacy" className="muted guide-privacy">
              Suggestions are ranked on this device from your history, capacity, and today’s
              conditions. Numeric totals power trends; labels stay encrypted and never leave the
              browser.
            </p>
          </div>
        </div>
      )}

      {draftSide && !readOnly && (
        <div
          className="insight-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDraft();
          }}
        >
          <form
            id="add-item-modal"
            className="panel insight-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-title"
            onSubmit={(e) => {
              e.preventDefault();
              void submitDraft();
            }}
          >
            <ModalCloseButton label="Cancel adding energy item" onClick={closeDraft} />
            <h2 id="draft-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              {draftSide === "deposit" ? "Add energy" : "Use energy"}
            </h2>
            <p className="muted">Available to allocate · {day.availableCapacity}</p>
            {(() => {
              const recentForSide = recent.filter((s) => s.side === draftSide && s.label);
              if (recentForSide.length === 0) return null;
              return (
                <div className="recent-block">
                  <h3 className="recent-heading" id="recent-heading">
                    Recent
                  </h3>
                  <ul className="recent-list" aria-labelledby="recent-heading">
                    {recentForSide.map((s) => {
                      const reason = recentDisabledReason(
                        s.typicalCost,
                        day.availableCapacity,
                        day.phase,
                        draftSide,
                      );
                      const busy = addingRecentId === s.id;
                      const reasonId = reason ? `recent-reason-${s.id}` : undefined;
                      // Over-capacity rows use aria-disabled instead of
                      // disabled so they stay reachable and the visible
                      // reason is announced via aria-describedby.
                      return (
                        <li key={s.id}>
                          <button
                            type="button"
                            className="recent-row"
                            disabled={!reason && !!addingRecentId}
                            aria-disabled={reason ? true : undefined}
                            aria-describedby={reasonId}
                            aria-label={
                              reason
                                ? `${s.label}, ${s.typicalCost} points`
                                : `Add ${s.label}, ${s.typicalCost} points`
                            }
                            onClick={() => {
                              if (reason) return;
                              void addRecent(s);
                            }}
                          >
                            <span className="recent-label">{s.label}</span>
                            <span className="recent-points">{s.typicalCost}</span>
                            <span className="recent-add" aria-hidden="true">
                              {busy ? "…" : "+"}
                            </span>
                          </button>
                          {reason && (
                            <p id={reasonId} className="recent-reason">
                              {reason}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}
            <div className="field">
              <label htmlFor="draft-label">Activity / experience</label>
              <input
                id="draft-label"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="draft-cost">Energy value (0 to 100)</label>
              <input
                id="draft-cost"
                type="number"
                min={0}
                max={100}
                value={draftCost}
                onChange={(e) => setDraftCost(e.target.value)}
              />
              {suggestNote && <p className="muted">{suggestNote}</p>}
            </div>
            {/* Failures keep the sheet open, so the message must show here. */}
            {error && <p className="error">{error}</p>}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="submit" className="btn accent">
                Save to day
              </button>
            </div>
          </form>
        </div>
      )}

      {detailLine && (
        <div
          className="insight-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              stopLiveSpeech();
              setDetailLineId(null);
            }
          }}
        >
          <form
            id="task-detail-modal"
            className="panel insight-modal task-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-detail-title"
            onSubmit={(e) => {
              e.preventDefault();
              void saveTaskDetails();
            }}
          >
            <ModalCloseButton
              label="Close task details"
              onClick={() => {
                stopLiveSpeech();
                setDetailLineId(null);
              }}
            />
            <p className="ob-eyebrow">
              {detailLine.side === "deposit" ? "Add energy" : "Use energy"}
            </p>
            <h2 id="task-detail-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              {detailLine.label}
            </h2>
            <p className="muted">
              Planned {detailLine.plannedCost}
              {day.phase !== "plan"
                ? ` · Actual ${detailLine.actualCost ?? detailLine.plannedCost}`
                : ""}
              {detailLine.completed ? " · Done" : " · Pending"}
            </p>
            <fieldset className="difficulty-field" disabled={readOnly}>
              <legend>How hard was this for you? Optional</legend>
              <div className="difficulty-scale" aria-label="Difficulty from 1 easy to 10 hard">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`btn ${detailDifficulty === n ? "accent" : "secondary"}`}
                    aria-pressed={detailDifficulty === n}
                    onClick={() => setDetailDifficulty(detailDifficulty === n ? null : n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="difficulty-anchors muted">
                <span>1 Easy</span>
                <span>10 Hard</span>
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="task-details">
                Details{" "}
                <HelpTip label="task details">
                  Details are capped at {DETAILS_MAX.toLocaleString()} characters. A counter
                  appears as you approach the limit, and dictation stops automatically when
                  it is reached.
                </HelpTip>
              </label>
              <textarea
                id="task-details"
                value={detailText}
                disabled={readOnly}
                maxLength={DETAILS_MAX}
                placeholder="What made this easier or harder? Add any context worth remembering."
                onChange={(e) => {
                  setDetailText(e.target.value);
                  if (e.target.value.length < DETAILS_MAX) setDetailNotice(null);
                }}
              />
              {listening === "details" && (
                <p className="listening-pill">Listening · your words appear as you talk</p>
              )}
              {detailText.length >= DETAILS_WARN_AT && (
                <p
                  className={`char-counter${detailText.length >= DETAILS_MAX ? " at-limit" : ""}`}
                >
                  {detailText.length.toLocaleString()} / {DETAILS_MAX.toLocaleString()} characters
                </p>
              )}
              {detailNotice && (
                <p className="dictation-notice" role="status">
                  {detailNotice}
                </p>
              )}
              {!readOnly && (
                <div className="detail-dictate-row">
                  {listening !== "details" ? (
                    <button
                      type="button"
                      className="btn secondary mic-btn"
                      disabled={detailText.length >= DETAILS_MAX}
                      title="Typing is hard sometimes. Talk instead."
                      aria-label="Dictate task details"
                      onClick={() => startLiveSpeech("details")}
                    >
                      <MicIcon /> Dictate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn danger mic-btn"
                      aria-label="Stop dictating task details"
                      onClick={stopLiveSpeech}
                    >
                      <span className="rec-dot" aria-hidden="true" /> Stop dictating
                    </button>
                  )}
                </div>
              )}
              <p className="muted">
                This text is encrypted before it leaves your browser.
              </p>
            </div>
            {detailError && <p className="error">{detailError}</p>}
            <div className="modal-actions">
              {!readOnly && (
                <button type="submit" className="btn accent">
                  Save task details
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {confirmingDelete && day && (
        <div
          className="insight-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deletingDay) setConfirmingDelete(false);
          }}
        >
          <div
            id="delete-day-modal"
            className="panel insight-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-day-title"
            aria-describedby="delete-day-body"
          >
            <ModalCloseButton
              label="Keep this day"
              onClick={() => setConfirmingDelete(false)}
              disabled={deletingDay}
            />
            <h2 id="delete-day-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              Delete this day?
            </h2>
            <p id="delete-day-body" className="muted">
              The day from {day.date} and all of its entries will be removed from Previous days
              and Dashboard trends. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn danger"
                disabled={deletingDay}
                onClick={() => void deletePreviousDay()}
              >
                {deletingDay ? "Deleting…" : "Delete this day"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingClose && day && !closed && (
        <div
          className="insight-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget && !phaseBusy) setConfirmingClose(false);
          }}
        >
          <div
            id="close-day-modal"
            className="panel insight-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="close-day-title"
            aria-describedby="close-day-body"
          >
            <ModalCloseButton
              label="Keep working on this day"
              disabled={phaseBusy}
              onClick={() => setConfirmingClose(false)}
            />
            <h2 id="close-day-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              Close this day?
            </h2>
            <p id="close-day-body" className="muted">
              Closing records today’s energy remaining and moves the day to Previous days. You can
              still amend it later from the Dashboard, but the day will not reopen.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn accent"
                disabled={phaseBusy}
                aria-busy={phaseBusy || undefined}
                onClick={() => {
                  setConfirmingClose(false);
                  void setPhase("closed");
                }}
              >
                {phaseBusy ? "Closing…" : "Close day"}
              </button>
            </div>
          </div>
        </div>
      )}

      {weatherOpen && parsedWeather && (
        <WeatherDetailModal
          weather={parsedWeather}
          tempUnit={tempUnit}
          favorites={intelCatalog}
          isDaylight={isHistoryView || isDaylightPeriod(currentSkyPeriod)}
          isHistorical={isHistoryView}
          onClose={() => setWeatherOpen(false)}
        />
      )}

      {trendsOpen && (
        <div
          className="insight-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setTrendsOpen(false);
          }}
        >
          <div
            id="trends-modal"
            className="panel insight-modal trends-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trends-title"
          >
            <ModalCloseButton label="Close trends" onClick={() => setTrendsOpen(false)} />
            <h2 id="trends-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              Your trends
            </h2>
            {closedStats.length >= 2 ? (
              <>
                <TrendSpark
                  values={closedStats.slice(-30).map((p) => p.closingBalance)}
                  className="trend-spark trend-spark-large"
                />
                <p className="muted trend-spark-caption">
                  Energy remaining at close, last {Math.min(30, closedStats.length)} closed days.
                </p>
                <div className="trend-rows">
                  {trendMetrics.map((m) => (
                    <div key={m.label} className="trend-row">
                      <span className="trend-row-label">{m.label}</span>
                      <span className="trend-row-value">
                        {Math.round(m.recent)}
                        {m.delta != null && (
                          <>
                            <TrendArrow delta={m.delta} tone={m.tone} />
                            <span className="muted trend-row-delta">
                              {m.delta >= 0 ? "+" : ""}
                              {Math.round(m.delta)}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="muted">
                  Averages cover your last 7 closed days; arrows compare them with the days
                  before. Direction is information, not a grade.
                </p>
              </>
            ) : (
              <p className="muted">
                These trends will populate slowly but surely 🙂
                <br />
                Close a few more days and your patterns will start to appear here.
              </p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn accent"
                onClick={() => {
                  setTrendsOpen(false);
                  navigate("/dashboard");
                }}
              >
                Open dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {closeCelebrationModal}
    </div>
  );
}

/**
 * One guide recommendation: action-first summary with a "Why this?"
 * tip that separates personal signals from research grounding.
 */
function GuideCard(props: {
  item: GuideItem;
  closed: boolean;
  inSheet?: boolean;
  actionLabel?: string;
  dismissLabel?: string;
  onAction: (item: GuideItem, useAlt?: boolean) => void;
  onDismiss: (id: string) => void;
}) {
  const { item } = props;
  const dismissAria = props.dismissLabel ?? "Dismiss";

  const sourceLink =
    item.sourceUrl != null && item.sourceUrl.length > 0 ? (
      <a
        className="greeting-source guide-card-source"
        href={item.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        Source: {guideSourceLabel(item.sourceUrl)}
        <span aria-hidden="true"> ↗</span>
      </a>
    ) : null;

  return (
    <article className={`guide-card${props.inSheet ? " in-sheet" : ""}`} data-kind={item.kind}>
      <div className="guide-card-head">
        <strong>{item.title}</strong>
      </div>
      <p className="guide-card-body">{item.body}</p>
      {(item.action || item.altAction) && (
        <div className="guide-card-actions">
          {item.action && (
            <button
              type="button"
              className="guide-suggest-btn"
              disabled={props.closed}
              aria-label={
                props.actionLabel
                  ? `${props.actionLabel}: ${item.action.label}, ${item.action.cost} points`
                  : item.action.requiresStart
                    ? `Start new day and add energy: ${item.action.label}, ${item.action.cost} points`
                    : item.action.side === "withdrawal"
                      ? `Use energy: ${item.action.label}, ${item.action.cost} points`
                      : `Add energy: ${item.action.label}, ${item.action.cost} points`
              }
              onClick={() => props.onAction(item)}
            >
              <span className="guide-suggest-sparkle" aria-hidden="true">
                ✦
              </span>
              <span className="guide-suggest-label">
                {props.actionLabel ??
                  (item.action.requiresStart
                    ? `Start day · ${item.action.label}`
                    : item.action.label)}
              </span>
              <span
                className={`guide-suggest-cost guide-suggest-cost-${item.action.side}`}
                aria-hidden="true"
              >
                {item.action.side === "deposit" ? `+${item.action.cost}` : `−${item.action.cost}`}
              </span>
            </button>
          )}
          {item.altAction && (
            /* Same styling as the primary action: the lower-impact dose is an
               equal choice, not a fallback. */
            <button
              type="button"
              className="guide-suggest-btn"
              disabled={props.closed}
              aria-label={
                item.altAction.side === "withdrawal"
                  ? `Use energy: ${item.altAction.label}, ${item.altAction.cost} points`
                  : `Add energy: ${item.altAction.label}, ${item.altAction.cost} points`
              }
              onClick={() => props.onAction(item, true)}
            >
              <span className="guide-suggest-sparkle" aria-hidden="true">
                ✦
              </span>
              <span className="guide-suggest-label">{item.altAction.label}</span>
              <span
                className={`guide-suggest-cost guide-suggest-cost-${item.altAction.side}`}
                aria-hidden="true"
              >
                {item.altAction.side === "deposit"
                  ? `+${item.altAction.cost}`
                  : `−${item.altAction.cost}`}
              </span>
            </button>
          )}
        </div>
      )}
      <div className="guide-card-meta">
        <HelpTip
          label="this suggestion"
          buttonContent="Why this?"
          buttonClassName="linkish guide-why-btn"
        >
          <div className="guide-why">
            <ul>
              {item.because.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {item.research && (
              <p className="guide-research">Research basis: {item.research}</p>
            )}
          </div>
        </HelpTip>
        {sourceLink}
      </div>
      {/* Visually top-right; last in DOM so title/body get first focus/read order. */}
      <button
        type="button"
        className="guide-card-close"
        aria-label={dismissAria}
        onClick={() => props.onDismiss(item.id)}
      >
        <span aria-hidden="true">×</span>
      </button>
    </article>
  );
}

/** Short label for Source: … links, mirrors greeting fact sources. */
function guideSourceLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const known: Record<string, string> = {
      "who.int": "WHO",
      "doi.org": "DOI",
      "energyaccounting.com": "Energy Accounting",
      "nifplay.org": "NIFPlay",
      "cdc.gov": "CDC",
      "frontiersin.org": "Frontiers",
      "plos.org": "PLOS",
      "nih.gov": "NIH",
    };
    for (const [domain, label] of Object.entries(known)) {
      if (host === domain || host.endsWith(`.${domain}`)) return label;
    }
    return host;
  } catch {
    return "link";
  }
}

function Column(props: {
  title: string;
  side: "deposit" | "withdrawal";
  droppableId: string;
  className: string;
  lines: Line[];
  closed: boolean;
  audit: boolean;
  recent: RecentActivity[];
  phase: string;
  availableCapacity: number;
  addingRecentId: string | null;
  onAdd: () => void;
  onAddRecent: (s: RecentActivity) => void;
  onActual: (line: Line, actual: number | null) => Promise<void>;
  onComplete: (line: Line) => void;
  onRemove: (id: string) => void;
  onOpen: (line: Line) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.droppableId });
  // Empty columns surface prior-ledger picks so the day can fill without a
  // separate "repeat plan" control.
  const showRecent = !props.lines.length && !props.closed && props.recent.length > 0;
  return (
    <div
      ref={setNodeRef}
      className={`panel column-panel ${props.className}${isOver ? " drop-over" : ""}`}
    >
      <div className="col-head">
        <h2>{props.title}</h2>
        <button
          type="button"
          className="btn plus"
          disabled={props.closed}
          aria-label={
            props.side === "deposit"
              ? "Add energy"
              : "Use energy"
          }
          onClick={props.onAdd}
        >
          +
        </button>
      </div>
      <SortableContext items={props.lines.map((l) => l.id)} strategy={verticalListSortingStrategy}>
        {props.lines.map((l) => (
          <SortableTask
            key={l.id}
            line={l}
            closed={props.closed}
            audit={props.audit}
            onActual={props.onActual}
            onComplete={props.onComplete}
            onRemove={props.onRemove}
            onOpen={props.onOpen}
          />
        ))}
      </SortableContext>
      {showRecent ? (
        <div className="column-recent">
          <h3 className="recent-heading column-recent-heading" id={`${props.droppableId}-recent`}>
            <span className="column-recent-sparkle" aria-hidden="true">
              ✦
            </span>
            Suggested from past days
          </h3>
          <ul className="recent-list" aria-labelledby={`${props.droppableId}-recent`}>
            {props.recent.map((s) => {
              const reason = recentDisabledReason(
                s.typicalCost,
                props.availableCapacity,
                props.phase,
                props.side,
              );
              const reasonId = reason ? `${props.droppableId}-reason-${s.id}` : undefined;
              const busy = props.addingRecentId === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="recent-row"
                    disabled={!reason && !!props.addingRecentId}
                    aria-disabled={reason ? true : undefined}
                    aria-describedby={reasonId}
                    aria-label={
                      reason
                        ? `${s.label}, ${s.typicalCost} points`
                        : props.side === "deposit"
                          ? `Add energy: ${s.label}, ${s.typicalCost} points`
                          : `Use energy: ${s.label}, ${s.typicalCost} points`
                    }
                    onClick={() => {
                      if (reason) return;
                      props.onAddRecent(s);
                    }}
                  >
                    <span className="recent-label">{s.label}</span>
                    <span
                      className={`recent-points guide-suggest-cost-${props.side}`}
                      aria-hidden="true"
                    >
                      {props.side === "deposit" ? `+${s.typicalCost}` : `−${s.typicalCost}`}
                    </span>
                    <span className="recent-add" aria-hidden="true">
                      {busy ? "…" : "+"}
                    </span>
                  </button>
                  {reason && (
                    <p id={reasonId} className="recent-reason">
                      {reason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        !props.lines.length && (
          <p className="muted">
            {props.side === "withdrawal"
              ? "Nothing using energy yet. Suspiciously well-rested."
              : "Nothing that adds energy yet. Your battery has questions."}
          </p>
        )
      )}
    </div>
  );
}

function SortableTask(props: {
  line: Line;
  closed: boolean;
  audit: boolean;
  onActual: (line: Line, actual: number | null) => Promise<void>;
  onComplete: (line: Line) => void;
  onRemove: (id: string) => void;
  onOpen: (line: Line) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.line.id,
    disabled: props.closed,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`task-row day-task${props.line.completed ? " completed" : ""}`}
      {...attributes}
      {...listeners}
      // Mouse activation can focus the sortable node; undo any scroll jump.
      onMouseDown={() => {
        const x = window.scrollX;
        const y = window.scrollY;
        requestAnimationFrame(() => {
          if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
        });
      }}
      role="group"
      aria-roledescription="sortable task"
    >
      <button
        type="button"
        className={`task-status${props.line.completed ? " checked" : ""}`}
        aria-label={props.line.completed ? "Mark incomplete" : "Mark complete"}
        aria-pressed={props.line.completed}
        disabled={props.closed}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => props.onComplete(props.line)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" />
          <path d="m6.5 12.5 3.4 3.4 7.6-8" />
        </svg>
      </button>
      <button
        type="button"
        className="task-main task-detail-trigger"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          if (!isDragging) props.onOpen(props.line);
        }}
      >
        <div className={props.line.completed ? "task-done-label" : undefined}>{props.line.label}</div>
        <div className="task-meta">
          Planned {props.line.plannedCost}
          {props.audit || props.closed
            ? ` · Actual ${props.line.actualCost ?? props.line.plannedCost}`
            : ""}
          {props.line.completed ? " · Done" : ""}
        </div>
      </button>
      {!props.closed && (
        <div className="task-actions" onPointerDown={(e) => e.stopPropagation()}>
          {props.audit && (
            <input
              type="number"
              className="task-actual-input"
              min={0}
              max={100}
              aria-label="Actual energy cost"
              key={`${props.line.id}-${props.line.actualCost ?? "p"}`}
              defaultValue={props.line.actualCost ?? props.line.plannedCost}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const v = Number(e.target.value);
                void props.onActual(props.line, Number.isFinite(v) ? v : null);
              }}
            />
          )}
          <button
            type="button"
            className="task-remove"
            aria-label="Remove"
            onClick={() => props.onRemove(props.line.id)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
