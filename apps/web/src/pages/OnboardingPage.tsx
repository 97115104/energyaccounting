import { useEffect, useRef, useState, type ReactNode } from "react";
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
  // lines would be, so closing a day gets its own mark.
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

function LockGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="ob-glyph" aria-hidden="true">
      <rect
        x="16"
        y="28"
        width="32"
        height="24"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
      />
      <path
        d="M22 28v-6a10 10 0 0 1 20 0v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="40" r="3" fill="currentColor" />
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
  /** Teaching demo mirrored in content controls + aside visual. */
  demo?: "energy" | "day" | "privacy";
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

// One idea per slide: the core loop, the privacy boundary, and identity.
// Capacity mechanics and ranking detail live on Today via help disclosures.
const STEPS: Step[] = [
  {
    eyebrow: "Welcome",
    thesis: "Your energy matters.",
    whisper:
      "This is an energy accounting journal for neurodivergent brains, drawn from the method by Maja Toudal and Dr. Tony Attwood. You start each energy day when you are ready, and every day begins with a visible 100 points you can restore and spend. Try the buttons below to feel how that balance moves.",
    glyph: <SunGlyph />,
    source: { label: "Read about Energy Accounting", url: "https://energyaccounting.com/" },
    demo: "energy",
  },
  {
    eyebrow: "Your pace",
    thesis: "Your day is important.",
    whisper:
      "You decide when your energy day ends. An open day can stay with you across calendar dates, which makes room for irregular sleep, long focus stretches, shift work, and time blindness. When you are ready, you close the day and start the next one fresh at 100.",
    glyph: <DayDoneGlyph />,
    demo: "day",
  },
  {
    eyebrow: "Rhythm",
    thesis: "Plan, audit, close.",
    whisper:
      "Each day moves through three phases: planning, auditing how it actually felt, then closing. Your NeuroMe seal beside the greeting keeps that beat with you, and the ring around your mark shows today's remaining energy as you restore and spend it. Closed days live under Previous days on the Dashboard, where you can amend the record or delete it permanently.",
    glyph: <DayGlyph />,
    neurome: true,
  },
  {
    eyebrow: "Privacy",
    thesis: "What you write stays yours.",
    whisper:
      "Activity labels, journals, and task details are encrypted in your browser before they leave the device. Numeric totals stay available so trends and the Energy Guide can rank suggestions on this device, and every suggestion arrives with an explanation and a dismiss control.",
    glyph: <CheckGlyph />,
    demo: "privacy",
  },
  {
    eyebrow: "Getting to know you",
    thesis: "A private picture of you.",
    whisper:
      "On the You page, Your energy intelligence learns from the days you log: what tends to restore you, what costs energy, and what your typical day looks like. It is built on this device and stays private until you choose to share it. How to work with you turns that history into a short, editable note you can share in your own words.",
    glyph: <PersonGlyph />,
  },
  {
    eyebrow: "Symbolism matters",
    thesis: "Choose your mark.",
    whisper:
      "Neurodivergent people carry many symbols with pride. Pick the one that feels like yours, and it will appear on shares, exports, and your sign-in welcome. Inside the app your butterfly is always you, and you can change this any time on the You page.",
    glyph: <PersonGlyph />,
    identity: "symbol",
  },
  {
    eyebrow: "We are all butterflies",
    thesis: "Meet your butterfly.",
    whisper:
      "The butterfly is this app's symbol of becoming, with change that can feel like struggle from the inside. Pick a wing family to start from; there are eight, because neurodivergent people are as varied as butterflies. Its wings beat with your energy, and you can shape the edges, tails, and patterns any time on the You page.",
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
  const [includePhysicalActivities, setIncludePhysicalActivities] = useState(
    user.includePhysicalActivities !== false,
  );
  const [identity, setIdentity] = useState<IdentityConfig>(() =>
    normalizeIdentity(user.identity, user.id),
  );
  // Demo state for teaching slides; aside visuals mirror these controls.
  const [demoEnergy, setDemoEnergy] = useState(100);
  const [demoDayClosed, setDemoDayClosed] = useState(false);
  const [demoSealed, setDemoSealed] = useState(false);
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
  const tall =
    current.setup ||
    current.identity === "butterfly" ||
    current.identity === "symbol" ||
    Boolean(current.demo);

  function go(delta: 1 | -1) {
    setDirection(delta === 1 ? "next" : "prev");
    setStep((s) => Math.min(Math.max(s + delta, 0), STEPS.length - 1));
  }

  // Arrow keys page slides unless focus is in a field, picker, or teaching demo
  // (those controls own Left/Right). Chrome Continue/Back still allow paging.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], .ob-demo, .ob-identity, [role="radiogroup"]',
        )
      ) {
        return;
      }
      if (e.key === "ArrowRight" && !last) go(1);
      if (e.key === "ArrowLeft" && step > 0) go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, last]);

  // Reset teaching demos when entering their slide so the thesis stays true
  // (every day begins at 100; day starts open; sample note starts readable).
  useEffect(() => {
    if (current.demo === "energy") setDemoEnergy(100);
    if (current.demo === "day") setDemoDayClosed(false);
    if (current.demo === "privacy") setDemoSealed(false);
  }, [step, current.demo]);

  async function finish() {
    setError(null);
    try {
      // Build a partial PATCH: omit blank lat/lon so we never wipe coords that
      // App already saved via geolocation while the user was reading slides.
      const body: Record<string, unknown> = {
        displayName: name.trim() || null,
        greetingStyle,
        includePhysicalActivities,
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
        includePhysicalActivities,
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
      <div className="ob-progress" aria-hidden="true">
        <div
          className="ob-progress-fill"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      {/* key remounts the slide so the enter animation replays each step */}
      <article
        className={`ob-card ob-card-${direction}${tall ? " ob-card-tall" : ""}`}
        key={step}
        aria-labelledby="ob-thesis"
      >
        <div className="ob-content">
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
          {current.demo === "energy" && (
            <EnergyControls balance={demoEnergy} onChange={setDemoEnergy} />
          )}
          {current.demo === "day" && (
            <DayBoundaryControls closed={demoDayClosed} onChange={setDemoDayClosed} />
          )}
          {current.demo === "privacy" && (
            <PrivacyControls sealed={demoSealed} onChange={setDemoSealed} />
          )}
          {current.identity === "symbol" && (
            <div className="ob-setup ob-identity">
              <div
                className="you-symbol-grid you-symbol-grid--thumbs you-symbol-grid--symbols"
                role="radiogroup"
                aria-label="Your symbol"
              >
                {SYMBOLS.map((s) => (
                  <label
                    key={s.id}
                    className={`you-symbol-card${identity.symbol === s.id ? " selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="ob-symbol"
                      value={s.id}
                      checked={identity.symbol === s.id}
                      onChange={() => setIdentity({ ...identity, symbol: s.id })}
                    />
                    <span className="you-symbol-art">
                      <IdentityMark identity={identity} symbol={s.id} size={40} decorative />
                    </span>
                    <span className="you-symbol-copy">
                      <span className="you-symbol-name">{s.label}</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="ob-family-blurb muted">
                <strong>
                  {SYMBOLS.find((s) => s.id === identity.symbol)?.label ?? "Symbol"}.
                </strong>{" "}
                {SYMBOLS.find((s) => s.id === identity.symbol)?.blurb}
              </p>
            </div>
          )}
          {current.identity === "butterfly" && (
            <div className="ob-setup ob-identity">
              <WingFamilyPicker
                identity={identity}
                value={identity.archetype}
                suggestPalettes
                density="thumbnails"
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
              <fieldset className="field ob-activity-pref" style={{ border: "none", padding: 0 }}>
                <legend>Activity suggestions</legend>
                <label className="check-row" htmlFor="ob-include-physical">
                  <input
                    id="ob-include-physical"
                    type="checkbox"
                    checked={includePhysicalActivities}
                    onChange={(e) => setIncludePhysicalActivities(e.target.checked)}
                  />
                  <span>Include physical activities</span>
                </label>
                <p className="muted ob-style-example">
                  {includePhysicalActivities
                    ? "Suggestions may include walks, movement, and stretch breaks."
                    : "Suggestions focus on mindfulness, reading, journaling, writing, and connecting with people you care about."}
                </p>
              </fieldset>
              <p className="muted ob-setup-note">
                You can change any of this in <Link to="/settings">Settings</Link>.
              </p>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="ob-aside" aria-hidden="true">
          {current.demo === "energy" ? (
            <EnergyRing balance={demoEnergy} />
          ) : current.demo === "day" ? (
            <DayBoundaryVisual closed={demoDayClosed} />
          ) : current.demo === "privacy" ? (
            <PrivacyVisual sealed={demoSealed} />
          ) : current.identity === "symbol" ? (
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

const ENERGY_STEP = 12;

function EnergyControls({
  balance,
  onChange,
}: {
  balance: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="ob-demo" role="group" aria-label="Try a sample energy balance">
      <p className="ob-demo-value" aria-live="polite">
        {balance} of 100
      </p>
      <div className="ob-demo-actions">
        <button
          type="button"
          className="ob-demo-chip"
          onClick={() => onChange(Math.min(100, balance + ENERGY_STEP))}
          disabled={balance >= 100}
        >
          Add energy
        </button>
        <button
          type="button"
          className="ob-demo-chip"
          onClick={() => onChange(Math.max(0, balance - ENERGY_STEP))}
          disabled={balance <= 0}
        >
          Use energy
        </button>
      </div>
    </div>
  );
}

function EnergyRing({ balance }: { balance: number }) {
  const prefersReduced = usePrefersReducedMotion();
  const r = 46;
  const c = 2 * Math.PI * r;
  const filled = (balance / 100) * c;
  return (
    <div className="ob-energy-ring">
      <svg viewBox="0 0 120 120" width="140" height="140" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          opacity="0.18"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          transform="rotate(-90 60 60)"
          style={
            prefersReduced
              ? undefined
              : { transition: "stroke-dasharray 0.45s cubic-bezier(0.32, 0.72, 0, 1)" }
          }
        />
        <text
          x="60"
          y="60"
          textAnchor="middle"
          dominantBaseline="middle"
          className="ob-energy-ring-num"
          fill="currentColor"
        >
          {balance}
        </text>
      </svg>
    </div>
  );
}

function DayBoundaryControls({
  closed,
  onChange,
}: {
  closed: boolean;
  onChange: (closed: boolean) => void;
}) {
  return (
    <div className="ob-demo" role="radiogroup" aria-label="Day state">
      <div className="ob-segment">
        <label className={`ob-segment-btn${!closed ? " selected" : ""}`}>
          <input
            type="radio"
            name="ob-day-state"
            checked={!closed}
            onChange={() => onChange(false)}
          />
          Day still open
        </label>
        <label className={`ob-segment-btn${closed ? " selected" : ""}`}>
          <input
            type="radio"
            name="ob-day-state"
            checked={closed}
            onChange={() => onChange(true)}
          />
          Day closed by you
        </label>
      </div>
    </div>
  );
}

function DayBoundaryVisual({ closed }: { closed: boolean }) {
  return (
    <div className={`ob-day-visual${closed ? " closed" : ""}`}>
      {closed ? <DayDoneGlyph /> : <DayGlyph />}
      <p className="ob-day-caption">{closed ? "Closed by you" : "Still open"}</p>
    </div>
  );
}

function PrivacyControls({
  sealed,
  onChange,
}: {
  sealed: boolean;
  onChange: (sealed: boolean) => void;
}) {
  return (
    <div className="ob-demo" role="group" aria-label="Try keeping a note private">
      <p className="ob-privacy-sample" aria-live="polite">
        {sealed ? "•••• ••••• ••••••• •••••" : "A quiet note about my day"}
      </p>
      <div className="ob-demo-actions">
        <button
          type="button"
          className="ob-demo-chip"
          aria-pressed={sealed}
          onClick={() => onChange(!sealed)}
        >
          {sealed ? "Show sample" : "Keep private"}
        </button>
      </div>
      <p className="muted ob-demo-note">
        Labels encrypt in your browser before they leave the device.
      </p>
    </div>
  );
}

function PrivacyVisual({ sealed }: { sealed: boolean }) {
  return (
    <div className={`ob-privacy-visual${sealed ? " sealed" : ""}`}>
      {sealed ? <LockGlyph /> : <CheckGlyph />}
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
  // Hold still only after the person changes the radiogroup; idle cycling
  // still shows the full range on first visit.
  const [pinned, setPinned] = useState(false);
  const lastSymbol = useRef(identity.symbol);

  useEffect(() => {
    const i = SYMBOLS.findIndex((s) => s.id === identity.symbol);
    if (i >= 0) setIndex(i);
    if (identity.symbol !== lastSymbol.current) {
      lastSymbol.current = identity.symbol;
      setPinned(true);
    }
  }, [identity.symbol]);

  useEffect(() => {
    if (prefersReduced || pinned) return;
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % SYMBOLS.length),
      2400,
    );
    return () => window.clearInterval(id);
  }, [prefersReduced, pinned]);

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
