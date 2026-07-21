import { useState } from "react";
import { Link } from "react-router-dom";
import type { UserProfile } from "../App";
import { api } from "../lib/api";
import { downloadTrainingCorpus } from "../lib/exportCorpus";

type Props = {
  user: UserProfile;
  onUser: (u: UserProfile) => void;
};

export function SettingsPage({ user, onUser }: Props) {
  const [lat, setLat] = useState(String(user.lat ?? ""));
  const [lon, setLon] = useState(String(user.lon ?? ""));
  const [country, setCountry] = useState(user.country ?? "US");
  const [timezone, setTimezone] = useState(
    user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disablePw, setDisablePw] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [exporting, setExporting] = useState(false);

  async function saveProfile() {
    setError(null);
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({
          lat: lat === "" ? null : Number(lat),
          lon: lon === "" ? null : Number(lon),
          country,
          timezone,
        }),
      });
      onUser({
        ...user,
        lat: lat === "" ? null : Number(lat),
        lon: lon === "" ? null : Number(lon),
        country,
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

  return (
    <div>
      <div className="panel">
        <h2 style={{ fontFamily: "var(--display)", marginTop: 0 }}>Profile</h2>
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
          Download a decrypted JSON corpus of your days, journals, and catalog. The file is formatted
          for optional future model training on your own machine.
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
          EAJ is an open-source energy accounting journal for neurodivergent productivity. It draws on
          Energy Accounting as described by Maja Toudal and Dr. Tony Attwood (
          <a href="https://energyaccounting.com/" target="_blank" rel="noreferrer">
            energyaccounting.com
          </a>
          ), and on iceberg-aware neurodivergent practice as framed in Dr. Samantha Hiew’s Tip of the
          ADHD Iceberg. Play-category deposit suggestions follow Stuart Brown and the National
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
    </div>
  );
}
