import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { UserProfile } from "../App";
import { api } from "../lib/api";
import { GREETING_STYLES, type GreetingStyle } from "../lib/greeting";

function SunGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="ob-glyph" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
        <line x1="32" y1="6" x2="32" y2="14" />
        <line x1="32" y1="50" x2="32" y2="58" />
        <line x1="6" y1="32" x2="14" y2="32" />
        <line x1="50" y1="32" x2="58" y2="32" />
        <line x1="13.6" y1="13.6" x2="19.3" y2="19.3" />
        <line x1="44.7" y1="44.7" x2="50.4" y2="50.4" />
        <line x1="13.6" y1="50.4" x2="19.3" y2="44.7" />
        <line x1="44.7" y1="19.3" x2="50.4" y2="13.6" />
      </g>
      <circle cx="32" cy="32" r="12" fill="currentColor" />
    </svg>
  );
}

function LedgerGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="ob-glyph" aria-hidden="true">
      <rect x="12" y="8" width="40" height="48" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <line x1="20" y1="20" x2="44" y2="20" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="20" y1="30" x2="44" y2="30" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="20" y1="40" x2="34" y2="40" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="ob-glyph" aria-hidden="true">
      <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path
        d="M20 33l8 8 16-18"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="ob-glyph" aria-hidden="true">
      <path
        d="M32 6a18 18 0 0 0-18 18c0 13 18 34 18 34s18-21 18-34A18 18 0 0 0 32 6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="24" r="7" fill="currentColor" />
    </svg>
  );
}

function PersonGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="ob-glyph" aria-hidden="true">
      <circle cx="32" cy="22" r="11" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path
        d="M12 56c2-12 10-18 20-18s18 6 20 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

type Step = {
  eyebrow: string;
  thesis: string;
  whisper: string;
  glyph: ReactNode;
  source?: { label: string; url: string };
  setup?: boolean;
};

const STEPS: Step[] = [
  {
    eyebrow: "The idea",
    thesis: "Your energy matters.",
    whisper:
      "An energy accounting journal built for neurodivergent brains. Deposits refill you, withdrawals cost you, and the balance carries into tomorrow, like money with no outside bank.",
    glyph: <SunGlyph />,
  },
  {
    eyebrow: "The method",
    thesis: "The ledger has roots.",
    whisper:
      "Maja Toudal and Dr. Tony Attwood developed Energy Accounting as a way to make deposits, withdrawals, and finite capacity visible enough to plan around.",
    glyph: <LedgerGlyph />,
    source: { label: "Read about Energy Accounting", url: "https://energyaccounting.com/" },
  },
  {
    eyebrow: "The hidden load",
    thesis: "The iceberg counts.",
    whisper:
      "Dr. Samantha Hiew's Tip of the ADHD Iceberg framing keeps invisible work in view, including sensory input, masking, executive-function effort, and recovery. Use difficulty ratings and private notes when that hidden load matters.",
    glyph: <SunGlyph />,
  },
  {
    eyebrow: "The rhythm",
    thesis: "Plan, audit, close.",
    whisper:
      "In the morning, plan the day's deposits and withdrawals. In the evening, audit how it actually felt. Then close the day to lock the sheet and carry the balance forward.",
    glyph: <LedgerGlyph />,
  },
  {
    eyebrow: "Reusable capacity",
    thesis: "Done frees capacity.",
    whisper:
      "Unfinished tasks reserve planned points. Completing one releases that reservation for reuse, while every other pending task keeps its own reservation. Completion frees capacity and does not mint new energy.",
    glyph: <CheckGlyph />,
  },
  {
    eyebrow: "Machine intelligence",
    thesis: "Your patterns stay useful.",
    whisper:
      "The app tries exact history first, then local text similarity when available. It ranks familiar deposits from your weekday, capacity, weather, and past use, while numeric trends power gentle observations.",
    glyph: <LedgerGlyph />,
  },
  {
    eyebrow: "The boundary",
    thesis: "Helpful, with limits.",
    whisper:
      "Suggestions are editable estimates and improve only when enough history exists. Labels, journals, task details, and audio are encrypted before upload, while numeric totals remain available for private trend calculations.",
    glyph: <CheckGlyph />,
  },
  {
    eyebrow: "The atmosphere",
    thesis: "Skies included.",
    whisper:
      "Set a location and the background follows your real weather and sunset, tips consider the UV index, and the app quietly nudges you outside when it's nice out.",
    glyph: <PinGlyph />,
  },
  {
    eyebrow: "Last step",
    thesis: "Make it yours.",
    whisper:
      "Everything here is optional and editable later in Settings. A name makes the greetings warmer, coordinates power the live sky, and the greeting style sets the headline's mood.",
    glyph: <PersonGlyph />,
    setup: true,
  },
];

type Props = {
  user: UserProfile;
  onUser: (u: UserProfile) => void;
};

export function OnboardingPage({ user, onUser }: Props) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(user.displayName ?? "");
  const [lat, setLat] = useState(String(user.lat ?? ""));
  const [lon, setLon] = useState(String(user.lon ?? ""));
  const [greetingStyle, setGreetingStyle] = useState<GreetingStyle>(
    user.greetingStyle ?? "mix",
  );
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const replay = params.get("replay") === "1";

  // If App geolocates while the user is still on a slide, pick up those coords
  // into empty fields so finish() doesn't clobber them with null.
  useEffect(() => {
    if (lat === "" && user.lat != null) setLat(String(user.lat));
  }, [user.lat, lat]);
  useEffect(() => {
    if (lon === "" && user.lon != null) setLon(String(user.lon));
  }, [user.lon, lon]);

  const last = step >= STEPS.length - 1;
  const current = STEPS[step]!;

  function go(delta: 1 | -1) {
    setDirection(delta === 1 ? "next" : "prev");
    setStep((s) => Math.min(Math.max(s + delta, 0), STEPS.length - 1));
  }

  // Arrow keys page through the slides, Apple-keynote style.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight" && !last) go(1);
      if (e.key === "ArrowLeft" && step > 0) go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, last]);

  async function finish() {
    setError(null);
    try {
      // Build a partial PATCH: omit blank lat/lon so we never wipe coords that
      // App already saved via geolocation while the user was reading slides.
      const body: Record<string, unknown> = {
        displayName: name.trim() || null,
        greetingStyle,
        locationPrompted: true,
        onboardingCompleted: true,
      };
      let nextLat = user.lat ?? null;
      let nextLon = user.lon ?? null;
      if (lat !== "") {
        const n = Number(lat);
        if (!Number.isFinite(n)) {
          setError("Latitude must be a number.");
          return;
        }
        body.lat = n;
        nextLat = n;
      }
      if (lon !== "") {
        const n = Number(lon);
        if (!Number.isFinite(n)) {
          setError("Longitude must be a number.");
          return;
        }
        body.lon = n;
        nextLon = n;
      }
      const nextName = name.trim() || null;
      await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onUser({
        ...user,
        displayName: nextName,
        lat: nextLat,
        lon: nextLon,
        greetingStyle,
        locationPrompted: true,
        onboardingCompleted: true,
      });
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save overview progress.");
    }
  }

  return (
    <div className="ob-root">
      <div
        className="ob-progress"
        aria-hidden="true"
      >
        <div
          className="ob-progress-fill"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      {/* key remounts the slide so the enter animation replays each step */}
      <article
        className={`ob-card ob-card-${direction}`}
        key={step}
        aria-labelledby="ob-thesis"
      >
        <div className="ob-content" aria-live="polite" aria-atomic="true">
          <p className="ob-eyebrow">{current.eyebrow}</p>
          <h2 className="ob-thesis" id="ob-thesis">
            {current.thesis}
          </h2>
          <p className="ob-whisper">{current.whisper}</p>
          {current.source && (
            <a href={current.source.url} target="_blank" rel="noreferrer" className="ob-source">
              {current.source.label}
              <span aria-hidden="true"> ↗</span>
            </a>
          )}
          {current.setup && (
            <div className="ob-setup">
              <div className="field">
                <label htmlFor="ob-name">Name or alias</label>
                <input
                  id="ob-name"
                  value={name}
                  maxLength={80}
                  autoComplete="nickname"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="ob-location-fields">
                <div className="field">
                  <label htmlFor="ob-lat">Latitude</label>
                  <input
                    id="ob-lat"
                    inputMode="decimal"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ob-lon">Longitude</label>
                  <input
                    id="ob-lon"
                    inputMode="decimal"
                    value={lon}
                    onChange={(e) => setLon(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="ob-greeting-style">Greeting style</label>
                <select
                  id="ob-greeting-style"
                  value={greetingStyle}
                  onChange={(e) => setGreetingStyle(e.target.value as GreetingStyle)}
                >
                  {GREETING_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <p className="muted ob-style-example">
                  {GREETING_STYLES.find((s) => s.value === greetingStyle)?.example}
                </p>
              </div>
              <p className="muted ob-setup-note">
                You can change any of this in <Link to="/settings">Settings</Link>.
              </p>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="ob-aside" aria-hidden="true">
          {current.glyph}
        </div>
      </article>

      <div className="ob-chrome">
        <div className="ob-dots" role="group" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <button
              key={s.thesis}
              type="button"
              aria-current={i === step ? "step" : undefined}
              aria-label={`Step ${i + 1} of ${STEPS.length}`}
              className={`ob-dot${i === step ? " active" : ""}`}
              onClick={() => {
                setDirection(i > step ? "next" : "prev");
                setStep(i);
              }}
            />
          ))}
        </div>

        <div className="ob-actions">
          {!last ? (
            <button type="button" className="btn accent ob-continue" onClick={() => go(1)}>
              Continue
            </button>
          ) : (
            <button type="button" className="btn accent ob-continue" onClick={() => void finish()}>
              {replay ? "Done" : "Start journaling"}
            </button>
          )}
          <div className="ob-quiet-actions">
            {step > 0 && (
              <button type="button" className="linkish" onClick={() => go(-1)}>
                Back
              </button>
            )}
            {replay && (
              <button type="button" className="linkish" onClick={() => navigate("/settings")}>
                Back to settings
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
