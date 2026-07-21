import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { UserProfile } from "../App";
import { Butterfly } from "../components/Butterfly";
import { DictatableField } from "../components/DictatableField";
import { IdentityMark, NeuroMe } from "../components/IdentityMark";
import { WingFamilyPicker } from "../components/IdentityPickers";
import { api } from "../lib/api";
import { normalizeWing } from "../lib/butterflyGeometry";
import { resolveButterflyState } from "../lib/butterflyState";
import { GREETING_STYLES, type GreetingStyle } from "../lib/greeting";
import { usePrefersReducedMotion } from "../lib/useButterflyDay";
import {
  PALETTE_PRESETS,
  SYMBOLS,
  archetypeMeta,
  normalizeIdentity,
  paletteSwatchBackground,
  type IdentityConfig,
} from "../lib/identity";

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

function DayGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="ob-glyph" aria-hidden="true">
      <rect x="12" y="8" width="40" height="48" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <line x1="20" y1="20" x2="44" y2="20" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="20" y1="30" x2="44" y2="30" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="20" y1="40" x2="34" y2="40" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

function DayDoneGlyph() {
  // The journal from DayGlyph, but finished: a bold check where the remaining
  // lines would be, so "close it when you're done" gets its own mark.
  return (
    <svg viewBox="0 0 64 64" className="ob-glyph" aria-hidden="true">
      <rect x="12" y="8" width="40" height="48" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <line x1="20" y1="19" x2="44" y2="19" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <line x1="20" y1="28" x2="36" y2="28" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path
        d="M22 42l7 7 14-16"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  /** Interactive identity slides: pick a symbol, then shape the butterfly. */
  identity?: "symbol" | "butterfly";
  /** Show the person's NeuroMe seal in the aside instead of the glyph. */
  neurome?: boolean;
};

/**
 * A mid-day sample state so the rhythm slide's NeuroMe seal shows a partly
 * filled vitality ring, which is what the header will actually look like.
 */
const NEUROME_DEMO_STATE = resolveButterflyState({
  available: 68,
  opening: 100,
  depositTotal: 15,
  withdrawalTotal: 47,
  incompleteWithdrawals: 1,
  completedCount: 3,
  withdrawalHeavy: false,
  feelRating: null,
  phase: "audit",
});

// Deliberately short: the core loop and the privacy boundary. Everything
// else (capacity mechanics, the Attwood terms, how suggestions are ranked)
// is taught in place on the Today page via help disclosures and the Energy
// Guide, where it can attach to a real day instead of theory.
const STEPS: Step[] = [
  {
    eyebrow: "Idea",
    thesis: "Your energy matters.",
    whisper:
      "An energy accounting journal built for neurodivergent brains, from the method by Maja Toudal and Dr. Tony Attwood. You explicitly start each energy day when you're ready; nothing starts automatically. Every day gets a fresh 100 points with no carry from the last one. Add energy with restorative activities, track what uses energy, and complete planned tasks to free their reserved capacity.",
    glyph: <SunGlyph />,
    source: { label: "Read about Energy Accounting", url: "https://energyaccounting.com/" },
  },
  {
    eyebrow: "Your day, your boundary",
    thesis: "Close it when you're done.",
    whisper:
      "Your energy day ends when you close it, not when the clock hits midnight. Irregular sleep, long focus stretches, shift work, and time blindness are normal here; an open day stays active across calendar dates with no penalty. When you're ready, close it and explicitly start the next day fresh at 100.",
    glyph: <DayDoneGlyph />,
  },
  {
    eyebrow: "Rhythm",
    thesis: "Plan, audit, close.",
    whisper:
      "Each day moves through three phases: planning, auditing how it actually felt, then closing. Your NeuroMe seal beside the greeting keeps that beat with you: the ring around your mark is today's remaining energy, easing as tasks use it and refilling as you add it back. Closed days appear under Previous days on the Dashboard and open read-only, where you can amend the record or delete it permanently.",
    glyph: <DayGlyph />,
    neurome: true,
  },
  {
    eyebrow: "Privacy",
    thesis: "Private by architecture.",
    whisper:
      "Activity labels, journals, and task details are encrypted before they leave your browser. Numeric totals stay available on this device so trends and the Energy Guide can rank suggestions, with an explanation and a dismiss control available for every suggestion.",
    glyph: <CheckGlyph />,
  },
  {
    eyebrow: "Getting to know you",
    thesis: "A private picture of you.",
    whisper:
      "On the You page, Your energy intelligence quietly learns from the days you log: what tends to restore you, what costs energy, and what your typical day actually looks like. It is built on this device and stays private unless you choose to share it. How to work with you turns that into a short, shareable perspective, drafted from your history and editable in your own words, so people can understand you without you having to explain from scratch. The more you log, the sharper it gets.",
    glyph: <PersonGlyph />,
  },
  {
    eyebrow: "Symbolism matters",
    thesis: "Choose your mark.",
    whisper:
      "Neurodivergent people carry many symbols with pride. Pick the one that feels like yours; it appears on shares, exports, and your sign-in welcome. Inside the app, your butterfly is always you, and you can change this any time on the You page.",
    glyph: <PersonGlyph />,
    identity: "symbol",
  },
  {
    eyebrow: "We are all butterflies",
    thesis: "Meet your butterfly.",
    whisper:
      "The butterfly is this app's symbol of becoming: change that looks like struggle from the inside. Pick a wing family to start from; there are eight, because neurodivergent people are as varied as butterflies. Its wings beat with your energy, and its colors mean whatever you decide. Shape the edges, tails, and patterns any time on the You page.",
    glyph: <PersonGlyph />,
    identity: "butterfly",
  },
  {
    eyebrow: "Last step",
    thesis: "Make it yours.",
    whisper:
      "Everything here is optional and editable later in Settings. A name makes the greetings warmer, coordinates power the live sky and weather-aware suggestions, and the greeting style sets the headline's mood.",
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
  const [identity, setIdentity] = useState<IdentityConfig>(() =>
    normalizeIdentity(user.identity, user.id),
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
        identity,
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
        identity,
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
        className={`ob-card ob-card-${direction}${
          current.setup || current.identity === "butterfly" ? " ob-card-tall" : ""
        }`}
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
          {current.identity === "symbol" && (
            <div className="ob-setup ob-identity" role="radiogroup" aria-label="Your symbol">
              {SYMBOLS.map((s) => (
                <label
                  key={s.id}
                  className={`ob-symbol-card${identity.symbol === s.id ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="ob-symbol"
                    value={s.id}
                    checked={identity.symbol === s.id}
                    onChange={() => setIdentity({ ...identity, symbol: s.id })}
                  />
                  <span className="ob-symbol-art">
                    <IdentityMark identity={identity} symbol={s.id} size={40} decorative />
                  </span>
                  <span className="ob-symbol-copy">
                    <strong>{s.label}</strong>
                    <span className="muted">{s.blurb}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {current.identity === "butterfly" && (
            <div className="ob-setup ob-identity">
              <WingFamilyPicker
                identity={identity}
                value={identity.archetype}
                suggestPalettes
                compact
                name="ob-archetype"
                onChange={(family) =>
                  setIdentity({
                    ...identity,
                    archetype: family,
                    // Keep the wing family in step with the chosen base, and
                    // start from the family's suggested palette.
                    wing: normalizeWing(family, identity.wing),
                    palette: { ...archetypeMeta(family).palette },
                  })
                }
              />
              <div className="ob-palettes" role="group" aria-label="Wing colors">
                {PALETTE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    className={`ob-palette${
                      identity.palette.primary === p.palette.primary ? " selected" : ""
                    }`}
                    aria-pressed={identity.palette.primary === p.palette.primary}
                    onClick={() => setIdentity({ ...identity, palette: { ...p.palette } })}
                  >
                    <span
                      className="you-preset-swatch"
                      style={{ background: paletteSwatchBackground(p.palette) }}
                      aria-hidden="true"
                    />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {current.setup && (
            <div className="ob-setup">
              <DictatableField
                label="Name or alias"
                value={name}
                maxLength={80}
                autoComplete="nickname"
                onChange={setName}
                dictateLabel="your name"
              />
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
          {current.identity === "symbol" ? (
            <SymbolShowcase identity={identity} />
          ) : current.identity === "butterfly" ? (
            <Butterfly identity={identity} beatMs={2400} size={160} />
          ) : current.neurome ? (
            <NeuroMe identity={identity} state={NEUROME_DEMO_STATE} size={128} decorative />
          ) : (
            current.glyph
          )}
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
            {!last && !replay && (
              <button type="button" className="linkish" onClick={() => void finish()}>
                Skip for now
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

/**
 * Decorative slideshow for the "Your symbol" slide: cycles through every mark
 * with a gentle pop-and-float so the aside shows the whole range, not only the
 * butterfly. Snaps to the person's current pick and holds still under reduced
 * motion. Purely visual (the parent aside is aria-hidden).
 */
function SymbolShowcase({ identity }: { identity: IdentityConfig }) {
  const prefersReduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(() =>
    Math.max(0, SYMBOLS.findIndex((s) => s.id === identity.symbol)),
  );

  // A fresh selection takes the spotlight immediately.
  useEffect(() => {
    const i = SYMBOLS.findIndex((s) => s.id === identity.symbol);
    if (i >= 0) setIndex(i);
  }, [identity.symbol]);

  useEffect(() => {
    if (prefersReduced) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % SYMBOLS.length),
      2400,
    );
    return () => window.clearInterval(id);
  }, [prefersReduced]);

  return (
    <div className="ob-symbol-cycle">
      {SYMBOLS.map((s, i) => (
        <span key={s.id} className={i === index ? "active" : ""}>
          <span className="ob-cycle-float">
            <IdentityMark identity={identity} symbol={s.id} size={128} decorative />
          </span>
        </span>
      ))}
    </div>
  );
}
