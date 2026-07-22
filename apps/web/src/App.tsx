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
import { greetingDetailFor, randomFact, type GreetingStyle } from "./lib/greeting";
import { normalizeIdentity } from "./lib/identity";
import { hasReturningFlag, markReturning } from "./lib/returning";
import { liveTimezone } from "./lib/timezone";
import { SKY_CSS_VARS, skyPalette } from "./lib/skyPalette";
import { cacheIdentity, forgetCachedIdentity, readCachedName } from "./lib/identityCache";
import { FactLinkedText } from "./components/FactLinkedText";
import { NeuroMe } from "./components/IdentityMark";
import { ButterflyStateButton } from "./components/ButterflyStateButton";
import { ButterflyStateModal } from "./components/ButterflyStateModal";
import { useButterflyDay, usePrefersReducedMotion } from "./lib/useButterflyDay";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SharePage } from "./pages/SharePage";
import { TodayPage } from "./pages/TodayPage";
import { YouPage } from "./pages/YouPage";

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
  /** Default true. When false, Energy Guide prefers seated/social/creative suggestions. */
  includePhysicalActivities?: boolean;
  onboardingCompleted?: boolean;
  locationPrompted?: boolean;
  /** Raw NeuroMe identity config from the server; normalize before rendering. */
  identity?: unknown;
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
  // Mirrors AuthPage's card (sign in vs create account) so the header greeting
  // and tagline can follow along. Honor ?mode= from share CTAs.
  const [authMode, setAuthMode] = useState<"login" | "register">(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("mode");
    if (fromUrl === "login" || fromUrl === "register") return fromUrl;
    return hasReturningFlag() ? "login" : "register";
  });
  // One fun fact per visit under the signed-out welcome, stable across renders.
  const [welcomeFact] = useState(() => randomFact());
  const [stateExplainOpen, setStateExplainOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  const butterflyState = useButterflyDay(!!user && dekReady && !needsTotp);

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

  // Sky + panel chrome track the real sun continuously; night theme still
  // flips via data-theme when skyPeriod says night (20:00 floor / post-dusk).
  useEffect(() => {
    const tz = liveTimezone(user?.timezone);
    const root = document.documentElement;
    const clearSkyVars = () => {
      for (const key of SKY_CSS_VARS) root.style.removeProperty(key);
    };
    const apply = () => {
      const palette = skyPalette(user?.lat, user?.lon, tz);
      const theme = palette.period === "night" ? "night" : "day";
      root.dataset.theme = theme;
      if (theme === "night") {
        clearSkyVars();
      } else {
        root.style.setProperty("--bg0", palette.bg0);
        root.style.setProperty("--bg1", palette.bg1);
        root.style.setProperty("--sky-glow", palette.skyGlow);
        root.style.setProperty("--sun-face", palette.sunFace);
        root.style.setProperty("--sun-halo", palette.sunHalo);
        root.style.setProperty("--panel", palette.panel);
        root.style.setProperty("--surface", palette.surface);
        root.style.setProperty("--ink", palette.ink);
        root.style.setProperty("--muted", palette.muted);
        root.style.setProperty("--line", palette.line);
        root.style.setProperty("--accent", palette.accent);
      }
      const favicon = document.getElementById("favicon") as HTMLLinkElement | null;
      if (favicon) {
        favicon.href = theme === "night" ? "/favicon-moon.svg" : "/favicon-sun.svg";
      }
      // Keep browser chrome (and iOS overscroll area) on the theme's sky color.
      const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (themeColor) {
        const bg0 = getComputedStyle(root).getPropertyValue("--bg0").trim();
        if (bg0) themeColor.content = bg0;
      }
    };
    apply();
    // Align to the next clock minute so sunrise/sunset edges don't lag a full minute.
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let intervalId = 0;
    const timeoutId = window.setTimeout(() => {
      apply();
      intervalId = window.setInterval(apply, 60_000);
    }, msToNextMinute);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
      clearSkyVars();
    };
  }, [user?.timezone, user?.lat, user?.lon]);

  // Keep the last identity and display name cached so the sign-in screen can
  // greet the person before any session or key exists. Both are render-only.
  useEffect(() => {
    if (user) cacheIdentity(normalizeIdentity(user.identity, user.id), user.displayName);
  }, [user]);

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
      // The cached mark and name survive logout on purpose so the sign-back-in
      // screen can greet the person. Account deletion clears them below.
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
        <p className="muted">Opening your day…</p>
      </div>
    );
  }

  const authed = !!user && dekReady && !needsTotp;
  const needsOnboarding = authed && user && !user.onboardingCompleted;
  const onOnboardingRoute = loc.pathname.startsWith("/onboarding");
  const greeting = user
    ? greetingDetailFor(user.displayName, {
        // Live timezone (device first): a UTC-defaulted profile must not turn
        // a local afternoon into an "Evening check-in".
        timeZone: liveTimezone(user.timezone),
        style: user.greetingStyle,
      })
    : null;
  const identity = user ? normalizeIdentity(user.identity, user.id) : null;
  // Name for the signed-out welcome: the live session's user when unlocking,
  // else the locally cached name from the last sign-in on this device.
  const welcomeName = unlockInfo?.user.displayName ?? readCachedName();

  return (
    <div className={`app-shell${authed ? "" : " app-shell-auth"}`}>
      <div className="sky-layer" aria-hidden="true">
        <div className="sky-clouds" />
        <div className="sky-precip" />
      </div>
      {/* Onboarding slides get the full viewport: no greeting header or nav. */}
      {!(authed && onOnboardingRoute) && (
      <header className={`top-bar${authed ? "" : " top-bar-centered"}`}>
        <div className="top-bar-brand">
          {authed ? (
            <>
              <div className="greeting-row">
                {/* Wordmark spans the full header row, sitting over the seal. */}
                <p className="wordmark">
                  Your <span className="wordmark-energy">Energy</span> Matters
                </p>
                <div className="greeting-seal-col">
                  {identity && (
                    <Link
                      to="/you"
                      className="greeting-seal"
                      title={`Today: ${butterflyState.label}`}
                      aria-label={`Your butterfly, today: ${butterflyState.label}. Open You.`}
                    >
                      <NeuroMe
                        identity={identity}
                        state={butterflyState}
                        size={65}
                        decorative
                      />
                    </Link>
                  )}
                  <ButterflyStateButton
                    state={butterflyState}
                    expanded={stateExplainOpen}
                    onOpen={() => setStateExplainOpen(true)}
                  />
                </div>
                <div className="greeting-quote">
                  <div className="greeting-quote-card">
                    <h1
                      className="brand greeting"
                      key={`${user?.displayName ?? ""}-${user?.greetingStyle ?? "mix"}`}
                    >
                      {greeting?.factLinks ? (
                        <FactLinkedText text={greeting.text} links={greeting.factLinks} />
                      ) : (
                        greeting?.text
                      )}
                    </h1>
                  </div>
                </div>
              </div>
            </>
          ) : authMode === "register" ? (
            <>
              <h1 className="wordmark wordmark-auth">
                Your <span className="wordmark-energy">Energy</span> Matters!
              </h1>
              <p className="tagline welcome-fact">
                EAJ is for neurodivergent productivity and pride and energy tracking.
              </p>
            </>
          ) : (
            <>
              <h1 className="brand brand-welcome">
                <TypedText
                  text={welcomeName ? `Welcome back, ${welcomeName}!` : "Welcome back!"}
                />
              </h1>
              <p className="welcome-fact">
                Did you know…{" "}
                <FactLinkedText text={welcomeFact.text} links={welcomeFact.links} />
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
      )}
      {authed && !needsOnboarding && !onOnboardingRoute && (
        <nav className="nav">
          <Link className={loc.pathname === "/" ? "active" : ""} to="/">
            Today
          </Link>
          <Link className={loc.pathname.startsWith("/dashboard") ? "active" : ""} to="/dashboard">
            Dashboard
          </Link>
          <Link className={loc.pathname.startsWith("/you") ? "active" : ""} to="/you">
            You
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
                onModeChange={setAuthMode}
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
          path="/you"
          element={
            !authed ? (
              <Navigate to="/auth" replace />
            ) : needsOnboarding ? (
              <Navigate to="/onboarding" replace />
            ) : (
              <YouPage user={user!} onUser={setUser} butterflyState={butterflyState} />
            )
          }
        />
        <Route
          path="/settings"
          element={
            !authed ? (
              <Navigate to="/auth" replace />
            ) : (
              <SettingsPage
                user={user!}
                onUser={setUser}
                onDeleted={() => {
                  // The profile is gone, so no trace of it should greet the
                  // next person on this device.
                  forgetCachedIdentity();
                  void logout();
                }}
              />
            )
          }
        />
        {/* Public: anyone with a live share link can view the snapshot. */}
        <Route path="/share/:token" element={<SharePage signedIn={authed} />} />
        <Route path="*" element={<Navigate to={authed ? "/" : "/auth"} replace />} />
      </Routes>
      <footer className="site-footer">
        <p>
          <a
            href="https://github.com/97115104/energyaccounting"
            target="_blank"
            rel="noreferrer"
          >
            free &amp; open source
          </a>
          <span className="site-footer-sep" aria-hidden="true">
            |
          </span>
          <a href="https://attest.97115104.com/s/zn6mxj9z" target="_blank" rel="noreferrer">
            attested
          </a>{" "}
          · collab · cursor (auto)
          <span className="site-footer-sep" aria-hidden="true">
            |
          </span>
          built for the neurodivergent community
        </p>
      </footer>
      {authed && stateExplainOpen && (
        <ButterflyStateModal
          state={butterflyState}
          onClose={() => setStateExplainOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Types text out character by character for the signed-out headings. The
 * animated copy is aria-hidden with the full text alongside for screen
 * readers, and reduced motion renders everything at once.
 */
function TypedText({ text }: { text: string }) {
  const prefersReduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (prefersReduced) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const id = window.setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          window.clearInterval(id);
          return n;
        }
        return n + 1;
      });
    }, 45);
    return () => window.clearInterval(id);
  }, [text, prefersReduced]);

  const done = shown >= text.length;
  return (
    <span className="typed-text">
      <span aria-hidden="true">
        {text.slice(0, shown)}
        {!done && <span className="typed-caret" />}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
