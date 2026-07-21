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
import { useSearchParams } from "react-router-dom";
import type { UserProfile } from "../App";
import { HelpTip } from "../components/HelpTip";
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
import { prefetchSuggestModel, suggestCost } from "../lib/suggest";
import {
  defaultTemperatureUnit,
  formatTemp,
  formatTempRange,
  isDaylightPeriod,
  skyPeriod,
  weatherKindFromCode,
  weatherLabel,
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

type DayPayload = {
  id: string;
  date: string;
  openingBalance: number;
  closingBalance: number | null;
  projectedClosing: number;
  availableCapacity: number;
  phase: string;
  feelRating: number | null;
  journalCiphertext: string | null;
  journalIv: string | null;
  audioPath: string | null;
  compensateNoteCiphertext: string | null;
  compensateNoteIv: string | null;
  weather: Record<string, unknown> | null;
  isHoliday: boolean;
  attwood: { depositTotal: number; withdrawalTotal: number; attwoodNet: number };
  lines: Line[];
};

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

async function fetchRecentStats(date: string): Promise<StatPoint[]> {
  const from = new Date(date + "T12:00:00Z");
  from.setUTCDate(from.getUTCDate() - 60);
  const fromIso = from.toISOString().slice(0, 10);
  const res = await api<{ series: StatPoint[] }>(`/api/stats?from=${fromIso}&to=${date}`);
  return res.series;
}

function guideDismissKey(date: string): string {
  return `eaj-guide-dismissed:${date}`;
}

function loadDismissedGuideIds(date: string): Set<string> {
  try {
    const raw = localStorage.getItem(guideDismissKey(date));
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
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2Zm-2 18a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-1h-4v1Z"
      />
    </svg>
  );
}

export function TodayPage({ user }: { user: UserProfile }) {
  const [params, setSearchParams] = useSearchParams();
  const dateParam = params.get("date");
  // URL is source of truth so Dashboard deep-links and the Today nav stay aligned.
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : isoDate();
  function setDate(next: string) {
    if (next === isoDate()) setSearchParams({}, { replace: true });
    else setSearchParams({ date: next }, { replace: true });
  }
  const [day, setDay] = useState<DayPayload | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [journal, setJournal] = useState("");
  const [listening, setListening] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [detailLineId, setDetailLineId] = useState<string | null>(null);
  const [detailDifficulty, setDetailDifficulty] = useState<number | null>(null);
  const [detailText, setDetailText] = useState("");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [dismissedGuideIds, setDismissedGuideIds] = useState<Set<string>>(() => new Set());
  // The welcome walkthrough dismisses once, forever — not per day.
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
  // End-of-day insights modal, populated when the day closes.
  const [closeCelebration, setCloseCelebration] = useState<{
    closingBalance: number;
    insights: Insight[];
    recovery: GuideItem | null;
  } | null>(null);
  // Numeric history, feeding the planning hint and the recovery plan.
  const [statSeries, setStatSeries] = useState<StatPoint[]>([]);
  const speechRef = useRef<SpeechRec | null>(null);
  const journalBaseRef = useRef("");
  const journalRef = useRef("");

  useEffect(() => {
    journalRef.current = journal;
  }, [journal]);

  useEffect(() => {
    setJustFreed(undefined);
    setCloseCelebration(null);
    setStatSeries([]);
    setDetailLineId(null);
    setDismissedGuideIds(loadDismissedGuideIds(date));
  }, [date]);

  useEffect(() => {
    return () => {
      speechRef.current?.stop();
      speechRef.current = null;
    };
  }, []);

  const [draftSide, setDraftSide] = useState<"deposit" | "withdrawal" | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCost, setDraftCost] = useState("20");
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    setError(null);
    const dek = getSessionDek();
    if (!dek) return;
    const d = await api<DayPayload>(`/api/days/${date}`);
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
    setDay({ ...d, lines });
    if (d.journalCiphertext && d.journalIv) {
      try {
        setJournal(await decryptText(dek, d.journalCiphertext, d.journalIv, "eaj-journal"));
      } catch {
        setJournal("");
      }
    } else setJournal("");

    const sug = await api<{ suggestions: Suggestion[] }>(`/api/suggestions/${date}`);
    const decrypted: Suggestion[] = [];
    for (const s of sug.suggestions) {
      try {
        const label = await decryptText(dek, s.labelCiphertext, s.labelIv, "eaj-label");
        decrypted.push({ ...s, label });
      } catch {
        /* skip */
      }
    }
    setSuggestions(decrypted);
  }, [date]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Load failed"));
  }, [load]);

  // Numeric history feeds the planning hint during plan.
  const dayPhase = day?.phase;
  useEffect(() => {
    if (dayPhase !== "plan" && dayPhase !== "audit") return;
    let cancelled = false;
    void fetchRecentStats(date)
      .then((series) => {
        if (!cancelled) setStatSeries(series);
      })
      .catch(() => {
        if (!cancelled) setStatSeries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dayPhase, date]);

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
      first?.focus();
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
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [closeCelebration]);

  // Escape closes the add-item modal.
  useEffect(() => {
    if (!draftSide) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDraftSide(null);
        setDraftLabel("");
        setDraftCost("20");
        setSuggestNote(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      first?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
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
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [detailLineId]);

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
      focusables()[0]?.focus();
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
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
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

  const weatherKind = weatherKindFromCode(day?.weather?.weathercode);
  const uvMax = typeof day?.weather?.uvMax === "number" ? day.weather.uvMax : null;
  const tempUnit = user.temperatureUnit ?? defaultTemperatureUnit(user.country);

  // Let the global sky scene react to today's conditions.
  useEffect(() => {
    document.documentElement.dataset.weather = weatherKind;
    return () => {
      delete document.documentElement.dataset.weather;
    };
  }, [weatherKind]);

  const playHeavy = day ? isWithdrawalHeavy(day.attwood) : false;
  const currentSkyPeriod = skyPeriod(
    user.lat,
    user.lon,
    user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  // Trend hint while planning; recovery only at close (never during audit,
  // so tomorrow's day row is not created before today locks).
  const hint = useMemo(
    () => (dayPhase === "plan" ? planningHint(statSeries, date) : null),
    [dayPhase, statSeries, date],
  );

  const guide = useMemo(() => {
    if (!day) return { primary: null, items: [] as GuideItem[] };
    const extra: GuideItem[] = [];
    // First contact: teach the loop where it happens instead of in slides.
    if (!welcomeDismissed && day.lines.length === 0 && day.phase === "plan") {
      extra.push({
        id: "welcome",
        kind: "event",
        title: "Start with one honest line",
        body: "Add a withdrawal for something today will ask of you, and a deposit for something that refills you. Completing a task frees its reserved points back into Available.",
        because: ["This day's ledger is empty, and you haven't dismissed this walkthrough."],
        provenance: "Getting started",
        personalized: false,
        score: 70,
      });
    }
    return buildGuide(
      {
        date,
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
        justFreed,
        planningHint: hint,
        dismissedIds: dismissedGuideIds,
      },
      extra,
    );
  }, [
    day,
    date,
    withdrawals,
    weatherKind,
    uvMax,
    currentSkyPeriod,
    playHeavy,
    suggestions,
    justFreed,
    hint,
    dismissedGuideIds,
    welcomeDismissed,
  ]);

  const detailLine = day?.lines.find((line) => line.id === detailLineId) ?? null;

  function openTaskDetails(line: Line) {
    if (dndBusy || activeDragId || suppressOpenRef.current) return;
    setDetailLineId(line.id);
    setDetailDifficulty(line.difficulty);
    setDetailText(line.details ?? "");
    setDetailError(null);
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
    setDismissedGuideIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(guideDismissKey(date), JSON.stringify([...next]));
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
    targetDate?: string,
  ): Promise<boolean> {
    const dek = getSessionDek();
    if (!dek || !day) return false;
    const crossDay = !!targetDate && targetDate !== date;
    // The server re-checks capacity for any date; this is just a faster error.
    if (!crossDay && cost > day.availableCapacity) {
      setError(
        `That uses ${cost} points, and only ${day.availableCapacity} remain available to allocate.`,
      );
      return false;
    }
    const { ciphertext, iv } = await encryptText(dek, label.trim(), "eaj-label");
    const lh = hash ?? (await labelHash(label));
    try {
      await api(`/api/days/${targetDate ?? date}/lines`, {
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
    if (!crossDay) await load();
    return true;
  }

  /** Apply a guide action; returns whether the line was added. */
  async function applyGuideAction(item: GuideItem): Promise<boolean> {
    if (!item.action) return false;
    const ok = await addLine(
      item.action.side,
      item.action.label,
      item.action.cost,
      undefined,
      item.action.targetDate,
    );
    if (ok) dismissGuideItem(item.id);
    return ok;
  }

  function closeDraft() {
    setDraftSide(null);
    setDraftLabel("");
    setDraftCost("20");
    setSuggestNote(null);
  }

  async function submitDraft() {
    if (!draftSide || !draftLabel.trim()) return;
    const cost = Math.max(0, Math.min(100, Number(draftCost) || 20));
    await addLine(draftSide, draftLabel, cost);
    closeDraft();
  }

  async function updateActual(line: Line, actual: number | null) {
    await api(`/api/days/${date}/lines/${line.id}`, {
      method: "PATCH",
      body: JSON.stringify({ actualCost: actual }),
    });
    await load();
  }

  async function toggleComplete(line: Line) {
    const next = !line.completed;
    if (next) setJustFreed(line.plannedCost);
    await api(`/api/days/${date}/lines/${line.id}`, {
      method: "PATCH",
      body: JSON.stringify({ completed: next }),
    });
    await load();
  }

  async function saveTaskDetails() {
    if (!detailLine || !day || day.phase === "closed") return;
    const dek = getSessionDek();
    if (!dek) return;
    setDetailError(null);
    try {
      const text = detailText.trim();
      const encrypted = text
        ? await encryptText(dek, text, "eaj-task-details")
        : { ciphertext: null, iv: null };
      await api(`/api/days/${date}/lines/${detailLine.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          difficulty: detailDifficulty,
          detailsCiphertext: encrypted.ciphertext,
          detailsIv: encrypted.iv,
        }),
      });
      setDetailLineId(null);
      await load();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Could not save task details.");
    }
  }

  async function removeLine(id: string) {
    await api(`/api/days/${date}/lines/${id}`, { method: "DELETE" });
    await load();
  }

  async function setPhase(phase: "plan" | "audit" | "closed") {
    if (phase === "closed") {
      await saveJournal();
      const res = await api<{ closingBalance: number }>(`/api/days/${date}/close`, {
        method: "POST",
      });
      // Recovery is offered at close with final numbers, so the "plan
      // tomorrow" prompt reflects what actually happened, not projections.
      const recoveryId = `recovery:${date}`;
      const closedRecovery =
        day && !dismissedGuideIds.has(recoveryId)
          ? recoveryPlan({
              date,
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
            })
          : null;
      try {
        const series = await fetchRecentStats(date);
        setCloseCelebration({
          closingBalance: res.closingBalance,
          insights: closeDayInsights(series, date),
          recovery: closedRecovery,
        });
      } catch {
        // The day still closed; skip the celebration if stats are unavailable.
        setCloseCelebration({
          closingBalance: res.closingBalance,
          insights: [],
          recovery: closedRecovery,
        });
      }
    } else {
      await api(`/api/days/${date}`, {
        method: "PATCH",
        body: JSON.stringify({ phase }),
      });
    }
    await load();
  }

  async function saveJournal() {
    const dek = getSessionDek();
    if (!dek) return;
    const j = await encryptText(dek, journalRef.current, "eaj-journal");
    // Compensate fields are omitted on purpose: the server keeps whatever was
    // stored before the manual note was replaced by the recovery plan.
    await api(`/api/days/${date}`, {
      method: "PATCH",
      body: JSON.stringify({
        journalCiphertext: j.ciphertext,
        journalIv: j.iv,
        feelRating: day?.feelRating ?? null,
      }),
    });
  }

  async function setFeel(n: number) {
    await api(`/api/days/${date}`, {
      method: "PATCH",
      body: JSON.stringify({ feelRating: n }),
    });
    await load();
  }

  function startLiveSpeech() {
    const SR =
      (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec })
        .webkitSpeechRecognition;
    if (!SR) {
      setError("Dictation is not available in this browser. The keyboard still believes in you.");
      return;
    }
    journalBaseRef.current = journal;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (ev) => {
      let interim = "";
      let finals = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        if (r.isFinal) finals += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finals) {
        journalBaseRef.current = (journalBaseRef.current + " " + finals).trim();
      }
      setJournal((journalBaseRef.current + (interim ? " " + interim : "")).trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    speechRef.current = rec;
    rec.start();
    setListening(true);
  }

  function stopLiveSpeech() {
    speechRef.current?.stop();
    setListening(false);
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
    if (!day || day.phase === "closed" || dndBusy) return;
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
            api(`/api/days/${date}/lines/${l.id}`, {
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
        await api(`/api/days/${date}/lines/${activeId}`, {
          method: "PATCH",
          body: JSON.stringify({ side: targetSide, sort: insertAt }),
        });
        await Promise.all(
          next.map((l, i) =>
            api(`/api/days/${date}/lines/${l.id}`, {
              method: "PATCH",
              body: JSON.stringify({ sort: i, side: targetSide }),
            }),
          ),
        );
      }
      await load();
    } finally {
      setDndBusy(false);
    }
  }

  if (!day) {
    return <p className="muted">Loading today’s ledger… counting every last point.</p>;
  }

  const closed = day.phase === "closed";
  const activeLine = activeDragId ? day.lines.find((l) => l.id === activeDragId) : null;

  return (
    <div className="today-root">
      <div
        aria-hidden={
          closeCelebration || detailLineId || guideOpen || (draftSide && !closed)
            ? true
            : undefined
        }
      >
      <div className="panel">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="day">Date</label>
          <input
            id="day"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Signed in as {user.email}
          {day.isHoliday ? " · Holiday" : ""}
        </p>
        <div className="weather-chip" data-kind={weatherKind}>
          <span className="weather-glyph" aria-hidden="true" />
          <div>
            <strong>{weatherLabel(weatherKind)}</strong>
            {day.weather && typeof day.weather.tempMax === "number" ? (
              <span>
                {" "}
                {typeof day.weather.tempMin === "number"
                  ? formatTempRange(day.weather.tempMin, day.weather.tempMax, tempUnit)
                  : formatTemp(day.weather.tempMax, tempUnit)}
                {typeof day.weather.precip === "number" ? ` · ${day.weather.precip} mm` : ""}
              </span>
            ) : (
              <span> Set location in settings for live weather.</span>
            )}
            {uvMax != null && <span>{` · UV ${Math.round(uvMax)}`}</span>}
          </div>
        </div>
        <div className="stats" style={{ marginTop: "1rem" }}>
          <div className="stat">
            <div className="label">
              Opening
              <HelpTip label="opening balance">
                Where the battery started today: yesterday’s closing balance, carried forward.
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
              Projected close
              <HelpTip label="projected close">
                Where today lands if every planned line costs what you estimated. Closing the day
                locks the real number in.
              </HelpTip>
            </div>
            <div className="value">{day.projectedClosing}</div>
          </div>
          <div className="stat">
            <div className="label">
              Attwood net
              <HelpTip label="Attwood net">
                Deposits minus withdrawals, the core Energy Accounting measure from Maja Toudal and
                Dr. Tony Attwood. Positive means today gave more than it took.
              </HelpTip>
            </div>
            <div className="value">{day.attwood.attwoodNet}</div>
          </div>
          <div className="stat">
            <div className="label">Deposits / withdrawals</div>
            <div className="value" style={{ fontSize: "1.2rem" }}>
              {day.attwood.depositTotal} / {day.attwood.withdrawalTotal}
            </div>
          </div>
        </div>
        <div className="phase-bar" style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className={`btn secondary${day.phase === "plan" ? " phase-active" : ""}`}
            aria-pressed={day.phase === "plan"}
            disabled={closed}
            onClick={() => void setPhase("plan")}
          >
            Morning plan
          </button>
          <button
            type="button"
            className={`btn secondary${day.phase === "audit" ? " phase-active" : ""}`}
            aria-pressed={day.phase === "audit"}
            disabled={closed}
            onClick={() => void setPhase("audit")}
          >
            Evening audit
          </button>
          <button
            type="button"
            className="btn accent"
            aria-pressed={closed}
            disabled={closed}
            onClick={() => void setPhase("closed")}
          >
            {closed ? "Day closed" : "Close day"}
          </button>
          <HelpTip label="the daily rhythm">
            Plan the day’s deposits and withdrawals in the morning, audit real costs and how it
            felt in the evening, then close to lock the sheet and carry the balance into tomorrow.
          </HelpTip>
        </div>
        {guide.primary && !closed && (
          <GuideCard
            item={guide.primary}
            closed={closed}
            onAction={(item) => void applyGuideAction(item)}
            onDismiss={dismissGuideItem}
          />
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={(e) => void onDragEnd(e)}
      >
        <div className="col-tabs" role="group" aria-label="Choose ledger column">
          <button
            type="button"
            className={`col-tab${mobileCol === "withdrawal" ? " active" : ""}`}
            aria-pressed={mobileCol === "withdrawal"}
            onClick={() => setMobileCol("withdrawal")}
          >
            Withdrawals
          </button>
          <button
            type="button"
            className={`col-tab${mobileCol === "deposit" ? " active" : ""}`}
            aria-pressed={mobileCol === "deposit"}
            onClick={() => setMobileCol("deposit")}
          >
            Deposits
          </button>
        </div>
        <div className="grid-2 equal-cols" style={{ marginTop: "1rem" }}>
          <Column
            title="Withdrawals"
            side="withdrawal"
            droppableId="col-withdrawal"
            className={`withdraw-col${mobileCol !== "withdrawal" ? " mobile-hidden" : ""}`}
            lines={withdrawals}
            suggestions={suggestions.filter((s) => s.side === "withdrawal")}
            closed={closed}
            audit={day.phase === "audit"}
            onAdd={() => setDraftSide("withdrawal")}
            onConfirm={(s) => void addLine(s.side, s.label!, s.typicalCost, s.labelHash)}
            onActual={updateActual}
            onComplete={(l) => void toggleComplete(l)}
            onRemove={(id) => void removeLine(id)}
            onOpen={openTaskDetails}
          />
          <Column
            title="Deposits"
            side="deposit"
            droppableId="col-deposit"
            className={`deposit-col${mobileCol !== "deposit" ? " mobile-hidden" : ""}`}
            lines={deposits}
            suggestions={suggestions.filter((s) => s.side === "deposit")}
            closed={closed}
            audit={day.phase === "audit"}
            onAdd={() => setDraftSide("deposit")}
            onConfirm={(s) => void addLine(s.side, s.label!, s.typicalCost, s.labelHash)}
            onActual={updateActual}
            onComplete={(l) => void toggleComplete(l)}
            onRemove={(id) => void removeLine(id)}
            onOpen={openTaskDetails}
          />
        </div>
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
                disabled={closed}
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
              disabled={closed}
              onChange={(e) => setJournal(e.target.value)}
              placeholder="What shaped your energy today?"
            />
            {listening && <p className="listening-pill">Listening · your words appear as you talk</p>}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {!listening ? (
              <button
                type="button"
                className="btn secondary mic-btn"
                disabled={closed}
                title="Typing is hard sometimes. Talk instead."
                onClick={startLiveSpeech}
              >
                <MicIcon /> Dictate
              </button>
            ) : (
              <button type="button" className="btn danger mic-btn" onClick={stopLiveSpeech}>
                <span className="rec-dot" aria-hidden="true" /> Stop dictating
              </button>
            )}
            <button
              type="button"
              className="btn secondary"
              disabled={closed}
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
            <div className="col-head">
              <h2 id="guide-title">Energy guide</h2>
              <button type="button" className="btn secondary" onClick={() => setGuideOpen(false)}>
                Close
              </button>
            </div>
            {guide.items.length === 0 && (
              <p className="muted">
                Nothing to suggest right now. Plan deposits and withdrawals, complete what you can,
                and the guide will speak up when it has something concrete.
              </p>
            )}
            {guide.items.map((item) => (
              <GuideCard
                key={item.id}
                item={item}
                closed={closed}
                inSheet
                onAction={(entry) => {
                  void applyGuideAction(entry).then((ok) => {
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

      {draftSide && !closed && (
        <div
          className="insight-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDraft();
          }}
        >
          <form
            className="panel insight-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-title"
            onSubmit={(e) => {
              e.preventDefault();
              void submitDraft();
            }}
          >
            <h2 id="draft-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              Add {draftSide === "deposit" ? "deposit" : "withdrawal"}
            </h2>
            <p className="muted">Available to allocate · {day.availableCapacity}</p>
            <div className="field">
              <label htmlFor="draft-label">Activity / experience</label>
              <input
                id="draft-label"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                autoFocus
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
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button type="submit" className="btn accent">
                Add to ledger
              </button>
              <button type="button" className="btn secondary" onClick={closeDraft}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {detailLine && (
        <div
          className="insight-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailLineId(null);
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
            <p className="ob-eyebrow">
              {detailLine.side === "deposit" ? "Deposit" : "Withdrawal"}
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
            <fieldset className="difficulty-field" disabled={closed}>
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
              <label htmlFor="task-details">Details</label>
              <textarea
                id="task-details"
                value={detailText}
                disabled={closed}
                maxLength={5000}
                placeholder="What made this easier or harder? Add any context worth remembering."
                onChange={(e) => setDetailText(e.target.value)}
              />
              <p className="muted">
                This text is encrypted before it leaves your browser.
              </p>
            </div>
            {detailError && <p className="error">{detailError}</p>}
            <div className="modal-actions">
              {!closed && (
                <button type="submit" className="btn accent">
                  Save task details
                </button>
              )}
              <button type="button" className="btn secondary" onClick={() => setDetailLineId(null)}>
                {closed ? "Done" : "Cancel"}
              </button>
            </div>
          </form>
        </div>
      )}

      {closeCelebration && (
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
            <h2 id="insight-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              Day closed
            </h2>
            <p className="muted">
              Closing balance {closeCelebration.closingBalance}, carried into tomorrow.
            </p>
            {closeCelebration.insights.map((i) => (
              <div key={i.id} className={`tip-card insight-${i.tone}`}>
                <p style={{ margin: 0 }}>{i.text}</p>
              </div>
            ))}
            {closeCelebration.insights.length === 0 && (
              <p className="muted">The sheet is locked. Rest is also productive.</p>
            )}
            {closeCelebration.recovery && (
              <GuideCard
                item={closeCelebration.recovery}
                closed={false}
                actionLabel="Plan for tomorrow"
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
            <button
              type="button"
              className="btn accent"
              onClick={() => setCloseCelebration(null)}
            >
              Good night, ledger
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One guide recommendation: action-first summary with a "Why this?"
 * disclosure that separates personal signals from research grounding.
 */
function GuideCard(props: {
  item: GuideItem;
  closed: boolean;
  inSheet?: boolean;
  actionLabel?: string;
  dismissLabel?: string;
  onAction: (item: GuideItem) => void;
  onDismiss: (id: string) => void;
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  const { item } = props;
  const whyId = `guide-why-${item.id.replace(/[^a-z0-9-]/gi, "-")}${props.inSheet ? "-sheet" : ""}`;
  return (
    <article className={`guide-card${props.inSheet ? " in-sheet" : ""}`} data-kind={item.kind}>
      <div className="guide-card-head">
        <strong>{item.title}</strong>
        <span className="guide-provenance">
          {item.provenance ??
            (item.personalized ? "From your history, on this device" : "Research-backed")}
        </span>
      </div>
      <p className="guide-card-body">{item.body}</p>
      <div className="guide-card-actions">
        {item.action && (
          <button
            type="button"
            className="btn accent"
            disabled={props.closed}
            onClick={() => props.onAction(item)}
          >
            {props.actionLabel ??
              `Add ${item.action.label} · ${item.action.cost}${
                item.action.targetDate ? " tomorrow" : ""
              }`}
          </button>
        )}
        <button
          type="button"
          className="linkish"
          aria-expanded={whyOpen}
          aria-controls={whyId}
          onClick={() => setWhyOpen((o) => !o)}
        >
          Why this?
        </button>
        <button
          type="button"
          className="linkish"
          onClick={() => props.onDismiss(item.id)}
        >
          {props.dismissLabel ?? "Dismiss"}
        </button>
      </div>
      {whyOpen && (
        <div id={whyId} className="guide-why">
          <ul>
            {item.because.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {item.research && (
            <p className="guide-research">
              Research basis: {item.research}
              {item.sourceUrl && (
                <>
                  {" "}
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                    Evidence
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function Column(props: {
  title: string;
  side: "deposit" | "withdrawal";
  droppableId: string;
  className: string;
  lines: Line[];
  suggestions: Suggestion[];
  closed: boolean;
  audit: boolean;
  onAdd: () => void;
  onConfirm: (s: Suggestion) => void;
  onActual: (line: Line, actual: number | null) => Promise<void>;
  onComplete: (line: Line) => void;
  onRemove: (id: string) => void;
  onOpen: (line: Line) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.droppableId });
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
          aria-label={`Add ${props.side}`}
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
      {props.suggestions.map((s) => (
        <div key={s.id} className="task-row suggestion">
          <button
            type="button"
            className="btn plus confirm-add"
            disabled={props.closed}
            aria-label="Confirm suggestion"
            onClick={() => props.onConfirm(s)}
          >
            +
          </button>
          <div>
            <div>{s.label}</div>
            <div className="task-meta">
              Suggested {s.typicalCost} · used {s.useCount}×
            </div>
          </div>
        </div>
      ))}
      {!props.lines.length && !props.suggestions.length && (
        <p className="muted">
          {props.side === "withdrawal"
            ? "Nothing draining yet. Suspiciously well-rested."
            : "No deposits yet. Your battery has questions."}
        </p>
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
      className={`task-row ledger-task${props.line.completed ? " completed" : ""}`}
      {...attributes}
      {...listeners}
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
            className="btn secondary"
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
