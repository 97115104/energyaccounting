import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { UserProfile } from "../App";
import { api } from "../lib/api";

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

const STEPS: { glyph: ReactNode; title: string; body: string }[] = [
  {
    glyph: <SunGlyph />,
    title: "Your energy matters",
    body: "An energy accounting journal built for neurodivergent brains. Deposits refill you, withdrawals cost you, and the balance carries into tomorrow — like money, but you can't borrow from a bank.",
  },
  {
    glyph: <LedgerGlyph />,
    title: "Plan, audit, close",
    body: "In the morning, plan the day's deposits and withdrawals. In the evening, audit how it actually felt. Then close the day to lock the sheet and carry the balance forward.",
  },
  {
    glyph: <CheckGlyph />,
    title: "Done frees energy",
    body: "Unfinished tasks reserve points from your balance. Check one off and those points come back — spend them on something new, or bank them. Both count as winning.",
  },
  {
    glyph: <PinGlyph />,
    title: "Skies included",
    body: "Set a location and the background follows your real weather and sunset, tips consider the UV index, and the app quietly nudges you outside when it's nice out.",
  },
];

type Props = {
  user: UserProfile;
  onUser: (u: UserProfile) => void;
};

export function OnboardingPage({ user, onUser }: Props) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lat, setLat] = useState(String(user.lat ?? ""));
  const [lon, setLon] = useState(String(user.lon ?? ""));
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const replay = params.get("replay") === "1";

  const last = step >= STEPS.length - 1;
  const current = STEPS[step]!;

  // Arrow keys page through the slides, Apple-keynote style.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowRight" && !last) setStep((s) => s + 1);
      if (e.key === "ArrowLeft" && step > 0) setStep((s) => s - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, last]);

  async function finish() {
    setError(null);
    try {
      const nextLat = lat === "" ? null : Number(lat);
      const nextLon = lon === "" ? null : Number(lon);
      await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          lat: nextLat,
          lon: nextLon,
          locationPrompted: true,
          onboardingCompleted: true,
        }),
      });
      onUser({
        ...user,
        lat: nextLat,
        lon: nextLon,
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
      {/* key remounts the slide so the enter animation replays each step */}
      <div className="ob-slide" key={step}>
        {current.glyph}
        <h2 className="ob-title">{current.title}</h2>
        <p className="ob-body">{current.body}</p>
        {last && (
          <div className="ob-location">
            <p className="muted">
              Optional. Coordinates power live weather, the reactive sky, and UV-aware tips. You can
              also set them anytime in <Link to="/settings">Settings</Link>.
            </p>
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
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="ob-dots" role="group" aria-label="Onboarding progress">
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            aria-current={i === step ? "step" : undefined}
            aria-label={`Step ${i + 1} of ${STEPS.length}`}
            className={`ob-dot${i === step ? " active" : ""}`}
            onClick={() => setStep(i)}
          />
        ))}
      </div>

      <div className="ob-actions">
        {!last ? (
          <button type="button" className="btn accent ob-continue" onClick={() => setStep((s) => s + 1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn accent ob-continue" onClick={() => void finish()}>
            {replay ? "Done" : "Start journaling"}
          </button>
        )}
        <div className="ob-quiet-actions">
          {step > 0 && (
            <button type="button" className="linkish" onClick={() => setStep((s) => s - 1)}>
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
  );
}
