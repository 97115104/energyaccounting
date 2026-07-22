import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { UserProfile } from "../App";
import { ModalCloseButton } from "../components/ModalCloseButton";
import { api } from "../lib/api";
import { downloadTrainingCorpus } from "../lib/exportCorpus";
import { GREETING_STYLES, type GreetingStyle } from "../lib/greeting";
import { reverseGeocodeCity } from "../lib/reverseGeocode";
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
  const [lat, setLat] = useState<number | null>(user.lat ?? null);
  const [lon, setLon] = useState<number | null>(user.lon ?? null);
  const [cityLabel, setCityLabel] = useState<string | null>(null);
  const [cityStatus, setCityStatus] = useState<"idle" | "locating" | "resolving" | "denied">(
    "idle",
  );
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
  const [includePhysicalActivities, setIncludePhysicalActivities] = useState(
    user.includePhysicalActivities !== false,
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
  const [email, setEmail] = useState(user.email);
  const [emailPassword, setEmailPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    setEmail(user.email);
  }, [user.email]);

  useEffect(() => {
    setLat(user.lat ?? null);
    setLon(user.lon ?? null);
  }, [user.lat, user.lon]);

  useEffect(() => {
    if (lat == null || lon == null) {
      setCityLabel(null);
      return;
    }
    const ac = new AbortController();
    setCityStatus("resolving");
    void reverseGeocodeCity(lat, lon, ac.signal)
      .then((label) => {
        if (ac.signal.aborted) return;
        setCityLabel(label);
        setCityStatus("idle");
      })
      .catch(() => {
        if (ac.signal.aborted) return;
        setCityLabel(null);
        setCityStatus("idle");
      });
    return () => ac.abort();
  }, [lat, lon]);

  function requestLocation() {
    if (!navigator.geolocation) {
      setError("This browser cannot share location.");
      return;
    }
    setError(null);
    setMsg(null);
    setCityStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextLat = pos.coords.latitude;
        const nextLon = pos.coords.longitude;
        setLat(nextLat);
        setLon(nextLon);
        setCityStatus("resolving");
        void api("/api/auth/profile", {
          method: "PATCH",
          body: JSON.stringify({
            lat: nextLat,
            lon: nextLon,
            locationPrompted: true,
          }),
        })
          .then(() => {
            onUser({
              ...user,
              lat: nextLat,
              lon: nextLon,
              locationPrompted: true,
            });
            setMsg("Location updated.");
          })
          .catch((e) => {
            setError(e instanceof Error ? e.message : "Could not save location.");
          });
      },
      () => {
        setCityStatus("denied");
      },
      { maximumAge: 0, timeout: 12_000 },
    );
  }

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
    const focusId = window.requestAnimationFrame(() => focusables()[0]?.focus({ preventScroll: true }));
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
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [deleteOpen]);

  function cancelEmailEdit() {
    setEditingEmail(false);
    setEmail(user.email);
    setEmailPassword("");
    setEmailCode("");
  }

  async function saveEmail() {
    setError(null);
    setMsg(null);
    setSavingEmail(true);
    try {
      const res = await api<{ user: UserProfile }>("/api/auth/email", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          password: emailPassword,
          ...(user.totpEnabled ? { code: emailCode } : {}),
        }),
      });
      onUser(res.user);
      setEmail(res.user.email);
      setEmailPassword("");
      setEmailCode("");
      setEditingEmail(false);
      setMsg("Email updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Email update failed");
    } finally {
      setSavingEmail(false);
    }
  }

  async function saveProfile() {
    setError(null);
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: displayName.trim() || null,
          lat,
          lon,
          country,
          temperatureUnit: tempUnit,
          greetingStyle,
          includePhysicalActivities,
          timezone,
          locationPrompted: true,
        }),
      });
      onUser({
        ...user,
        displayName: displayName.trim() || null,
        lat,
        lon,
        country,
        temperatureUnit: tempUnit,
        greetingStyle,
        includePhysicalActivities,
        timezone,
        locationPrompted: true,
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
        <div className="field">
          <label htmlFor="display-name">Name or alias (greetings)</label>
          <input
            id="display-name"
            type="text"
            maxLength={80}
            autoComplete="nickname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginBottom: editingEmail ? undefined : "1rem" }}>
          <label htmlFor="account-email">Email</label>
          {editingEmail ? (
            <input
              id="account-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          ) : (
            <p id="account-email" className="muted" style={{ margin: "0.35rem 0 0" }}>
              {user.email}
            </p>
          )}
        </div>
        {editingEmail ? (
          <>
            <div className="field">
              <label htmlFor="email-password">Current password</label>
              <input
                id="email-password"
                type="password"
                autoComplete="current-password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
              />
            </div>
            {user.totpEnabled && (
              <div className="field">
                <label htmlFor="email-code">Authenticator or recovery code</label>
                <input
                  id="email-code"
                  autoComplete="one-time-code"
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value)}
                />
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
              <button
                type="button"
                className="btn accent"
                disabled={
                  savingEmail ||
                  !emailPassword ||
                  email.trim().toLowerCase() === user.email.toLowerCase() ||
                  (user.totpEnabled && !emailCode.trim())
                }
                onClick={() => void saveEmail()}
              >
                {savingEmail ? "Updating…" : "Save email"}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={savingEmail}
                onClick={cancelEmailEdit}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="btn secondary"
            style={{ marginBottom: "1rem" }}
            onClick={() => setEditingEmail(true)}
          >
            Change email
          </button>
        )}
        <div className="field">
          <label htmlFor="tz">Timezone</label>
          <input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
        <div className="field settings-location">
          <label>Location</label>
          <p className="muted settings-location-why">
            Location powers your live sky and weather-aware suggestions.
          </p>
          {lat != null && lon != null ? (
            <p className="settings-location-city" aria-live="polite">
              {cityStatus === "resolving" && !cityLabel
                ? "Finding your city…"
                : cityLabel ?? "Location on"}
            </p>
          ) : (
            <p className="muted settings-location-city">No location yet</p>
          )}
          {cityStatus === "denied" && (
            <p className="muted" style={{ marginTop: "0.35rem" }}>
              Permission stayed off. You can try again from this button.
            </p>
          )}
          <button
            type="button"
            className="btn secondary"
            style={{ marginTop: "0.55rem" }}
            disabled={cityStatus === "locating"}
            onClick={requestLocation}
          >
            {cityStatus === "locating"
              ? "Asking…"
              : lat != null && lon != null
                ? "Update location"
                : "Use my location"}
          </button>
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
        <fieldset className="field" style={{ border: "none", padding: 0, margin: 0 }}>
          <legend className="field-legend">Activity suggestions</legend>
          <label className="check-row" htmlFor="include-physical">
            <input
              id="include-physical"
              type="checkbox"
              checked={includePhysicalActivities}
              onChange={(e) => setIncludePhysicalActivities(e.target.checked)}
            />
            <span>Include physical activities</span>
          </label>
          <p className="muted" style={{ marginTop: "0.35rem" }}>
            {includePhysicalActivities
              ? "Suggestions may include walks, movement, and stretch breaks."
              : "Suggestions focus on mindfulness, reading, journaling, writing, and connecting with people you care about."}
          </p>
        </fieldset>
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
            <ModalCloseButton
              label="Keep profile"
              disabled={deleting}
              onClick={() => setDeleteOpen(false)}
            />
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
                <label htmlFor="delete-code">Authenticator or recovery code</label>
                <input
                  id="delete-code"
                  autoComplete="one-time-code"
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
