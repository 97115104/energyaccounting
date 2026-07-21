import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { UserProfile } from "../App";
import { DictatableField } from "../components/DictatableField";
import { api } from "../lib/api";
import { downloadTrainingCorpus } from "../lib/exportCorpus";
import { GREETING_STYLES, type GreetingStyle } from "../lib/greeting";
import { deviceTimezone } from "../lib/timezone";
import { defaultTemperatureUnit } from "../lib/weatherUi";

type Props = {
  user: UserProfile;
  onUser: (u: UserProfile) => void;
  /** Called after the account is deleted so App can clear keys and session. */
  onDeleted: () => void;
};

export function SettingsPage({ user, onUser, onDeleted }: Props) {
  const [displayName, setDisplayName] = useState(user.displayName ?? "");
  const [lat, setLat] = useState(String(user.lat ?? ""));
  const [lon, setLon] = useState(String(user.lon ?? ""));
  const [country, setCountry] = useState(user.country ?? "US");
  // Defaults to the region-appropriate unit until the user picks one explicitly.
  const [tempUnit, setTempUnit] = useState<"C" | "F">(
    user.temperatureUnit ?? defaultTemperatureUnit(user.country),
  );
  const [timezone, setTimezone] = useState(
    user.timezone || deviceTimezone() || "UTC",
  );
  const [greetingStyle, setGreetingStyle] = useState<GreetingStyle>(
    user.greetingStyle ?? "mix",
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disablePw, setDisablePw] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteCode, setDeleteCode] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletingRef = useRef(false);

  useEffect(() => {
    deletingRef.current = deleting;
  }, [deleting]);

  // Keep keyboard focus inside the destructive confirmation (same contract as Today).
  useEffect(() => {
    if (!deleteOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.getElementById("delete-profile-modal");
    const focusables = () =>
      modal
        ? Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((element) => !element.hasAttribute("disabled"))
        : [];
    const focusId = window.requestAnimationFrame(() => focusables()[0]?.focus());
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deletingRef.current) {
        setDeleteOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [deleteOpen]);

  async function saveProfile() {
    setError(null);
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          lat: lat === "" ? null : Number(lat),
          lon: lon === "" ? null : Number(lon),
          country,
          temperatureUnit: tempUnit,
          greetingStyle,
          timezone,
        }),
      });
      onUser({
        ...user,
        displayName: displayName.trim() || null,
        lat: lat === "" ? null : Number(lat),
        lon: lon === "" ? null : Number(lon),
        country,
        temperatureUnit: tempUnit,
        greetingStyle,
        timezone,
      });
      setMsg("Profile saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  async function beginTotp() {
    setError(null);
    try {
      const res = await api<{ secret: string; qr: string }>("/api/auth/totp/setup", {
        method: "POST",
      });
      setTotpSetup(res);
      setRecovery(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "TOTP setup failed");
    }
  }

  async function enableTotp() {
    setError(null);
    try {
      const res = await api<{ recoveryCodes: string[] }>("/api/auth/totp/enable", {
        method: "POST",
        body: JSON.stringify({ code: totpCode }),
      });
      setRecovery(res.recoveryCodes);
      setTotpSetup(null);
      onUser({ ...user, totpEnabled: true });
      setMsg("Authenticator enabled. Store recovery codes somewhere safe.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enable failed");
    }
  }

  async function disableTotp() {
    setError(null);
    try {
      await api("/api/auth/totp/disable", {
        method: "POST",
        body: JSON.stringify({ password: disablePw, code: disableCode }),
      });
      onUser({ ...user, totpEnabled: false });
      setMsg("Authenticator disabled.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disable failed");
    }
  }

  async function exportCorpus() {
    setError(null);
    setExporting(true);
    try {
      await downloadTrainingCorpus();
      setMsg("Corpus download started.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    setDeleteError(null);
    setDeleting(true);
    try {
      await api("/api/auth/delete-account", {
        method: "POST",
        body: JSON.stringify({
          password: deletePw,
          confirm: deleteConfirm.trim(),
          ...(user.totpEnabled ? { code: deleteCode } : {}),
        }),
      });
      // Server data is gone; onDeleted clears local keys and returns to /auth.
      onDeleted();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Deletion failed");
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="panel">
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Profile</h2>
        <DictatableField
          label="Name or alias (greetings)"
          value={displayName}
          maxLength={80}
          autoComplete="nickname"
          onChange={setDisplayName}
          dictateLabel="your name"
        />
        <div className="field">
          <label htmlFor="tz">Timezone</label>
          <input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="lat">Latitude (weather)</label>
          <input id="lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="lon">Longitude (weather)</label>
          <input id="lon" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="country">Country (holidays)</label>
          <select id="country" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="US">United States</option>
            <option value="OTHER">Other (New Year / Christmas only)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="temp-unit">Temperature unit</label>
          <select
            id="temp-unit"
            value={tempUnit}
            onChange={(e) => setTempUnit(e.target.value as "C" | "F")}
          >
            <option value="C">Celsius (°C)</option>
            <option value="F">Fahrenheit (°F)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="greeting-style">Greeting style</label>
          <select
            id="greeting-style"
            value={greetingStyle}
            onChange={(e) => setGreetingStyle(e.target.value as GreetingStyle)}
          >
            {GREETING_STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="muted" style={{ marginTop: "0.35rem" }}>
            {GREETING_STYLES.find((s) => s.value === greetingStyle)?.example}
          </p>
        </div>
        <button type="button" className="btn accent" onClick={() => void saveProfile()}>
          Save profile
        </button>
      </div>

      <div className="panel" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Two-factor authentication</h2>
        <p className="muted">
          Optional TOTP with any authenticator app. Scan the QR code or copy the secret, then confirm
          with a code.
        </p>
        {!user.totpEnabled && !totpSetup && (
          <button type="button" className="btn secondary" onClick={() => void beginTotp()}>
            Set up authenticator
          </button>
        )}
        {totpSetup && (
          <div>
            <img src={totpSetup.qr} alt="TOTP QR code" width={220} height={220} />
            <p>
              Secret <code>{totpSetup.secret}</code>
            </p>
            <div className="field">
              <label htmlFor="en-code">Confirm code</label>
              <input
                id="en-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <button type="button" className="btn accent" onClick={() => void enableTotp()}>
              Enable TOTP
            </button>
          </div>
        )}
        {recovery && (
          <div>
            <p className="muted">Recovery codes (shown once)</p>
            <ul>
              {recovery.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
        {user.totpEnabled && (
          <div style={{ marginTop: "1rem" }}>
            <div className="field">
              <label htmlFor="dpw">Password</label>
              <input
                id="dpw"
                type="password"
                value={disablePw}
                onChange={(e) => setDisablePw(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="dcode">Current authenticator code</label>
              <input
                id="dcode"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
              />
            </div>
            <button type="button" className="btn danger" onClick={() => void disableTotp()}>
              Disable TOTP
            </button>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Export</h2>
        <p className="muted">
          Download a decrypted JSON corpus of your days, task details, journals, and catalog. The
          file is sensitive and formatted for optional future model training on your own machine.
        </p>
        <button
          type="button"
          className="btn secondary"
          disabled={exporting}
          onClick={() => void exportCorpus()}
        >
          {exporting ? "Preparing…" : "Download corpus"}
        </button>
      </div>

      {msg && <p className="muted">{msg}</p>}
      {error && <p className="error">{error}</p>}

      <div className="panel" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>About</h2>
        <p>
          Your Energy Matters is an open-source energy accounting journal for neurodivergent
          productivity. It draws on
          Energy Accounting as described by Maja Toudal and Dr. Tony Attwood (
          <a href="https://energyaccounting.com/" target="_blank" rel="noreferrer">
            energyaccounting.com
          </a>
          ), and on iceberg-aware neurodivergent practice as framed in Dr. Samantha Hiew’s Tip of the
          ADHD Iceberg. Play suggestions that add energy follow Stuart Brown and the National
          Institute for Play styles. Weather data comes from{" "}
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            Open-Meteo
          </a>{" "}
          (CC BY 4.0). Source is released under the MIT License.
        </p>
        <p className="muted">
          Overview {user.onboardingCompleted ? "completed" : "not completed yet"}.
        </p>
        <Link className="btn secondary" to="/onboarding?replay=1" style={{ display: "inline-flex" }}>
          View overview again
        </Link>
      </div>

      <div className="panel danger-zone" style={{ marginTop: "1rem" }}>
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Delete profile</h2>
        <p className="muted">
          Deleting your profile removes your account, every day and task, your journal, your You
          profile, your butterfly, and all share links. There is no undo and no retained copy.
        </p>
        <button type="button" className="btn danger" onClick={() => setDeleteOpen(true)}>
          Delete profile…
        </button>
      </div>

      {deleteOpen && (
        <div className="insight-scrim" role="presentation">
          <div
            id="delete-profile-modal"
            className="panel insight-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <h2 id="delete-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              Delete your profile?
            </h2>
            <p className="muted">
              This permanently deletes everything: account, days, tasks, journal entries, your
              You profile, your butterfly, and every share link. Consider downloading your data
              first; this is the last chance to keep a copy.
            </p>
            <button
              type="button"
              className="btn secondary"
              disabled={exporting}
              onClick={() => void exportCorpus()}
            >
              {exporting ? "Preparing…" : "Download my data first"}
            </button>
            <div className="field" style={{ marginTop: "0.75rem" }}>
              <label htmlFor="delete-pw">Password</label>
              <input
                id="delete-pw"
                type="password"
                autoComplete="current-password"
                value={deletePw}
                onChange={(e) => setDeletePw(e.target.value)}
              />
            </div>
            {user.totpEnabled && (
              <div className="field">
                <label htmlFor="delete-code">Authenticator code</label>
                <input
                  id="delete-code"
                  inputMode="numeric"
                  value={deleteCode}
                  onChange={(e) => setDeleteCode(e.target.value)}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="delete-confirm">Type DELETE to confirm</label>
              <input
                id="delete-confirm"
                autoComplete="off"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
              />
            </div>
            {deleteError && <p className="error">{deleteError}</p>}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn danger"
                disabled={deleting || !deletePw || deleteConfirm.trim() !== "DELETE"}
                onClick={() => void deleteAccount()}
              >
                {deleting ? "Deleting…" : "Delete everything"}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={deleting}
                onClick={() => setDeleteOpen(false)}
              >
                Keep my profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
