import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import {
  deriveKek,
  getSessionDek,
  setSessionDek,
  unwrapDek,
} from "./lib/crypto";
import { isNightInTimezone } from "./lib/weatherUi";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodayPage } from "./pages/TodayPage";

export type UserProfile = {
  id: string;
  email: string;
  totpEnabled: boolean;
  timezone?: string;
  lat?: number | null;
  lon?: number | null;
  country?: string | null;
  onboardingCompleted?: boolean;
  locationPrompted?: boolean;
};

type MeResponse =
  | { requiresTotp: true }
  | {
      requiresTotp?: false;
      user: UserProfile;
      kekSalt: string;
      wrappedDek: string;
    };

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm9.4 3.1-1.1-.6.2-1.3 1.2-1.9-1.8-1.8-1.9 1.2-1.3.2-.6-1.1.1-1.3H12.7l-.1 1.3-.6 1.1-1.3-.2-1.9-1.2-1.8 1.8 1.2 1.9-.2 1.3-1.1.6-1.3-.1v2.6l1.3-.1 1.1.6.2 1.3-1.2 1.9 1.8 1.8 1.9-1.2 1.3-.2.6 1.1-.1 1.3h2.6l.1-1.3.6-1.1 1.3.2 1.9 1.2 1.8-1.8-1.2-1.9.2-1.3 1.1-.6 1.3.1v-2.6l-1.3.1Z"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M10 4v2H6v12h4v2H4V4h6Zm3.6 4.4 1.4-1.4L21 12l-5.999 5.999-1.4-1.4L17.2 13H9v-2h8.2l-3.6-2.6Z"
      />
    </svg>
  );
}

export function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [booting, setBooting] = useState(true);
  const [dekReady, setDekReady] = useState(!!getSessionDek());
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const me = await api<MeResponse>("/api/auth/me");
        if ("requiresTotp" in me && me.requiresTotp) {
          setNeedsTotp(true);
          setUser(null);
        } else if ("user" in me) {
          if (getSessionDek()) {
            setUser(me.user);
            setNeedsTotp(false);
            setDekReady(true);
          } else {
            setUser(null);
            setDekReady(false);
          }
        }
      } catch {
        setUser(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Day / night theme from user timezone.
  useEffect(() => {
    const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const apply = () => {
      document.documentElement.dataset.theme = isNightInTimezone(tz) ? "night" : "day";
    };
    apply();
    const id = window.setInterval(apply, 60_000);
    return () => window.clearInterval(id);
  }, [user?.timezone]);

  // Ask for location once after unlock when profile has no coords.
  useEffect(() => {
    if (!user || !dekReady) return;
    if (user.locationPrompted) return;
    if (user.lat != null && user.lon != null) {
      void api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ locationPrompted: true }),
      })
        .then(() => setUser((u) => (u ? { ...u, locationPrompted: true } : u)))
        .catch(() => undefined);
      return;
    }
    if (!navigator.geolocation) {
      void api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ locationPrompted: true }),
      })
        .then(() => setUser((u) => (u ? { ...u, locationPrompted: true } : u)))
        .catch(() => undefined);
      return;
    }
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        void api("/api/auth/profile", {
          method: "PATCH",
          body: JSON.stringify({ lat, lon, locationPrompted: true }),
        })
          .then(() =>
            setUser((u) => (u ? { ...u, lat, lon, locationPrompted: true } : u)),
          )
          .catch(() => undefined);
      },
      () => {
        if (cancelled) return;
        void api("/api/auth/profile", {
          method: "PATCH",
          body: JSON.stringify({ locationPrompted: true }),
        })
          .then(() => setUser((u) => (u ? { ...u, locationPrompted: true } : u)))
          .catch(() => undefined);
      },
      { maximumAge: 86_400_000, timeout: 12_000 },
    );
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.locationPrompted, user?.lat, user?.lon, dekReady]);

  async function unlockWithPassword(password: string, kekSalt: string, wrappedDek: string) {
    const kek = await deriveKek(password, kekSalt);
    const dek = await unwrapDek(wrappedDek, kek);
    setSessionDek(dek);
    setDekReady(true);
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setSessionDek(null);
    setUser(null);
    setDekReady(false);
    setNeedsTotp(false);
    navigate("/auth");
  }

  if (booting) {
    return (
      <div className="app-shell">
        <p className="muted">Loading EAJ…</p>
      </div>
    );
  }

  const authed = !!user && dekReady && !needsTotp;
  const needsOnboarding = authed && user && !user.onboardingCompleted;
  const onOnboardingRoute = loc.pathname.startsWith("/onboarding");

  return (
    <div className="app-shell">
      <div className="sky-layer" aria-hidden="true" />
      <header className="top-bar">
        <div className="top-bar-brand">
          <h1 className="brand">EAJ</h1>
          <p className="tagline">
            Energy Accounting Journal for neurodivergent productivity. Plan deposits and
            withdrawals, audit the day, and carry the balance forward.
          </p>
        </div>
        {authed && (
          <div className="top-bar-actions">
            <Link
              to="/settings"
              className="icon-btn"
              aria-label="Settings"
              title="Settings"
            >
              <GearIcon />
            </Link>
            <button
              type="button"
              className="icon-btn"
              aria-label="Log out"
              title="Log out"
              onClick={() => void logout()}
            >
              <LogoutIcon />
            </button>
          </div>
        )}
      </header>
      {authed && !needsOnboarding && (
        <nav className="nav">
          <Link className={loc.pathname === "/" ? "active" : ""} to="/">
            Today
          </Link>
          <Link className={loc.pathname.startsWith("/dashboard") ? "active" : ""} to="/dashboard">
            Dashboard
          </Link>
        </nav>
      )}
      <Routes>
        <Route
          path="/auth"
          element={
            authed ? (
              <Navigate to={needsOnboarding ? "/onboarding" : "/"} replace />
            ) : (
              <AuthPage
                needsTotp={needsTotp}
                onAuthed={async (u, salt, wrapped, password) => {
                  setUser(u);
                  setNeedsTotp(false);
                  await unlockWithPassword(password, salt, wrapped);
                }}
                onNeedsTotp={() => setNeedsTotp(true)}
              />
            )
          }
        />
        <Route
          path="/onboarding"
          element={
            authed ? (
              <OnboardingPage user={user!} onUser={setUser} />
            ) : (
              <Navigate to="/auth" replace />
            )
          }
        />
        <Route
          path="/"
          element={
            !authed ? (
              <Navigate to="/auth" replace />
            ) : needsOnboarding && !onOnboardingRoute ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <TodayPage user={user!} />
            )
          }
        />
        <Route
          path="/dashboard"
          element={
            !authed ? (
              <Navigate to="/auth" replace />
            ) : needsOnboarding ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <DashboardPage />
            )
          }
        />
        <Route
          path="/settings"
          element={
            !authed ? (
              <Navigate to="/auth" replace />
            ) : (
              <SettingsPage user={user!} onUser={setUser} />
            )
          }
        />
        <Route path="*" element={<Navigate to={authed ? "/" : "/auth"} replace />} />
      </Routes>
      <footer className="site-footer">
        <p>
          Attested · collab · Cursor · auto ·{" "}
          <a href="https://attest.97115104.com/s/zn6mxj9z">verify</a>
        </p>
      </footer>
    </div>
  );
}
