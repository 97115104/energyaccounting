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
import type { UserProfile } from "../App";
import { api } from "../lib/api";
import {
  decryptText,
  encryptText,
  getSessionDek,
  labelHash,
} from "../lib/crypto";
import { playCategoryTitle, suggestPlayDeposits } from "../lib/playCategories";
import { prefetchSuggestModel, suggestCost } from "../lib/suggest";
import { buildTips } from "../lib/tips";
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
  label?: string;
};

type Suggestion = {
  id: string;
  side: "deposit" | "withdrawal";
  labelCiphertext: string;
  labelIv: string;
  labelHash: string;
  typicalCost: number;
  useCount: number;
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
  const [date, setDate] = useState(isoDate());
  const [day, setDay] = useState<DayPayload | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [journal, setJournal] = useState("");
  const [compensate, setCompensate] = useState("");
  const [listening, setListening] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);
  // Which column shows on small screens (segmented tab view).
  const [mobileCol, setMobileCol] = useState<"withdrawal" | "deposit">("withdrawal");
  const [justFreed, setJustFreed] = useState<number | undefined>();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dndBusy, setDndBusy] = useState(false);
  const speechRef = useRef<SpeechRec | null>(null);
  const journalBaseRef = useRef("");
  const journalRef = useRef("");
  const compensateRef = useRef("");

  useEffect(() => {
    journalRef.current = journal;
  }, [journal]);
  useEffect(() => {
    compensateRef.current = compensate;
  }, [compensate]);

  useEffect(() => {
    setJustFreed(undefined);
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
        lines.push({ ...l, completed: !!l.completed, label });
      } catch {
        lines.push({ ...l, completed: !!l.completed, label: "(unable to decrypt)" });
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
    if (d.compensateNoteCiphertext && d.compensateNoteIv) {
      try {
        setCompensate(
          await decryptText(dek, d.compensateNoteCiphertext, d.compensateNoteIv, "eaj-compensate"),
        );
      } catch {
        setCompensate("");
      }
    } else setCompensate("");

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
  const playSuggestions = useMemo(() => {
    if (!day || !playHeavy) return [];
    return suggestPlayDeposits({
      existingLabels: day.lines.map((l) => l.label ?? ""),
      daySeed: date,
      count: 3,
    });
  }, [day, playHeavy, date]);

  const tips = useMemo(() => {
    if (!day) return [];
    const period = skyPeriod(
      user.lat,
      user.lon,
      user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    return buildTips({
      available: day.availableCapacity,
      depositTotal: day.attwood.depositTotal,
      withdrawalTotal: day.attwood.withdrawalTotal,
      incompleteWithdrawals: withdrawals.filter((w) => !w.completed).length,
      weatherKind,
      uvMax,
      isDaylight: isDaylightPeriod(period),
      justFreed,
    });
  }, [day, withdrawals, weatherKind, uvMax, justFreed, user.lat, user.lon, user.timezone]);

  async function addLine(
    side: "deposit" | "withdrawal",
    label: string,
    cost: number,
    hash?: string,
  ) {
    const dek = getSessionDek();
    if (!dek || !day) return;
    if (cost > day.availableCapacity) {
      setError(
        `That uses ${cost} points, and only ${day.availableCapacity} remain available to allocate.`,
      );
      return;
    }
    const { ciphertext, iv } = await encryptText(dek, label.trim(), "eaj-label");
    const lh = hash ?? (await labelHash(label));
    await api(`/api/days/${date}/lines`, {
      method: "POST",
      body: JSON.stringify({
        side,
        labelCiphertext: ciphertext,
        labelIv: iv,
        labelHash: lh,
        plannedCost: cost,
      }),
    });
    await load();
  }

  async function submitDraft() {
    if (!draftSide || !draftLabel.trim()) return;
    const cost = Math.max(0, Math.min(100, Number(draftCost) || 20));
    await addLine(draftSide, draftLabel, cost);
    setDraftSide(null);
    setDraftLabel("");
    setDraftCost("20");
    setSuggestNote(null);
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

  async function removeLine(id: string) {
    await api(`/api/days/${date}/lines/${id}`, { method: "DELETE" });
    await load();
  }

  async function setPhase(phase: "plan" | "audit" | "closed") {
    if (phase === "closed") {
      await saveJournal();
      await api(`/api/days/${date}/close`, { method: "POST" });
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
    const c = await encryptText(dek, compensateRef.current, "eaj-compensate");
    await api(`/api/days/${date}`, {
      method: "PATCH",
      body: JSON.stringify({
        journalCiphertext: j.ciphertext,
        journalIv: j.iv,
        compensateNoteCiphertext: c.ciphertext,
        compensateNoteIv: c.iv,
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
            <div className="label">Opening</div>
            <div className="value">{day.openingBalance}</div>
          </div>
          <div className="stat">
            <div className="label">Available</div>
            <div className="value">{day.availableCapacity}</div>
          </div>
          <div className="stat">
            <div className="label">Projected close</div>
            <div className="value">{day.projectedClosing}</div>
          </div>
          <div className="stat">
            <div className="label">Attwood net</div>
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
            className="btn secondary"
            disabled={closed}
            onClick={() => void setPhase("plan")}
          >
            Morning plan
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={closed}
            onClick={() => void setPhase("audit")}
          >
            Evening audit
          </button>
          <button
            type="button"
            className="btn accent"
            disabled={closed}
            onClick={() => void setPhase("closed")}
          >
            Close day
          </button>
        </div>
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
          />
          <Column
            title="Deposits"
            side="deposit"
            droppableId="col-deposit"
            className={`deposit-col${mobileCol !== "deposit" ? " mobile-hidden" : ""}`}
            lines={deposits}
            suggestions={suggestions.filter((s) => s.side === "deposit")}
            playSuggestions={playSuggestions}
            closed={closed}
            audit={day.phase === "audit"}
            onAdd={() => setDraftSide("deposit")}
            onConfirm={(s) => void addLine(s.side, s.label!, s.typicalCost, s.labelHash)}
            onPlay={(p) => void addLine("deposit", p.label, p.typicalCost)}
            onActual={updateActual}
            onComplete={(l) => void toggleComplete(l)}
            onRemove={(id) => void removeLine(id)}
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

      {draftSide && !closed && (
        <div className="panel" style={{ marginTop: "1rem" }}>
          <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>
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
            <button type="button" className="btn accent" onClick={() => void submitDraft()}>
              Add to ledger
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setDraftSide(null);
                setSuggestNote(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
          <div className="field">
            <label htmlFor="compensate">What can I schedule tomorrow to compensate?</label>
            <textarea
              id="compensate"
              value={compensate}
              disabled={closed}
              onChange={(e) => setCompensate(e.target.value)}
            />
          </div>
        </div>
      )}

      <button
        type="button"
        className={`tips-fab${tipsOpen ? " open" : ""}`}
        aria-label="Open tips"
        title="Tips"
        onClick={() => {
          prefetchSuggestModel();
          setTipsOpen((o) => !o);
        }}
      >
        <LightbulbIcon />
        {tips.length > 0 && !tipsOpen && (
          <span className="tips-badge" aria-hidden="true">
            {tips.length}
          </span>
        )}
      </button>
      {tipsOpen && (
        <div className="tips-sheet panel" role="dialog" aria-label="Tips">
          <div className="col-head">
            <h2>Tips</h2>
            <button type="button" className="btn secondary" onClick={() => {
              setTipsOpen(false);
              setJustFreed(undefined);
            }}>
              Close
            </button>
          </div>
          {tips.map((t) => (
            <div key={t.id} className="tip-card">
              <strong>{t.title}</strong>
              <p>{t.body}</p>
            </div>
          ))}
          {playHeavy && playSuggestions.length > 0 && (
            <div className="tip-card">
              <strong>Play deposits</strong>
              <p>Withdrawals are ahead. Try a play-category deposit to rebalance.</p>
              <div className="play-chips">
                {playSuggestions.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className="btn secondary"
                    disabled={closed}
                    onClick={() => {
                      void addLine("deposit", p.label, p.typicalCost);
                      setTipsOpen(false);
                    }}
                  >
                    {playCategoryTitle(p.category)} · {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Column(props: {
  title: string;
  side: "deposit" | "withdrawal";
  droppableId: string;
  className: string;
  lines: Line[];
  suggestions: Suggestion[];
  playSuggestions?: ReturnType<typeof suggestPlayDeposits>;
  closed: boolean;
  audit: boolean;
  onAdd: () => void;
  onConfirm: (s: Suggestion) => void;
  onPlay?: (p: { label: string; typicalCost: number }) => void;
  onActual: (line: Line, actual: number | null) => Promise<void>;
  onComplete: (line: Line) => void;
  onRemove: (id: string) => void;
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
          />
        ))}
      </SortableContext>
      {props.side === "deposit" &&
        props.playSuggestions?.map((p) => (
          <div key={p.label} className="task-row suggestion play-suggestion">
            <button
              type="button"
              className="btn plus confirm-add"
              disabled={props.closed}
              aria-label="Add play deposit"
              onClick={() => props.onPlay?.(p)}
            >
              +
            </button>
            <div>
              <div>{p.label}</div>
              <div className="task-meta">
                Play · {playCategoryTitle(p.category)} · {p.typicalCost}
              </div>
            </div>
          </div>
        ))}
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
      {!props.lines.length && !props.suggestions.length && !props.playSuggestions?.length && (
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
      className={`task-row${props.line.completed ? " completed" : ""}`}
      {...attributes}
      {...listeners}
    >
      <div className="task-main">
        <div className={props.line.completed ? "task-done-label" : undefined}>{props.line.label}</div>
        <div className="task-meta">
          Planned {props.line.plannedCost}
          {props.audit || props.closed
            ? ` · Actual ${props.line.actualCost ?? props.line.plannedCost}`
            : ""}
          {props.line.completed ? " · Done" : ""}
        </div>
        {props.audit && !props.closed && (
          <input
            type="number"
            className="task-actual-input"
            min={0}
            max={100}
            key={`${props.line.id}-${props.line.actualCost ?? "p"}`}
            defaultValue={props.line.actualCost ?? props.line.plannedCost}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const v = Number(e.target.value);
              void props.onActual(props.line, Number.isFinite(v) ? v : null);
            }}
          />
        )}
      </div>
      {!props.closed && (
        <div className="task-actions" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`btn secondary check-btn${props.line.completed ? " checked" : ""}`}
            aria-label={props.line.completed ? "Mark incomplete" : "Mark complete"}
            onClick={() => props.onComplete(props.line)}
          >
            ✓
          </button>
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
