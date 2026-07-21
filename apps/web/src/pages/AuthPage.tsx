import { useState } from "react";
import { api } from "../lib/api";
import {
  deriveKek,
  generateDek,
  newSalt,
  wrapDek,
} from "../lib/crypto";
import { hasReturningFlag } from "../lib/returning";
import type { UserProfile } from "../App";

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
};

export function AuthPage({
  needsTotp,
  unlockInfo,
  onAuthed,
  onUnlocked,
  onLogout,
  onNeedsTotp,
}: Props) {
  // Returning devices default to sign-in; a fresh device leads with sign-up.
  const [mode, setMode] = useState<"login" | "register">(
    hasReturningFlag() ? "login" : "register",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      setError(e instanceof Error ? e.message : "Registration failed.");
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
    return (
      <div className="panel auth-card">
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Unlock journal</h2>
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

  return (
    <div className="panel auth-card">
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
                <button type="button" className="linkish" onClick={() => setMode("register")}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button type="button" className="linkish" onClick={() => setMode("login")}>
                  Sign in
                </button>
              </>
            )}
          </p>
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Journal labels and notes are encrypted on your device before they reach the server. The
            server stores ciphertext and cannot read those fields without your password-derived key.
          </p>
        </>
      )}
    </div>
  );
}
