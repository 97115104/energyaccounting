import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { UserProfile } from "../App";
import { api } from "../lib/api";

const STEPS = [
  {
    title: "What EAJ is for",
    body: "EAJ is an open-source energy accounting journal built for neurodivergent productivity. You track deposits that refill you and withdrawals that cost you, then carry the balance into tomorrow.",
  },
  {
    title: "Plan, audit, close",
    body: "Morning plan adds the day’s deposits and withdrawals. Evening audit records how the day actually felt. Close day locks the sheet and carries the closing balance forward.",
  },
  {
    title: "Complete and free capacity",
    body: "Checking a task means you did it. Incomplete tasks reserve points from your opening balance. Completing a task frees that reservation so you can allocate energy to something new or leave it banked.",
  },
  {
    title: "Tips, play, and weather",
    body: "When withdrawals dominate, EAJ suggests play-category deposits to rebalance. The tips button offers short guidance from your day state. Weather and day or night theming follow your location and local time.",
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

  const last = step >= STEPS.length - 1;
  const current = STEPS[step]!;
  const showLocation = last;

  return (
    <div className="panel auth-card" style={{ maxWidth: 520 }}>
      <p className="muted" style={{ marginTop: 0 }}>
        {replay ? "Overview again" : "Welcome"} · step {step + 1} of {STEPS.length}
      </p>
      <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>{current.title}</h2>
      <p>{current.body}</p>
      {showLocation && (
        <div>
          <p className="muted">
            Optional coordinates power the weather chip. The browser may already have asked once.
            You can also set them later in Settings.
          </p>
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
          <p className="muted">
            Prefer the full profile form?{" "}
            <Link to="/settings">Open settings</Link>
          </p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {step > 0 && (
          <button type="button" className="btn secondary" onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
        )}
        {!last ? (
          <button type="button" className="btn accent" onClick={() => setStep((s) => s + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className="btn accent" onClick={() => void finish()}>
            {replay ? "Done" : "Start using EAJ"}
          </button>
        )}
        {replay && (
          <button type="button" className="btn secondary" onClick={() => navigate("/settings")}>
            Back to settings
          </button>
        )}
      </div>
    </div>
  );
}
