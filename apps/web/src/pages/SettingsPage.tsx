import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { UserProfile } from "../App";
import { DialogFrame } from "../components/DialogFrame";
import { api, DAY_CHANGED_EVENT } from "../lib/api";
import {
  downloadTrainingCorpus,
  previewTrainingCorpus,
  readTrainingCorpus,
  restoreTrainingCorpus,
  type ActiveDayResolution,
  type CorpusPreview,
  type RestoreMode,
  type TrainingCorpus,
} from "../lib/exportCorpus";
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
  const [readingCorpus, setReadingCorpus] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreCorpus, setRestoreCorpus] = useState<TrainingCorpus | null>(null);
  const [restorePreview, setRestorePreview] = useState<CorpusPreview | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>("merge");
  const [activeDayResolution, setActiveDayResolution] = useState<ActiveDayResolution>("keep-current");
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
  const restoreFileRef = useRef<HTMLInputElement>(null);

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

  function resetRestore(force = false) {
    if (restoring && !force) return;
    setRestoreOpen(false);
    setRestoreCorpus(null);
    setRestorePreview(null);
    if (restoreFileRef.current) restoreFileRef.current.value = "";
  }

  async function selectRestoreCorpus(file: File | undefined) {
    if (!file) return;
    setError(null);
    setMsg(null);
    setReadingCorpus(true);
    try {
      const corpus = await readTrainingCorpus(file);
      const preview = await previewTrainingCorpus(corpus);
      if (preview.daysToAdd === 0 && preview.linesToAdd === 0) {
        setMsg("This corpus already matches your days and tasks. Nothing to add.");
        if (restoreFileRef.current) restoreFileRef.current.value = "";
        return;
      }
      setRestoreCorpus(corpus);
      setRestorePreview(preview);
      setRestoreMode("merge");
      setActiveDayResolution("keep-current");
      setRestoreOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that corpus.");
      if (restoreFileRef.current) restoreFileRef.current.value = "";
    } finally {
      setReadingCorpus(false);
    }
  }

  function applyRestoredUser(next: UserProfile) {
    onUser(next);
    setDisplayName(next.displayName ?? "");
    setLat(next.lat ?? null);
    setLon(next.lon ?? null);
    setCountry(next.country ?? "US");
    setTempUnit(next.temperatureUnit ?? defaultTemperatureUnit(next.country));
    setTimezone(next.timezone || deviceTimezone() || "UTC");
    setGreetingStyle(next.greetingStyle ?? "mix");
    setIncludePhysicalActivities(next.includePhysicalActivities !== false);
  }

  async function restoreSelectedCorpus() {
    if (!restoreCorpus || !restorePreview) return;
    setError(null);
    setRestoring(true);
    try {
      const resolution =
        restoreMode === "merge" && restorePreview.activeDayConflict
          ? activeDayResolution
          : undefined;
      const result = await restoreTrainingCorpus(restoreCorpus, restoreMode, resolution);
      if (result.profileRestored) {
        const refreshed = await api<{ user: UserProfile }>("/api/auth/me");
        applyRestoredUser(refreshed.user);
      }
      window.dispatchEvent(new Event(DAY_CHANGED_EVENT));
      setMsg(
        restoreMode === "replace"
          ? `Corpus restored: ${result.daysAdded} days and ${result.linesAdded} tasks replaced your journal history.`
          : `Corpus merged: added ${result.daysAdded} days and ${result.linesAdded} tasks; kept ${result.daysExisting} existing days and ${result.linesExisting} tasks.`,
      );
      resetRestore(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setRestoring(false);
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
        </div>
      <button
          type="button"
          className="btn secondary"
          style={{ marginBottom: "1rem" }}
          disabled={cityStatus === "locating"}
          onClick={requestLocation}
        >
          {cityStatus === "locating"
            ? "Asking…"
            : lat != null && lon != null
              ? "Update location"
              : "Use my location"}
          </button>
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
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Export and restore</h2>
        <p className="muted">
          Download a decrypted JSON corpus of your days, task details, journals, and catalog. The
          file is sensitive and formatted for optional future model training on your own machine.
          You can also restore it later; private text is re-encrypted with this account’s journal key
          before it is saved.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
          <button
            type="button"
            className="btn secondary"
            disabled={exporting || readingCorpus || restoring}
            onClick={() => void exportCorpus()}
          >
            {exporting ? "Preparing…" : "Download corpus"}
          </button>
          <input
            ref={restoreFileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(event) => void selectRestoreCorpus(event.currentTarget.files?.[0])}
          />
          <button
            type="button"
            className="btn secondary"
            disabled={exporting || readingCorpus || restoring}
            onClick={() => restoreFileRef.current?.click()}
          >
            {readingCorpus ? "Checking corpus…" : "Restore corpus…"}
          </button>
        </div>
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

      {restoreOpen && restoreCorpus && restorePreview && (
        <DialogFrame
          id="restore-corpus-modal"
          ariaLabelledby="restore-corpus-title"
          ariaDescribedby="restore-corpus-description"
          closeLabel="Cancel corpus restore"
          closeDisabled={restoring}
          onClose={() => resetRestore()}
          header={
            <h2 id="restore-corpus-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              Restore corpus?
            </h2>
          }
          footer={
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "1.25rem" }}>
              <button type="button" className="btn secondary" disabled={restoring} onClick={() => resetRestore()}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${restoreMode === "replace" ? "danger" : "accent"}`}
                disabled={restoring}
                onClick={() => void restoreSelectedCorpus()}
              >
                {restoring
                  ? "Restoring…"
                  : restoreMode === "replace"
                    ? "Replace with corpus"
                    : "Merge corpus"}
              </button>
            </div>
          }
        >
            <p id="restore-corpus-description" className="muted">
              This {restoreCorpus.schemaVersion === 6 ? "v6" : "v7"} corpus contains {restoreCorpus.days.length} days and{" "}
              {restoreCorpus.days.reduce((total, day) => total + day.lines.length, 0)} tasks. Your private text is
              re-encrypted to this account before it is saved.
            </p>
            <p className="muted">
              <strong>{restorePreview.daysToAdd}</strong> days and <strong>{restorePreview.linesToAdd}</strong> tasks will be added;{" "}
              <strong>{restorePreview.daysExisting}</strong> days and <strong>{restorePreview.linesExisting}</strong> tasks already match this account.
            </p>

            <fieldset className="field" style={{ border: "none", padding: 0, margin: "1rem 0" }}>
              <legend className="field-legend">How should this restore work?</legend>
              <label className="check-row" htmlFor="restore-merge">
                <input
                  id="restore-merge"
                  type="radio"
                  name="restore-mode"
                  checked={restoreMode === "merge"}
                  disabled={restoring}
                  onChange={() => setRestoreMode("merge")}
                />
                <span>Merge without duplicates</span>
              </label>
              <p className="muted" style={{ margin: "0.15rem 0 0.65rem 1.7rem" }}>
                Adds only missing days and tasks. Matching records and this account’s current profile settings stay as they are.
              </p>
              <label className="check-row" htmlFor="restore-replace">
                <input
                  id="restore-replace"
                  type="radio"
                  name="restore-mode"
                  checked={restoreMode === "replace"}
                  disabled={restoring}
                  onChange={() => setRestoreMode("replace")}
                />
                <span>Replace journal with this corpus</span>
              </label>
              <p className="muted" style={{ margin: "0.15rem 0 0 1.7rem" }}>
                Replaces days, activity history, preferences, butterfly, and You profile. Email, password, authenticator, sessions, and share links stay untouched.
              </p>
            </fieldset>

            {restoreMode === "merge" && restorePreview.activeDayConflict && (
              <fieldset className="field" style={{ border: "none", padding: 0, margin: "1rem 0" }}>
                <legend className="field-legend">Both have an active energy day</legend>
                <p className="muted" style={{ marginTop: 0 }}>
                  The journal permits one active day. Choose which one remains active; no day will be silently closed.
                </p>
                <label className="check-row" htmlFor="keep-current-active">
                  <input
                    id="keep-current-active"
                    type="radio"
                    name="active-day-resolution"
                    checked={activeDayResolution === "keep-current"}
                    disabled={restoring}
                    onChange={() => setActiveDayResolution("keep-current")}
                  />
                  <span>Keep this account’s active day and skip the imported one</span>
                </label>
                <label className="check-row" htmlFor="replace-current-active" style={{ marginTop: "0.5rem" }}>
                  <input
                    id="replace-current-active"
                    type="radio"
                    name="active-day-resolution"
                    checked={activeDayResolution === "replace-current"}
                    disabled={restoring}
                    onChange={() => setActiveDayResolution("replace-current")}
                  />
                  <span>Replace this account’s active day with the imported one</span>
                </label>
              </fieldset>
            )}

        </DialogFrame>
      )}

      {deleteOpen && (
        <DialogFrame
          id="delete-profile-modal"
          role="alertdialog"
          ariaLabelledby="delete-title"
          closeLabel="Keep profile"
          closeDisabled={deleting}
          dismissOnBackdrop={false}
          onClose={() => setDeleteOpen(false)}
          header={
            <h2 id="delete-title" style={{ fontFamily: "var(--display)", marginTop: 0 }}>
              Delete your profile?
            </h2>
          }
          footer={
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
          }
        >
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
        </DialogFrame>
      )}
    </div>
  );
}
