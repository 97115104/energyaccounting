import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { UserProfile } from "../App";
import { Butterfly } from "../components/Butterfly";
import { CompletionBurst } from "../components/CompletionBurst";
import { DictatableField } from "../components/DictatableField";
import { IdentityMark, NeuroMe } from "../components/IdentityMark";
import { WingFamilyPicker } from "../components/IdentityPickers";
import { api } from "../lib/api";
import { normalizeWing } from "../lib/butterflyGeometry";
import { resolveButterflyState } from "../lib/butterflyState";
import { GREETING_STYLES, type GreetingStyle } from "../lib/greeting";
import {
  PALETTE_PRESETS,
  SYMBOLS,
  archetypeMeta,
  normalizeIdentity,
  paletteSwatchBackground,
  type ButterflyPalette,
  type IdentityConfig,
} from "../lib/identity";
import { usePrefersReducedMotion } from "../lib/useButterflyDay";
import { SLOT_LABEL } from "../lib/youProfile";

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="ob-inline-link">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

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
  whisper: ReactNode;
  glyph: ReactNode;
  source?: { label: string; url: string };
  setup?: boolean;
  identity?: "symbol" | "butterfly";
  neurome?: boolean;
  demo?: "energy" | "day" | "privacy" | "reward" | "weather" | "built" | "share" | "homescreen";
};

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

const SOURCE_REPO = "https://github.com/97115104/energyaccounting";
const PRODUCT = "Your Energy Matters";

function ShareGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="ob-glyph" aria-hidden="true">
      <circle cx="46" cy="14" r="8" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <circle cx="46" cy="50" r="8" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <circle cx="18" cy="32" r="8" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path
        d="M25 28l14-10M25 36l14 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HomeScreenGlyph() {
  return (
    <svg viewBox="0 0 64 64" className="ob-glyph" aria-hidden="true">
      <rect
        x="14"
        y="8"
        width="36"
        height="48"
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
      />
      <rect x="22" y="18" width="20" height="20" rx="4" fill="currentColor" opacity="0.35" />
      <circle cx="32" cy="48" r="2.5" fill="currentColor" />
    </svg>
  );
}

/** True only on mobile phones (not tablets, not desktop), and not already installed. */
function useShowHomeScreenTip(): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean; userAgentData?: { mobile?: boolean } };
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
    if (standalone) {
      setShow(false);
      return;
    }
    const ua = nav.userAgent || "";
    // iPadOS can report as Mac; exclude tablets. Prefer UA "Mobile" phones.
    const iPad = /iPad/i.test(ua) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
    const iPhoneOrPod = /iPhone|iPod/i.test(ua);
    const androidPhone = /Android/i.test(ua) && /Mobile/i.test(ua);
    const uaDataPhone = nav.userAgentData?.mobile === true && !iPad;
    setShow((iPhoneOrPod || androidPhone || uaDataPhone) && !iPad);
  }, []);
  return show;
}

function buildSteps(includeHomeScreen: boolean): Step[] {
  const steps: Step[] = [
    {
      eyebrow: "Welcome",
      thesis: "Your energy matters.",
      whisper: (
        <>
          {PRODUCT} is a journal for neurodivergent minds, following Energy Accounting by{" "}
          <ExtLink href="https://majatoudal.com/">Maja Toudal</ExtLink> and{" "}
          <ExtLink href="https://www.tonyattwood.com.au/">Dr. Tony Attwood</ExtLink>. Adults,
          children, and therapists use it to grow steadier days and clearer productivity. You start
          each day when you are ready, and every day begins with 100 points. Adding energy back and
          spending it with the same care is part of a healthy lifestyle, so restores and uses stay
          visible side by side. Try the buttons below to feel how that balance moves.
        </>
      ),
      glyph: <SunGlyph />,
      source: { label: "Read about Energy Accounting", url: "https://energyaccounting.com/" },
      demo: "energy",
    },
    {
      eyebrow: "Your pace",
      thesis: "Your day is important.",
      whisper: (
        <>
          You decide when your energy day ends. An open day can stay with you across calendar dates,
          which makes room for irregular sleep, long focus stretches, shift work, and time blindness.
          When you are ready, you close the day and start the next one fresh at 100.
        </>
      ),
      glyph: <DayDoneGlyph />,
      demo: "day",
    },
    {
      eyebrow: "Rhythm",
      thesis: "Plan, audit, close.",
      whisper: (
        <>
          Each day moves through three phases: planning, auditing how it actually felt, then
          closing. Your NeuroMe seal beside the greeting keeps that beat with you, and the ring
          around your mark shows today&apos;s remaining energy as you restore and spend it. Closed
          days live under Previous days on the Dashboard, where you can amend the record or delete
          it permanently.
        </>
      ),
      glyph: <DayGlyph />,
      neurome: true,
    },
    {
      eyebrow: "Careful rewards",
      thesis: "Gentle rewards, on purpose.",
      whisper: (
        <>
          Social apps often use{" "}
          <ExtLink href="https://en.wikipedia.org/wiki/Reinforcement#Variable_ratio_schedules">
            variable ratio reinforcement
          </ExtLink>{" "}
          to keep people scrolling. {PRODUCT} uses the same science in a small, optional way when
          you finish something, so a quiet spark or kind line can support momentum without trapping
          you. You stay in control, and reduced motion settings still win.
        </>
      ),
      glyph: <CheckGlyph />,
      demo: "reward",
    },
    {
      eyebrow: "Outside your window",
      thesis: "Your day outside matters.",
      whisper: (
        <>
          {PRODUCT} factors weather and daylight into suggestions so outdoor restores show up when
          they can help productivity and mood, and quieter indoor options come forward when
          conditions are rough.{" "}
          <ExtLink href="https://en.wikipedia.org/wiki/Green_exercise">Green exercise</ExtLink>{" "}
          research supports that link. Location is optional later; without it, your sky still follows
          time of day.
        </>
      ),
      glyph: <SunGlyph />,
      source: { label: "Weather from Open-Meteo", url: "https://open-meteo.com/" },
      demo: "weather",
    },
    {
      eyebrow: "Privacy",
      thesis: "What you write stays yours.",
      whisper: (
        <>
          Words you type, including notes, activity names, and task details, lock up in your browser
          before they go anywhere. Energy numbers stay readable so {PRODUCT} can spot patterns and
          suggest restores. Every suggestion says why it appeared, and you can dismiss it.
        </>
      ),
      glyph: <CheckGlyph />,
      demo: "privacy",
    },
    {
      eyebrow: "Our promise",
      thesis: "Built by us, for us.",
      whisper: (
        <>
          {PRODUCT} is built by neurodivergents for neurodivergents. It is free forever and{" "}
          <ExtLink href={SOURCE_REPO}>open source</ExtLink> under MIT. You can host your own copy
          and leave whenever you want.
        </>
      ),
      glyph: <PersonGlyph />,
      source: { label: "View the source", url: SOURCE_REPO },
      demo: "built",
    },
    {
      eyebrow: "Getting to know you",
      thesis: "A private picture of you.",
      whisper: (
        <>
          As you log days, your You page builds a personal productivity intelligence from your own
          history: what restores you, what drains you, and what a typical day looks like.
          Suggestions and drafts compute on this device from that history. Your You notes leave only
          as encrypted text you control, and stay private until you choose to share. How to work with
          you turns the picture into a short note you can edit in your own words.
        </>
      ),
      glyph: <PersonGlyph />,
    },
    {
      eyebrow: "Sharing",
      thesis: "Share when you are ready.",
      whisper: (
        <>
          Neurodivergent people often work hard to name what energizes them, and harder still to
          explain needs to friends, family, or a therapist. {PRODUCT} starts with private
          intelligence so you can see what lights you up, then offers optional sharing when you want
          help with that communication bandwidth: a butterfly image, a printable note, or a link you
          can revoke. Nothing is required. You choose what leaves, and when.
        </>
      ),
      glyph: <ShareGlyph />,
      demo: "share",
    },
    {
      eyebrow: "Symbolism matters",
      thesis: "Choose your mark.",
      whisper: (
        <>
          Neurodivergent people carry many symbols with pride. Pick the one that feels like yours,
          and it will appear on shares, exports, and your sign-in welcome. Inside {PRODUCT}, your
          butterfly is always you, and you can change this any time on the You page.
        </>
      ),
      glyph: <PersonGlyph />,
      identity: "symbol",
    },
    {
      eyebrow: "We are all butterflies",
      thesis: "Meet your butterfly.",
      whisper: (
        <>
          Your butterfly is your living mark inside {PRODUCT}. Pick a wing family that feels like
          you; there are eight to choose from, because neurodivergent people are as varied as
          butterflies. Wings move with your energy, and you can tune colors below or refine edges,
          tails, and patterns any time on the You page.
        </>
      ),
      glyph: <PersonGlyph />,
      identity: "butterfly",
    },
  ];

  if (includeHomeScreen) {
    steps.push({
      eyebrow: "On your phone",
      thesis: "Keep it close.",
      whisper: (
        <>
          For the fullest experience on iPhone, open {PRODUCT} in Safari, tap Share, then Add to
          Home Screen, and leave Open as Web App on. You get your own icon, full screen, no browser
          chrome. On Android phones, look for Install app in the browser menu. Optional, and worth
          it when you want {PRODUCT} to feel like a calm home for your days.
        </>
      ),
      glyph: <HomeScreenGlyph />,
      source: {
        label: "Apple guide: Open as Web App",
        url: "https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios",
      },
      demo: "homescreen",
    });
  }

  steps.push({
    eyebrow: "Last step",
    thesis: "Make it yours.",
    whisper: (
      <>
        Everything here is optional and editable later in Settings. A name makes greetings warmer,
        and optional coordinates power your live sky and weather-aware suggestions. Greeting style
        chooses the welcome line at the top of Today.
      </>
    ),
    glyph: <PersonGlyph />,
    setup: true,
  });

  return steps;
}

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
  const [demoEnergy, setDemoEnergy] = useState(100);
  const [demoDayClosed, setDemoDayClosed] = useState(false);
  const [demoSealed, setDemoSealed] = useState(false);
  const [homeStep, setHomeStep] = useState(0);
  const [rewardIndex, setRewardIndex] = useState(0);
  const [rewardPinned, setRewardPinned] = useState(false);
  const showHomeScreen = useShowHomeScreenTip();
  const steps = buildSteps(showHomeScreen);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const replay = params.get("replay") === "1";

  useEffect(() => {
    if (lat === "" && user.lat != null) setLat(String(user.lat));
  }, [user.lat, lat]);
  useEffect(() => {
    if (lon === "" && user.lon != null) setLon(String(user.lon));
  }, [user.lon, lon]);

  const last = step >= steps.length - 1;
  const current = steps[step]!;
  const tall =
    current.setup ||
    current.identity === "butterfly" ||
    current.identity === "symbol" ||
    Boolean(current.demo);

  function go(delta: 1 | -1) {
    setDirection(delta === 1 ? "next" : "prev");
    setStep((s) => Math.min(Math.max(s + delta, 0), steps.length - 1));
  }

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
  }, [step, last, steps.length]);

  useEffect(() => {
    if (current.demo === "energy") setDemoEnergy(100);
    if (current.demo === "day") setDemoDayClosed(false);
    if (current.demo === "privacy") setDemoSealed(false);
    if (current.demo === "reward") {
      setRewardIndex(0);
      setRewardPinned(false);
    }
    if (current.demo === "homescreen") setHomeStep(0);
  }, [step, current.demo]);

  // If the home-screen tip appears after mount, keep the user on a valid index.
  useEffect(() => {
    setStep((s) => Math.min(s, Math.max(0, steps.length - 1)));
  }, [steps.length]);

  function setPaletteSlot(slot: keyof ButterflyPalette, value: string) {
    if (slot === "rainbow") return;
    const { rainbow: _drop, ...rest } = identity.palette;
    setIdentity({ ...identity, palette: { ...rest, [slot]: value } });
  }

  async function finish() {
    setError(null);
    try {
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
          style={{ width: `${((step + 1) / steps.length) * 100}%` }}
        />
      </div>

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
              <span className="sr-only"> (opens in a new tab)</span>
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
          {current.demo === "reward" && (
            <RewardControls
              index={rewardIndex}
              onPick={(i) => {
                setRewardPinned(true);
                setRewardIndex(i);
              }}
            />
          )}
          {current.demo === "homescreen" && (
            <HomeScreenControls step={homeStep} onStep={setHomeStep} />
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
                    wing: normalizeWing(family, identity.wing),
                    palette: { ...archetypeMeta(family).palette },
                  })
                }
              />
              <div className="ob-palettes" role="group" aria-label="Wing color presets">
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
              <div className="you-color-rows ob-color-rows">
                {(["primary", "secondary", "accent"] as const).map((slot) => (
                  <div key={slot} className="you-color-row">
                    <label className="you-color-slot" htmlFor={`ob-color-${slot}`}>
                      {SLOT_LABEL[slot]}
                    </label>
                    <input
                      id={`ob-color-${slot}`}
                      type="color"
                      value={identity.palette[slot]}
                      onChange={(e) => setPaletteSlot(slot, e.target.value)}
                    />
                  </div>
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
                <p className="muted ob-greeting-help">
                  Greeting style is the sentence that greets you at the top of Today. Mix rotates
                  styles; Classic stays calm; ND humor stays playful; Fun facts brings a curious
                  tidbit.
                </p>
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
          ) : current.demo === "reward" ? (
            <RewardShowcase
              index={rewardIndex}
              pinned={rewardPinned}
              onIndex={setRewardIndex}
            />
          ) : current.demo === "weather" ? (
            <WeatherVisual />
          ) : current.demo === "built" ? (
            <FistHeartCycle />
          ) : current.demo === "share" ? (
            <ShareGlyph />
          ) : current.demo === "homescreen" ? (
            <HomeScreenVisual step={homeStep} />
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
        <p className="ob-step-meter" aria-live="polite">
          Step {step + 1} of {steps.length}
        </p>
        <div className="ob-dots" role="group" aria-label="Onboarding progress">
          {steps.map((s, i) => (
            <button
              key={s.thesis}
              type="button"
              aria-current={i === step ? "step" : undefined}
              aria-label={`Step ${i + 1} of ${steps.length}`}
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
          className="ob-demo-chip ob-demo-chip-deposit"
          onClick={() => onChange(Math.min(100, balance + ENERGY_STEP))}
          disabled={balance >= 100}
        >
          + Add energy
        </button>
        <button
          type="button"
          className="ob-demo-chip ob-demo-chip-withdraw"
          onClick={() => onChange(Math.max(0, balance - ENERGY_STEP))}
          disabled={balance <= 0}
        >
          − Use energy
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

const REWARD_SAMPLES = [
  {
    id: "small",
    label: "Quiet spark",
    blurb: "Most finishes stay this soft.",
    kind: "burst" as const,
    tier: "small" as const,
    quip: null,
  },
  {
    id: "medium",
    label: "Soft burst",
    blurb: "A little more motion, still calm.",
    kind: "burst" as const,
    tier: "medium" as const,
    quip: null,
  },
  {
    id: "rare",
    label: "Rare quip",
    blurb: "Once in a while, a kind line appears.",
    kind: "burst" as const,
    tier: "rare" as const,
    quip: "Nice work.",
  },
  {
    id: "fire",
    label: "Fire praise",
    blurb: "Footer encouragement with a warm accent.",
    kind: "praise" as const,
    effect: "fire" as const,
  },
  {
    id: "rainbow",
    label: "Rainbow praise",
    blurb: "The rarer footer accent, for momentum.",
    kind: "praise" as const,
    effect: "rainbow" as const,
  },
];

function RewardControls({
  index,
  onPick,
}: {
  index: number;
  onPick: (n: number) => void;
}) {
  const sample = REWARD_SAMPLES[index] ?? REWARD_SAMPLES[0]!;
  return (
    <div className="ob-demo" role="group" aria-label="Sample gentle rewards">
      <div className="ob-reward-picks" role="list">
        {REWARD_SAMPLES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="listitem"
            className={`ob-demo-chip${i === index ? " selected" : ""}`}
            aria-pressed={i === index}
            onClick={() => onPick(i)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="muted ob-demo-note" aria-live="polite">
        <strong>{sample.label}.</strong> {sample.blurb} Real finishes stay intermittent on purpose.
      </p>
    </div>
  );
}

/**
 * Cycles the real completion burst tiers and praise accents so the person can
 * see the subtle vocabulary before they meet it on Today.
 */
function RewardShowcase({
  index,
  pinned,
  onIndex,
}: {
  index: number;
  pinned: boolean;
  onIndex: (n: number) => void;
}) {
  const prefersReduced = usePrefersReducedMotion();
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    if (prefersReduced || pinned) return;
    const id = window.setInterval(() => {
      onIndex((index + 1) % REWARD_SAMPLES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [prefersReduced, pinned, index, onIndex]);

  // Remount bursts so CSS animations replay on every sample change.
  useEffect(() => {
    setReplay((n) => n + 1);
  }, [index]);

  const sample = REWARD_SAMPLES[index] ?? REWARD_SAMPLES[0]!;
  const showQuip = sample.kind === "burst" && Boolean(sample.quip) && !prefersReduced;
  const showPraise = sample.kind === "praise";

  return (
    <div className="ob-reward-stage">
      {/* Fixed-height line keeps the glyph from shifting when quips or praise appear. */}
      <p
        className={`ob-reward-line${showQuip || showPraise ? " has-copy" : ""}`}
        aria-live="polite"
      >
        {showPraise ? (
          <>
            3 done.{" "}
            <span className={`praise-accent praise-accent-${sample.effect}`}>
              {sample.effect === "fire" ? "You're awesome!" : "Keep that momentum!"}
            </span>
            {sample.effect === "fire" && !prefersReduced && (
              <span className="praise-flame" aria-hidden="true">
                {" "}
                🔥
              </span>
            )}
          </>
        ) : showQuip ? (
          sample.quip
        ) : (
          "\u00a0"
        )}
      </p>
      <div className="ob-reward-anchor">
        <CheckGlyph />
        {sample.kind === "burst" && (
          <CompletionBurst
            key={`${sample.id}-${replay}`}
            tier={sample.tier}
            side="deposit"
            x={0}
            y={0}
            quip={null}
          />
        )}
      </div>
      <p className="ob-day-caption">{sample.label}</p>
    </div>
  );
}

function WeatherVisual() {
  // Use the onboarding sun glyph, not WeatherGlyph chip chrome (glow/fill).
  return (
    <div className="ob-weather-visual">
      <SunGlyph />
      <p className="ob-day-caption">Live sky</p>
    </div>
  );
}

const HOME_STEPS = [
  { title: "Share", detail: "In Safari, tap the Share button." },
  { title: "Add to Home Screen", detail: "Scroll the sheet and choose Add to Home Screen." },
  { title: "Open as Web App", detail: "Leave Open as Web App on, then tap Add." },
] as const;

function HomeScreenControls({
  step,
  onStep,
}: {
  step: number;
  onStep: (n: number) => void;
}) {
  return (
    <div className="ob-demo" role="group" aria-label="Add to Home Screen steps">
      <ol className="ob-home-steps">
        {HOME_STEPS.map((item, i) => (
          <li key={item.title}>
            <button
              type="button"
              className={`ob-home-step${i === step ? " active" : ""}${i < step ? " done" : ""}`}
              aria-current={i === step ? "step" : undefined}
              onClick={() => onStep(i)}
            >
              <span className="ob-home-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <span className="ob-home-step-copy">
                <strong>{item.title}</strong>
                <span className="muted">{item.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {step < HOME_STEPS.length - 1 ? (
        <button
          type="button"
          className="ob-demo-chip"
          onClick={() => onStep(Math.min(HOME_STEPS.length - 1, step + 1))}
        >
          Next tip
        </button>
      ) : (
        <p className="muted ob-demo-note">Your icon opens full screen, like a calm little app.</p>
      )}
    </div>
  );
}

function HomeScreenVisual({ step }: { step: number }) {
  const label = HOME_STEPS[step]?.title ?? "Home Screen";
  return (
    <div className="ob-home-visual">
      <HomeScreenGlyph />
      <p className="ob-day-caption">{label}</p>
    </div>
  );
}

/** Decorative fist↔heart cycle for the built-by slide. */
function FistHeartCycle() {
  const prefersReduced = usePrefersReducedMotion();
  const [heart, setHeart] = useState(false);

  useEffect(() => {
    if (prefersReduced) return;
    const id = window.setInterval(() => setHeart((h) => !h), 2000);
    return () => window.clearInterval(id);
  }, [prefersReduced]);

  if (prefersReduced) {
    return (
      <span className="ob-fist-heart static" aria-hidden="true">
        ✊💖
      </span>
    );
  }

  return (
    <span className="ob-fist-heart" aria-hidden="true">
      <span className={heart ? "" : "active"}>✊</span>
      <span className={heart ? "active" : ""}>💖</span>
    </span>
  );
}

function SymbolShowcase({ identity }: { identity: IdentityConfig }) {
  const prefersReduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(() =>
    Math.max(0, SYMBOLS.findIndex((s) => s.id === identity.symbol)),
  );
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
