import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import {
  deriveKek,
  forgetAllRememberedSessionDeks,
  forgetRememberedSessionDek,
  getSessionDek,
  rememberSessionDek,
  restoreRememberedSessionDek,
  setSessionDek,
  unwrapDek,
} from "./lib/crypto";
import { greetingDetailFor, type GreetingStyle } from "./lib/greeting";
import { hasReturningFlag, markReturning } from "./lib/returning";
import { skyPeriod } from "./lib/weatherUi";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodayPage } from "./pages/TodayPage";

export type UserProfile = {
  id: string;
  email: string;
  totpEnabled: boolean;
  displayName?: string | null;
  timezone?: string;
  lat?: number | null;
  lon?: number | null;
  country?: string | null;
  temperatureUnit?: "C" | "F" | null;
  greetingStyle?: GreetingStyle | null;
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
      sessionExpiresAt: string;
    };

type UnlockInfo = {
  user: UserProfile;
  kekSalt: string;
  wrappedDek: string;
  sessionExpiresAt: number;
};

function GearIcon() {
  // Classic cog: ring with eight teeth and a hollow center.
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 7.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.61 3.61 0 0 1 8.4 12c0-1.98 1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
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
  const [unlockInfo, setUnlockInfo] = useState<UnlockInfo | null>(null);
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
          const sessionExpiresAt = Date.parse(me.sessionExpiresAt);
          const dek =
            getSessionDek() ??
            (await restoreRememberedSessionDek(me.user.id));
          if (dek) {
            // Keep stored DEK capped to the live cookie lifetime on every boot.
            if (Number.isFinite(sessionExpiresAt)) {
              await rememberSessionDek(dek, me.user.id, Date.now(), sessionExpiresAt);
            }
            setUser(me.user);
            setNeedsTotp(false);
            setDekReady(true);
            setUnlockInfo(null);
          } else {
            setUser(null);
            setDekReady(false);
            setUnlockInfo({
              user: me.user,
              kekSalt: me.kekSalt,
              wrappedDek: me.wrappedDek,
              sessionExpiresAt: Number.isFinite(sessionExpiresAt)
                ? sessionExpiresAt
                : Date.now() + 24 * 60 * 60 * 1000,
            });
          }
        }
      } catch {
        forgetAllRememberedSessionDeks();
        setSessionDek(null);
        setUser(null);
        setUnlockInfo(null);
        setDekReady(false);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // Sky theme follows the real sun when we know where the user is:
  // dawn/dusk golden hours around sunrise/sunset, otherwise day or night.
  useEffect(() => {
    const tz = user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const apply = () => {
      const period = skyPeriod(user?.lat, user?.lon, tz);
      document.documentElement.dataset.theme = period;
      const favicon = document.getElementById("favicon") as HTMLLinkElement | null;
      if (favicon) {
        favicon.href = period === "night" ? "/favicon-moon.svg" : "/favicon-sun.svg";
      }
    };
    apply();
    const id = window.setInterval(apply, 60_000);
    return () => window.clearInterval(id);
  }, [user?.timezone, user?.lat, user?.lon]);

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

  async function unlockWithPassword(
    password: string,
    kekSalt: string,
    wrappedDek: string,
    userId: string,
    sessionExpiresAt?: number,
  ) {
    const kek = await deriveKek(password, kekSalt);
    const dek = await unwrapDek(wrappedDek, kek);
    setSessionDek(dek);
    await rememberSessionDek(dek, userId, Date.now(), sessionExpiresAt);
    setDekReady(true);
  }

  async function logout() {
    const userId = user?.id ?? unlockInfo?.user.id;
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      // Local lock still takes precedence when the revoke request cannot reach the server.
    } finally {
      // A failed network revoke must not leave decrypted data open locally.
      if (userId) forgetRememberedSessionDek(userId);
      else forgetAllRememberedSessionDeks();
      setSessionDek(null);
      setUser(null);
      setUnlockInfo(null);
      setDekReady(false);
      setNeedsTotp(false);
      navigate("/auth");
    }
  }

  if (booting) {
    return (
      <div className="app-shell">
        <p className="muted">Opening the ledger…</p>
      </div>
    );
  }

  const authed = !!user && dekReady && !needsTotp;
  const needsOnboarding = authed && user && !user.onboardingCompleted;
  const onOnboardingRoute = loc.pathname.startsWith("/onboarding");
  const greeting = user
    ? greetingDetailFor(user.displayName, {
        timeZone: user.timezone,
        style: user.greetingStyle,
      })
    : null;

  return (
    <div className="app-shell">
      <div className="sky-layer" aria-hidden="true">
        <div className="sky-clouds" />
        <div className="sky-precip" />
      </div>
      <header className={`top-bar${authed ? "" : " top-bar-centered"}`}>
        <div className="top-bar-brand">
          {authed ? (
            <>
              <p className="wordmark">Your Energy Matters</p>
              <h1
                className="brand greeting"
                key={`${user?.displayName ?? ""}-${user?.greetingStyle ?? "mix"}`}
              >
                {greeting?.text}
              </h1>
              {greeting?.factSource && (
                <a
                  className="greeting-source"
                  href={greeting.factSource.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Source: {greeting.factSource.label}
                  <span aria-hidden="true"> ↗</span>
                </a>
              )}
            </>
          ) : hasReturningFlag() ? (
            <>
              <h1 className="brand">Welcome back</h1>
              <p className="tagline">
                Energy Accounting Journal for neurodivergent productivity.
              </p>
            </>
          ) : (
            <>
              <h1 className="brand">Your Energy Matters</h1>
              <p className="tagline">
                Energy Accounting Journal for neurodivergent productivity. Plan deposits and
                withdrawals, audit the day, and carry the balance forward.
              </p>
            </>
          )}
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
                unlockInfo={unlockInfo}
                onLogout={() => void logout()}
                onAuthed={async (u, salt, wrapped, password, sessionExpiresAt) => {
                  setUser(u);
                  setNeedsTotp(false);
                  setUnlockInfo(null);
                  await unlockWithPassword(
                    password,
                    salt,
                    wrapped,
                    u.id,
                    sessionExpiresAt,
                  );
                  markReturning();
                }}
                onUnlocked={async (password) => {
                  if (!unlockInfo) return;
                  await unlockWithPassword(
                    password,
                    unlockInfo.kekSalt,
                    unlockInfo.wrappedDek,
                    unlockInfo.user.id,
                    unlockInfo.sessionExpiresAt,
                  );
                  setUser(unlockInfo.user);
                  setUnlockInfo(null);
                  markReturning();
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
              <DashboardPage user={user!} />
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
          <a href="https://attest.97115104.com/s/zn6mxj9z" target="_blank" rel="noreferrer">
            attested
          </a>{" "}
          · collab · cursor (auto)
        </p>
      </footer>
    </div>
  );
}
