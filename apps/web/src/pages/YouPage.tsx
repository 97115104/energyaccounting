/**
 * You: the person's own page. The Wing Atlas hero shows their butterfly living
 * through today's energy; below it they shape their identity (symbol, base,
 * palette with personal color meanings), review what the on-device
 * intelligence noticed (each suggestion explained, accepted, or dismissed),
 * write how to work with them, and share all of it deliberately: local SVG or
 * PNG, a print-quality profile, or a revocable public link.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { UserProfile } from "../App";
import { Butterfly } from "../components/Butterfly";
import { IdentityMark } from "../components/IdentityMark";
import { api } from "../lib/api";
import type { ButterflyState } from "../lib/butterflyState";
import { effectiveBeatMs } from "../lib/butterflyState";
import {
  suggestTraits,
  type AcceptedTrait,
  type CatalogEntry,
  type DayPoint,
  type TraitSuggestion,
} from "../lib/butterflyTraits";
import { getSessionDek } from "../lib/crypto";
import { fetchDecryptedCatalog } from "../lib/exportCorpus";
import {
  ARCHETYPES,
  PALETTE_PRESETS,
  SYMBOLS,
  archetypeMeta,
  normalizeIdentity,
  type ButterflyPalette,
  type IdentityConfig,
} from "../lib/identity";
import { buildSharePayload, downloadPng, downloadSvg } from "../lib/identityShare";
import { usePrefersReducedMotion } from "../lib/useButterflyDay";
import {
  DEFAULT_SHARE_SECTIONS,
  decryptYouProfile,
  emptyYouProfile,
  encryptYouProfile,
  type ShareSections,
  type YouProfile,
} from "../lib/youProfile";

type Props = {
  user: UserProfile;
  onUser: (u: UserProfile) => void;
  butterflyState: ButterflyState;
};

type ShareRow = { id: string; createdAt: string; expiresAt: string; revoked: boolean };

const KIND_LABEL: Record<AcceptedTrait["kind"], string> = {
  interest: "Interest",
  "energy-giver": "Adds energy",
  "energy-taker": "Uses energy",
  rhythm: "Rhythm",
};

const SLOT_LABEL: Record<"primary" | "secondary" | "accent", string> = {
  primary: "Forewing",
  secondary: "Hindwing",
  accent: "Ink",
};

export function YouPage({ user, onUser, butterflyState }: Props) {
  const identity = useMemo(
    () => normalizeIdentity(user.identity, user.id),
    [user.identity, user.id],
  );
  const prefersReduced = usePrefersReducedMotion();
  const beat = effectiveBeatMs(butterflyState, identity.motion, prefersReduced);

  const [profile, setProfile] = useState<YouProfile>(emptyYouProfile);
  const profileRef = useRef<YouProfile>(emptyYouProfile());
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [suggestions, setSuggestions] = useState<TraitSuggestion[]>([]);
  // Catalog/stats are loaded once; suggestions are re-filtered locally.
  const catalogRef = useRef<{ catalog: CatalogEntry[]; days: DayPoint[] } | null>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [sections, setSections] = useState<ShareSections>(DEFAULT_SHARE_SECTIONS);
  const [ttl, setTtl] = useState<"day" | "month" | "quarter">("month");
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [localPalette, setLocalPalette] = useState(identity.palette);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setLocalPalette(identity.palette);
  }, [identity.palette]);

  function applyProfile(next: YouProfile) {
    profileRef.current = next;
    setProfile(next);
    const data = catalogRef.current;
    if (data) {
      const dismissed = new Set(next.dismissedTraitIds);
      const accepted = new Set(next.traits.map((t) => t.id));
      setSuggestions(
        suggestTraits(data.catalog, data.days, dismissed).filter((s) => !accepted.has(s.id)),
      );
    }
  }

  // Load encrypted profile, share list, and trait suggestions once on entry.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dek = getSessionDek();
      try {
        const res = await api<{ profile: { ciphertext: string; iv: string } | null }>(
          "/api/you/profile",
        );
        if (!cancelled && res.profile && dek) {
          const loaded = await decryptYouProfile(dek, res.profile.ciphertext, res.profile.iv);
          profileRef.current = loaded;
          setProfile(loaded);
        }
      } catch {
        // A fresh or unreadable profile starts empty; the person can rewrite it.
      } finally {
        if (!cancelled) setProfileLoaded(true);
      }
      try {
        const res = await api<{ shares: ShareRow[] }>("/api/you/shares");
        if (!cancelled) setShares(res.shares);
      } catch {
        /* the share panel simply shows none */
      }
      try {
        const [catalog, stats] = await Promise.all([
          fetchDecryptedCatalog(),
          api<{ series: DayPoint[] }>("/api/stats"),
        ]);
        if (cancelled) return;
        catalogRef.current = { catalog: catalog as CatalogEntry[], days: stats.series };
        const current = profileRef.current;
        const dismissed = new Set(current.dismissedTraitIds);
        const accepted = new Set(current.traits.map((t) => t.id));
        setSuggestions(
          suggestTraits(catalog as CatalogEntry[], stats.series, dismissed).filter(
            (s) => !accepted.has(s.id),
          ),
        );
      } catch {
        /* no suggestions without an unlocked catalog */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveIdentity(next: IdentityConfig) {
    setError(null);
    try {
      await api("/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ identity: next }),
      });
      onUser({ ...user, identity: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your identity.");
    }
  }

  /** Serialize profile writes so blur + accept cannot race last-write-wins. */
  function saveProfile(patch: Partial<YouProfile> | ((prev: YouProfile) => YouProfile)) {
    const next =
      typeof patch === "function" ? patch(profileRef.current) : { ...profileRef.current, ...patch };
    applyProfile(next);
    const dek = getSessionDek();
    if (!dek) {
      setError("Unlock your journal key before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    saveChain.current = saveChain.current
      .then(async () => {
        // Always encrypt the latest ref, not the snapshot from when the chain began.
        const latest = profileRef.current;
        const { ciphertext, iv } = await encryptYouProfile(dek, latest);
        await api("/api/you/profile", {
          method: "PUT",
          body: JSON.stringify({ ciphertext, iv }),
        });
        setSavedAt(Date.now());
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not save your profile.");
      })
      .finally(() => setSaving(false));
  }

  function acceptSuggestion(s: TraitSuggestion) {
    saveProfile((prev) => ({
      ...prev,
      traits: [...prev.traits, { id: s.id, kind: s.kind, label: s.label }],
    }));
  }

  function dismissSuggestion(s: TraitSuggestion) {
    saveProfile((prev) => ({
      ...prev,
      dismissedTraitIds: [...prev.dismissedTraitIds, s.id],
    }));
  }

  function removeTrait(id: string) {
    saveProfile((prev) => ({ ...prev, traits: prev.traits.filter((t) => t.id !== id) }));
  }

  function setColorMeaning(slot: "primary" | "secondary" | "accent", meaning: string) {
    saveProfile((prev) => {
      const rest = prev.colorMeanings.filter((m) => m.slot !== slot);
      return {
        ...prev,
        colorMeanings: meaning.trim() ? [...rest, { slot, meaning: meaning.trim() }] : rest,
      };
    });
  }

  function commitPalette(palette: ButterflyPalette) {
    setLocalPalette(palette);
    void saveIdentity({ ...identity, palette });
  }

  async function createShare() {
    setError(null);
    setNewLink(null);
    try {
      const payload = buildSharePayload(
        identity,
        user.displayName ?? null,
        profileRef.current,
        sections,
      );
      const res = await api<{ token: string; share: ShareRow }>("/api/you/shares", {
        method: "POST",
        body: JSON.stringify({ payload: JSON.stringify(payload), ttl }),
      });
      setShares((s) => [...s, res.share]);
      setNewLink(`${window.location.origin}/share/${res.token}`);
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the share link.");
    }
  }

  async function revokeShare(id: string) {
    try {
      await api(`/api/you/shares/${id}`, { method: "DELETE" });
      setShares((s) => s.map((row) => (row.id === id ? { ...row, revoked: true } : row)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke the link.");
    }
  }

  function heroSvg(): SVGSVGElement | null {
    return heroRef.current?.querySelector("svg") ?? null;
  }

  function printProfile() {
    const any =
      sections.about ||
      sections.communication ||
      sections.support ||
      sections.traits ||
      sections.colorMeanings;
    if (!any) {
      setError("Select at least one section before printing, or the PDF will be almost empty.");
      return;
    }
    setError(null);
    window.print();
  }

  const meaningFor = (slot: "primary" | "secondary" | "accent") =>
    profile.colorMeanings.find((m) => m.slot === slot)?.meaning ?? "";

  const liveIdentity = { ...identity, palette: localPalette };

  return (
    <div className="you-page">
      {/* Wing Atlas hero: the butterfly living through today. */}
      <section className="panel you-hero" aria-labelledby="you-hero-title">
        <div className="you-hero-butterfly" ref={heroRef}>
          <Butterfly
            identity={liveIdentity}
            beatMs={beat}
            size={220}
            title={`Your butterfly, ${archetypeMeta(identity.archetype).label.toLowerCase()} base. Today: ${butterflyState.label.toLowerCase()}.`}
          />
        </div>
        <div className="you-hero-copy">
          <h2 id="you-hero-title">
            {user.displayName ? `${user.displayName}'s butterfly` : "Your butterfly"}
          </h2>
          <p className="you-state-label">
            <strong>{butterflyState.label}.</strong> {butterflyState.summary}
          </p>
          <ul className="you-because muted">
            {butterflyState.because.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="field you-motion">
            <label htmlFor="you-motion">Wing motion</label>
            <select
              id="you-motion"
              value={identity.motion}
              onChange={(e) =>
                void saveIdentity({
                  ...identity,
                  motion: e.target.value as IdentityConfig["motion"],
                })
              }
            >
              <option value="auto">Follows my day</option>
              <option value="calm">Calm, half speed</option>
              <option value="still">Still</option>
            </select>
            {prefersReduced && identity.motion !== "still" && (
              <p className="muted you-motion-note">
                Your system asks for reduced motion, so the wings hold still here.
              </p>
            )}
          </div>
        </div>
      </section>

      {error && <p className="error">{error}</p>}

      {/* Identity: symbol, base, palette. */}
      <section className="panel you-section" aria-labelledby="you-identity-title">
        <h3 id="you-identity-title">Your mark</h3>
        <p className="muted">
          The butterfly is always your inside self here. Your mark is the symbol you show
          elsewhere: on shares, exports, and the sign-in welcome.
        </p>
        <div className="you-symbol-grid" role="radiogroup" aria-label="External symbol">
          {SYMBOLS.map((s) => (
            <label
              key={s.id}
              className={`you-symbol-card${identity.symbol === s.id ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="you-symbol"
                value={s.id}
                checked={identity.symbol === s.id}
                onChange={() => void saveIdentity({ ...identity, symbol: s.id })}
              />
              <span className="you-symbol-art">
                <IdentityMark identity={liveIdentity} symbol={s.id} size={44} />
              </span>
              <span className="you-symbol-name">{s.label}</span>
              <span className="you-symbol-blurb muted">{s.blurb}</span>
            </label>
          ))}
        </div>

        <h4>Wing base</h4>
        <div className="you-symbol-grid" role="radiogroup" aria-label="Butterfly base">
          {ARCHETYPES.map((a) => (
            <label
              key={a.id}
              className={`you-symbol-card${identity.archetype === a.id ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="you-archetype"
                value={a.id}
                checked={identity.archetype === a.id}
                onChange={() => void saveIdentity({ ...identity, archetype: a.id })}
              />
              <span className="you-symbol-art">
                <Butterfly
                  identity={{ ...liveIdentity, archetype: a.id }}
                  beatMs={null}
                  size={56}
                  title={a.label}
                />
              </span>
              <span className="you-symbol-name">{a.label}</span>
              <span className="you-symbol-blurb muted">{a.blurb}</span>
            </label>
          ))}
        </div>

        <h4>Wing colors and what they mean</h4>
        <p className="muted">
          Colors carry whatever meaning you give them. Write your own; it appears wherever you
          choose to share.
        </p>
        <div className="you-palette-presets">
          {PALETTE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="you-preset"
              onClick={() => commitPalette(p.palette)}
            >
              <span
                className="you-preset-swatch"
                style={{
                  background: `linear-gradient(135deg, ${p.palette.primary}, ${p.palette.secondary})`,
                }}
                aria-hidden="true"
              />
              {p.label}
            </button>
          ))}
        </div>
        <div className="you-color-rows">
          {(["primary", "secondary", "accent"] as const).map((slot) => (
            <div key={slot} className="you-color-row">
              <label className="you-color-slot" htmlFor={`you-color-${slot}`}>
                {SLOT_LABEL[slot]}
              </label>
              <input
                id={`you-color-${slot}`}
                type="color"
                value={localPalette[slot]}
                onChange={(e) =>
                  setLocalPalette({ ...localPalette, [slot]: e.target.value })
                }
                onBlur={() => commitPalette(localPalette)}
              />
              <label className="sr-only" htmlFor={`you-meaning-${slot}`}>
                {SLOT_LABEL[slot]} meaning
              </label>
              <input
                id={`you-meaning-${slot}`}
                type="text"
                className="you-color-meaning"
                placeholder="What this color means to you"
                maxLength={120}
                aria-label={`${SLOT_LABEL[slot]} meaning`}
                value={meaningFor(slot)}
                disabled={!profileLoaded}
                onChange={(e) => {
                  const meaning = e.target.value;
                  // Local-only until blur so typing does not thrash encryption.
                  const prev = profileRef.current;
                  const rest = prev.colorMeanings.filter((m) => m.slot !== slot);
                  applyProfile({
                    ...prev,
                    colorMeanings: meaning.trim()
                      ? [...rest, { slot, meaning }]
                      : rest,
                  });
                }}
                onBlur={(e) => setColorMeaning(slot, e.target.value)}
              />
            </div>
          ))}
        </div>
      </section>

      {/* What the on-device intelligence noticed. */}
      <section className="panel you-section" aria-labelledby="you-traits-title">
        <h3 id="you-traits-title">What your journal shows</h3>
        <p className="muted">
          Suggestions come from your own activity history, computed on this device. Each one
          says why. Accept what fits, dismiss what does not; dismissed ideas stay gone.
        </p>
        {suggestions.length === 0 && (
          <p className="muted">
            Nothing new to suggest yet. Suggestions appear as your journal grows.
          </p>
        )}
        <ul className="you-suggestions">
          {suggestions.map((s) => (
            <li key={s.id} className="you-suggestion">
              <div>
                <span className="you-trait-kind">{KIND_LABEL[s.kind]}</span>{" "}
                <strong>{s.label}</strong>
                <p className="muted you-suggestion-why">{s.because.join(" ")}</p>
              </div>
              <div className="you-suggestion-actions">
                <button type="button" className="btn secondary" onClick={() => acceptSuggestion(s)}>
                  Accept
                </button>
                <button type="button" className="linkish" onClick={() => dismissSuggestion(s)}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
        {profile.traits.length > 0 && (
          <>
            <h4>Accepted traits</h4>
            <ul className="you-traits">
              {profile.traits.map((t) => (
                <li key={t.id} className="you-trait-chip">
                  <span className="you-trait-kind">{KIND_LABEL[t.kind]}</span> {t.label}
                  <button
                    type="button"
                    className="linkish"
                    aria-label={`Remove trait ${t.label}`}
                    onClick={() => removeTrait(t.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* How to work with me: encrypted free text. */}
      <section className="panel you-section" aria-labelledby="you-profile-title">
        <h3 id="you-profile-title">How to work with you</h3>
        <p className="muted">
          Written in your own words and encrypted on this device before it is saved. Nothing
          here is visible to anyone unless you share it below.
        </p>
        <div className="field">
          <label htmlFor="you-about">About you</label>
          <textarea
            id="you-about"
            rows={3}
            maxLength={2000}
            value={profile.about}
            disabled={!profileLoaded}
            onChange={(e) => applyProfile({ ...profileRef.current, about: e.target.value })}
            onBlur={(e) => saveProfile({ about: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="you-communication">How to communicate with you</label>
          <textarea
            id="you-communication"
            rows={3}
            maxLength={2000}
            value={profile.communication}
            disabled={!profileLoaded}
            onChange={(e) =>
              applyProfile({ ...profileRef.current, communication: e.target.value })
            }
            onBlur={(e) => saveProfile({ communication: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="you-support">What helps on a hard day</label>
          <textarea
            id="you-support"
            rows={3}
            maxLength={2000}
            value={profile.support}
            disabled={!profileLoaded}
            onChange={(e) => applyProfile({ ...profileRef.current, support: e.target.value })}
            onBlur={(e) => saveProfile({ support: e.target.value })}
          />
        </div>
        <p className="muted you-save-note" aria-live="polite">
          {saving ? "Saving…" : savedAt ? "Saved." : ""}
        </p>
      </section>

      {/* Sharing and exports. */}
      <section className="panel you-section" aria-labelledby="you-share-title">
        <h3 id="you-share-title">Share your butterfly</h3>
        <p className="muted">
          Save your butterfly for avatars and posts, print a profile to hand to someone, or
          publish a link you can revoke at any time. Your mark and display name always travel
          with a share; the sections below start off and only join when you turn them on.
        </p>
        <div className="you-export-buttons">
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              const svg = heroSvg();
              if (svg) downloadSvg(svg, "my-butterfly.svg");
            }}
          >
            Download SVG
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              const svg = heroSvg();
              if (!svg) return;
              void downloadPng(svg, "my-butterfly.png").catch((e) =>
                setError(e instanceof Error ? e.message : "PNG export failed."),
              );
            }}
          >
            Download PNG
          </button>
          <button type="button" className="btn secondary" onClick={printProfile}>
            Print or save PDF
          </button>
        </div>
        <p className="muted you-print-note">
          The printed profile includes your butterfly, your mark, and the sections selected
          below. Today&apos;s energy state is not included.
        </p>

        <h4>Sections to include</h4>
        <div className="you-share-sections">
          {(
            [
              ["about", "About you"],
              ["communication", "How to communicate with you"],
              ["support", "What helps on a hard day"],
              ["traits", "Accepted traits"],
              ["colorMeanings", "Color meanings"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="you-share-check">
              <input
                type="checkbox"
                checked={sections[key]}
                onChange={(e) => setSections({ ...sections, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>

        <div className="you-share-create">
          <div className="field">
            <label htmlFor="you-share-ttl">Link lifetime</label>
            <select
              id="you-share-ttl"
              value={ttl}
              onChange={(e) => setTtl(e.target.value as typeof ttl)}
            >
              <option value="day">1 day</option>
              <option value="month">30 days</option>
              <option value="quarter">90 days</option>
            </select>
          </div>
          <button type="button" className="btn accent" onClick={() => void createShare()}>
            Create share link
          </button>
        </div>
        {newLink && (
          <div className="you-new-link">
            <code>{newLink}</code>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                void navigator.clipboard.writeText(newLink).then(() => setCopied(true));
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <p className="muted">
              This full link appears once. Anyone who has it can view the snapshot until it
              expires or you revoke it.
            </p>
          </div>
        )}
        {shares.length > 0 && (
          <>
            <h4>Your links</h4>
            <ul className="you-share-list">
              {shares.map((s) => (
                <li key={s.id} className="you-share-row">
                  <span>
                    Created {new Date(s.createdAt).toLocaleDateString()} · expires{" "}
                    {new Date(s.expiresAt).toLocaleDateString()}
                    {s.revoked ? " · revoked" : ""}
                  </span>
                  {!s.revoked && (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => void revokeShare(s.id)}
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="muted you-danger-note">
          Want everything gone instead? <Link to="/settings">Settings</Link> has a full profile
          deletion that removes your account, journal, and every share link.
        </p>
      </section>

      {/* Print-only profile: the PDF is this document via the browser's print dialog. */}
      <section className="you-print" aria-hidden="true">
        <div className="you-print-head">
          <Butterfly identity={liveIdentity} beatMs={null} size={140} />
          <div>
            <h1>{user.displayName || "My butterfly"}</h1>
            <p className="you-print-sub">{archetypeMeta(identity.archetype).label}</p>
            <IdentityMark identity={liveIdentity} size={36} />
          </div>
        </div>
        {sections.about && profile.about.trim() && (
          <div className="you-print-block">
            <h2>About</h2>
            <p>{profile.about}</p>
          </div>
        )}
        {sections.communication && profile.communication.trim() && (
          <div className="you-print-block">
            <h2>How to communicate with me</h2>
            <p>{profile.communication}</p>
          </div>
        )}
        {sections.support && profile.support.trim() && (
          <div className="you-print-block">
            <h2>What helps on a hard day</h2>
            <p>{profile.support}</p>
          </div>
        )}
        {sections.traits && profile.traits.length > 0 && (
          <div className="you-print-block">
            <h2>Traits</h2>
            <ul>
              {profile.traits.map((t) => (
                <li key={t.id}>
                  {KIND_LABEL[t.kind]}: {t.label}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sections.colorMeanings && profile.colorMeanings.length > 0 && (
          <div className="you-print-block">
            <h2>Wing colors</h2>
            <ul>
              {profile.colorMeanings.map((m) => (
                <li key={m.slot}>
                  <span
                    className="you-print-swatch"
                    style={{ background: liveIdentity.palette[m.slot] }}
                  />
                  {SLOT_LABEL[m.slot]}: {m.meaning}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="you-print-foot">Made with EAJ · Your Energy Matters</p>
      </section>
    </div>
  );
}
