import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  deriveKek,
  generateDek,
  newSalt,
  wrapDek,
} from "../lib/crypto";
import { hasReturningFlag } from "../lib/returning";
import { normalizeIdentity } from "../lib/identity";
import { readCachedIdentity } from "../lib/identityCache";
import { AFFIRMATIONS, dailyAffirmation } from "../lib/affirmations";
import { deviceTimezone } from "../lib/timezone";
import { IdentityMark } from "../components/IdentityMark";
import type { UserProfile } from "../App";

function authModeFromParam(raw: string | null): "login" | "register" | null {
  if (raw === "login" || raw === "register") return raw;
  return null;
}

type Props = {
  needsTotp: boolean;
  unlockInfo: {
    user: UserProfile;
    kekSalt: string;
    wrappedDek: string;
    sessionExpiresAt: number;
  } | null;
  onAuthed: (
    user: UserProfile,
    kekSalt: string,
    wrappedDek: string,
    password: string,
    sessionExpiresAt?: number,
  ) => Promise<void>;
  onUnlocked: (password: string) => Promise<void>;
  onLogout: () => void;
  onNeedsTotp: () => void;
  /** Lets the app header follow the visible card (welcome vs tagline). */
  onModeChange?: (mode: "login" | "register") => void;
};

export function AuthPage({
  needsTotp,
  unlockInfo,
  onAuthed,
  onUnlocked,
  onLogout,
  onNeedsTotp,
  onModeChange,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Share CTAs pass ?mode=register so returning devices still land on signup.
  // Otherwise returning devices default to sign-in; a fresh device leads with sign-up.
  const [mode, setMode] = useState<"login" | "register">(
    () =>
      authModeFromParam(searchParams.get("mode")) ??
      (hasReturningFlag() ? "login" : "register"),
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  // Signup is invite-only: the code must pass a server preflight before the
  // account form appears, and it is sent again with register (the real check).
  const [inviteCode, setInviteCode] = useState("");
  const [inviteVerified, setInviteVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  // Bumped on every check and on mode switches so a stale in-flight preflight
  // can never verify an edited/cleared code or splash its error on another card.
  const inviteReqSeq = useRef(0);

  // Keep card + app header aligned with ?mode= on SPA navigations (e.g. share CTA).
  useEffect(() => {
    const fromUrl = authModeFromParam(searchParams.get("mode"));
    if (!fromUrl) return;
    setMode(fromUrl);
    onModeChange?.(fromUrl);
  }, [searchParams, onModeChange]);

  // The privacy modal is informational: focus the dialog on open, close on
  // Escape, and hand focus back to the trigger afterwards.
  useEffect(() => {
    if (!privacyOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusId = window.requestAnimationFrame(() =>
      document
        .getElementById("privacy-modal")
        ?.querySelector<HTMLElement>("button")
        ?.focus({ preventScroll: true }),
    );
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPrivacyOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [privacyOpen]);

  function switchMode(next: "login" | "register") {
    inviteReqSeq.current++;
    setMode(next);
    onModeChange?.(next);
    setError(null);
    setInviteCode("");
    setInviteVerified(false);
    // Keep the URL in sync so the effect above does not fight a manual toggle.
    setSearchParams(
      (prev) => {
        const nextParams = new URLSearchParams(prev);
        nextParams.set("mode", next);
        return nextParams;
      },
      { replace: true },
    );
  }

  async function checkInvite() {
    const code = inviteCode.trim();
    if (busy || !code) return;
    const seq = ++inviteReqSeq.current;
    setBusy(true);
    setError(null);
    try {
      await api<{ valid: boolean }>("/api/auth/invite/check", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      if (inviteReqSeq.current !== seq) return;
      // Freeze exactly what the server approved for the register call.
      setInviteCode(code);
      setInviteVerified(true);
    } catch (e) {
      if (inviteReqSeq.current !== seq) return;
      setError(e instanceof Error ? e.message : "Invite check failed.");
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const salt = newSalt();
      const kek = await deriveKek(password, salt);
      const dek = await generateDek();
      const wrappedDek = await wrapDek(dek, kek);
      const res = await api<{
        user: UserProfile;
        kekSalt: string;
        wrappedDek: string;
        sessionExpiresAt?: string;
      }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          kekSalt: salt,
          wrappedDek,
          inviteCode,
          timezone: deviceTimezone() ?? "UTC",
        }),
      });
      await onAuthed(
        res.user,
        res.kekSalt,
        res.wrappedDek,
        password,
        res.sessionExpiresAt ? Date.parse(res.sessionExpiresAt) : undefined,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Registration failed.";
      // The code can be spent between preflight and register (another signup
      // won it). Send the user back to the invite step instead of stranding
      // them on a form that can never succeed.
      if (message.toLowerCase().includes("invite")) {
        setInviteVerified(false);
        setInviteCode("");
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{
        requiresTotp?: boolean;
        user?: UserProfile;
        kekSalt?: string;
        wrappedDek?: string;
        sessionExpiresAt?: string;
      }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (res.requiresTotp) {
        onNeedsTotp();
        return;
      }
      if (!res.user || !res.kekSalt || !res.wrappedDek) {
        throw new Error("Login response incomplete.");
      }
      await onAuthed(
        res.user,
        res.kekSalt,
        res.wrappedDek,
        password,
        res.sessionExpiresAt ? Date.parse(res.sessionExpiresAt) : undefined,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyTotp() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{
        user: UserProfile;
        kekSalt: string;
        wrappedDek: string;
        sessionExpiresAt?: string;
      }>("/api/auth/totp/verify-login", {
        method: "POST",
        body: JSON.stringify({ code: totpCode }),
      });
      await onAuthed(
        res.user,
        res.kekSalt,
        res.wrappedDek,
        password,
        res.sessionExpiresAt ? Date.parse(res.sessionExpiresAt) : undefined,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "TOTP failed.");
    } finally {
      setBusy(false);
    }
  }

  async function unlockJournal() {
    setBusy(true);
    setError(null);
    try {
      await onUnlocked(password);
    } catch {
      setError("That password could not unlock your journal.");
    } finally {
      setBusy(false);
    }
  }

  if (unlockInfo && !needsTotp) {
    // The person's own mark welcomes them back before anything decrypts:
    // identity is render-only by design, so it is available pre-unlock.
    const identity = normalizeIdentity(unlockInfo.user.identity, unlockInfo.user.id);
    return (
      <div className="panel auth-card">
        <div className="auth-welcome-mark">
          <span className="auth-mark-disc">
            <IdentityMark identity={identity} size={72} beatMs={2400} />
          </span>
        </div>
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>
          Welcome back{unlockInfo.user.displayName ? `, ${unlockInfo.user.displayName}` : ""}
        </h2>
        <p className="muted">
          Your 24-hour session is still active for {unlockInfo.user.email}. Enter your password to
          unlock encrypted journal entries on this device.
        </p>
        <div className="field">
          <label htmlFor="unlock-password">Password</label>
          <input
            id="unlock-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void unlockJournal();
            }}
            autoFocus
          />
        </div>
        {error && <p className="error">{error}</p>}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn accent"
            disabled={busy || !password}
            onClick={() => void unlockJournal()}
          >
            Unlock
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={onLogout}
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // On a returning device, greet the person with their own butterfly before
  // they sign in. Identity is render-only and cached locally, so it needs no key.
  const returningMark =
    !needsTotp && mode === "login" && hasReturningFlag() ? readCachedIdentity() : null;

  return (
    <div className="panel auth-card">
      {returningMark && (
        <>
          <div className="auth-welcome-mark">
            <span className="auth-mark-disc">
              <IdentityMark identity={returningMark} size={64} decorative beatMs={2400} />
            </span>
          </div>
          <RotatingAffirmation />
        </>
      )}
      <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>
        {needsTotp ? "Authenticator" : mode === "login" ? "Sign in" : "Create account"}
      </h2>
      {needsTotp ? (
        <>
          <p className="muted">
            Enter the 6-digit code from your authenticator app, or a recovery code.
          </p>
          <div className="field">
            <label htmlFor="totp">Code</label>
            <input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pw-totp">Password (unlocks your journal key)</label>
            <input
              id="pw-totp"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button type="button" className="btn accent" disabled={busy} onClick={() => void verifyTotp()}>
            Continue
          </button>
        </>
      ) : mode === "register" && !inviteVerified ? (
        <>
          <p className="muted">
            EAJ is invite-only right now. Enter your invite code to create an account. Need
            one? Email{" "}
            <a className="linkish" href="mailto:eaj@97115104.com">
              eaj@97115104.com
            </a>
            .
          </p>
          <div className="field">
            <label htmlFor="invite-code">Invite code</label>
            <input
              id="invite-code"
              autoComplete="off"
              disabled={busy}
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void checkInvite();
              }}
              autoFocus
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button
            type="button"
            className="btn accent"
            disabled={busy || !inviteCode.trim()}
            onClick={() => void checkInvite()}
          >
            Continue
          </button>
          <p className="muted" style={{ marginTop: "1rem" }}>
            Already have an account?{" "}
            <button type="button" className="linkish" onClick={() => switchMode("login")}>
              Sign in
            </button>
          </p>
          <p className="muted auth-privacy-line">
            <button
              type="button"
              className="linkish"
              onClick={() => setPrivacyOpen(true)}
              title="How your journal is protected"
            >
              We value privacy
            </button>
          </p>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) {
                  void (mode === "login" ? login() : register());
                }
              }}
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button
            type="button"
            className="btn accent"
            disabled={busy}
            onClick={() => void (mode === "login" ? login() : register())}
          >
            {mode === "login" ? "Sign in" : "Create account"}
          </button>
          <p className="muted" style={{ marginTop: "1rem" }}>
            {mode === "login" ? (
              <>
                New here?{" "}
                <button type="button" className="linkish" onClick={() => switchMode("register")}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button type="button" className="linkish" onClick={() => switchMode("login")}>
                  Sign in
                </button>
              </>
            )}
          </p>
          <p className="muted auth-privacy-line">
            <button
              type="button"
              className="linkish"
              onClick={() => setPrivacyOpen(true)}
              title="How your journal is protected"
            >
              We value privacy
            </button>
          </p>
        </>
      )}
      {privacyOpen && (
        <div className="insight-scrim" role="presentation" onClick={() => setPrivacyOpen(false)}>
          <div
            id="privacy-modal"
            className="panel insight-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="privacy-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              We value privacy
            </h2>
            <p className="muted">
              Journal labels and notes are encrypted on your device before they reach the server.
              The server stores ciphertext and cannot read those fields without your
              password-derived key.
            </p>
            <button type="button" className="btn secondary" onClick={() => setPrivacyOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The sign-in card's aphorism line. It opens on the day's deterministic pick,
 * then wanders onward through the pool while the card is visible, fading each
 * line in. The key remount replays the fade; reduced motion swaps plainly.
 */
function RotatingAffirmation() {
  const [index, setIndex] = useState(() =>
    Math.max(0, AFFIRMATIONS.indexOf(dailyAffirmation())),
  );

  useEffect(() => {
    const id = window.setInterval(
      () => setIndex((i) => (i + 1) % AFFIRMATIONS.length),
      9000,
    );
    return () => window.clearInterval(id);
  }, []);

  return (
    <p className="auth-affirmation" key={index}>
      {AFFIRMATIONS[index]}
    </p>
  );
}
