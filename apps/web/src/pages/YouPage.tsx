/**
 * You: the person's own page. The Wing Atlas hero shows their butterfly living
 * through today's energy; below it they shape their identity (symbol, base,
 * palette with personal color meanings), review what the on-device
 * intelligence noticed (each suggestion explained, accepted, or dismissed),
 * write how to work with them, and share all of it deliberately: local SVG or
 * PNG, a print-quality profile, or a revocable public link.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { UserProfile } from "../App";
import { Butterfly } from "../components/Butterfly";
import { DictatableField } from "../components/DictatableField";
import { DictationControl } from "../components/DictationControl";
import { IdentityMark } from "../components/IdentityMark";
import { IntelligenceOverview, type IntelligenceStatus } from "../components/IntelligenceOverview";
import { ProfileSections } from "../components/ProfileSections";
import { SuggestionCard } from "../components/SuggestionCard";
import { WingDetails, WingFamilyPicker } from "../components/IdentityPickers";
import { api } from "../lib/api";
import type { ButterflyState } from "../lib/butterflyState";
import { effectiveBeatMs } from "../lib/butterflyState";
import {
  suggestTraits,
  type DayPoint,
  type TraitSuggestion,
} from "../lib/butterflyTraits";
import { normalizeWing, type WingConfig } from "../lib/butterflyGeometry";
import { getSessionDek } from "../lib/crypto";
import { useDictation } from "../lib/useDictation";
import { loadPersonalData, type PersonalData } from "../lib/personalData";
import {
  buildPersonalIntelligence,
  type PersonalIntelligence,
} from "../lib/personalIntelligence";
import { draftWorkWithYou, type DraftField, type DraftLine } from "../lib/youDraft";
import {
  PALETTE_PRESETS,
  SYMBOLS,
  archetypeMeta,
  normalizeIdentity,
  paletteSwatchBackground,
  type ButterflyPalette,
  type IdentityConfig,
} from "../lib/identity";
import { buildSharePayload, downloadPng, downloadSvg } from "../lib/identityShare";
import { usePrefersReducedMotion } from "../lib/useButterflyDay";
import {
  DEFAULT_SHARE_SECTIONS,
  KIND_LABEL,
  SLOT_LABEL,
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

type ShareLifetime = "day" | "month" | "quarter" | "permanent";
type ShareRow = { id: string; createdAt: string; expiresAt: string | null; revoked: boolean };

const DRAFT_FIELD_LABEL: Record<DraftField, string> = {
  about: "About you",
  communication: "How to communicate with you",
  support: "What helps on a hard day",
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
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [personalIntel, setPersonalIntel] = useState<PersonalIntelligence | null>(null);
  const [intelStatus, setIntelStatus] = useState<IntelligenceStatus>("loading");
  // Personal data is decrypted once; suggestions and drafts re-filter locally.
  const dataRef = useRef<PersonalData | null>(null);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [sections, setSections] = useState<ShareSections>(DEFAULT_SHARE_SECTIONS);
  const [ttl, setTtl] = useState<ShareLifetime>("month");
  const [newLink, setNewLink] = useState<string | null>(null);
  const [newLinkIsPermanent, setNewLinkIsPermanent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [localPalette, setLocalPalette] = useState(identity.palette);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  // Latest identity, so rapid wing/palette edits chain instead of racing.
  const identityRef = useRef(identity);
  const identityChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  useEffect(() => {
    setLocalPalette(identity.palette);
  }, [identity.palette]);

  /** Recompute on-device suggestions and drafts from the loaded personal data. */
  function recomputeIntel(next: YouProfile) {
    const data = dataRef.current;
    if (!data) return;
    const days: DayPoint[] = data.days.map((d) => ({
      date: d.date,
      phase: d.phase,
      attwoodNet: d.attwoodNet,
      feelRating: d.feelRating,
    }));
    setPersonalIntel(
      buildPersonalIntelligence({
        catalog: data.catalog,
        days: data.days,
        journalDays: data.days.filter((day) => !!day.journal?.trim()).length,
      }),
    );
    const dismissedTraits = new Set(next.dismissedTraitIds);
    const acceptedTraits = new Set(next.traits.map((t) => t.id));
    setSuggestions(
      suggestTraits(data.catalog, days, dismissedTraits).filter((s) => !acceptedTraits.has(s.id)),
    );
    // Accepting a draft records its id in dismissedDraftIds, so drafts filter on
    // that alone and an accepted line never returns.
    setDrafts(
      next.autoDraft
        ? draftWorkWithYou(data, next.traits, new Set(next.dismissedDraftIds))
        : [],
    );
  }

  function applyProfile(next: YouProfile) {
    profileRef.current = next;
    setProfile(next);
    recomputeIntel(next);
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
        const data = await loadPersonalData();
        if (cancelled) return;
        dataRef.current = data;
        recomputeIntel(profileRef.current);
        setIntelStatus("ready");
      } catch {
        if (!cancelled) {
          dataRef.current = null;
          setPersonalIntel(null);
          setIntelStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Merge a patch onto the latest identity and persist. Writes are serialized
   * and always send identityRef.current, so a slower response cannot restore an
   * older wing or palette (last-write-wins is by intent, not by chance).
   */
  function saveIdentity(patch: Partial<IdentityConfig>) {
    const next: IdentityConfig = { ...identityRef.current, ...patch };
    identityRef.current = next;
    setError(null);
    onUser({ ...user, identity: next });
    identityChain.current = identityChain.current
      .then(() =>
        api("/api/auth/profile", {
          method: "PATCH",
          body: JSON.stringify({ identity: identityRef.current }),
        }).then(() => undefined),
      )
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not save your identity.");
      });
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
    pendingSaves.current += 1;
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
      .finally(() => {
        // Only clear "Saving…" once the whole burst has drained.
        pendingSaves.current -= 1;
        if (pendingSaves.current === 0) setSaving(false);
      });
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

  /** Fold a journal-drawn draft line into its field, then stop offering it. */
  function acceptDraft(line: DraftLine) {
    saveProfile((prev) => {
      const existing = prev[line.field].trim();
      const merged = existing ? `${existing}\n${line.text}` : line.text;
      return {
        ...prev,
        [line.field]: merged,
        dismissedDraftIds: [...prev.dismissedDraftIds, line.id],
      };
    });
  }

  function dismissDraft(line: DraftLine) {
    saveProfile((prev) => ({
      ...prev,
      dismissedDraftIds: [...prev.dismissedDraftIds, line.id],
    }));
  }

  function changeFamily(family: IdentityConfig["archetype"]) {
    saveIdentity({
      archetype: family,
      wing: normalizeWing(family, identityRef.current.wing),
    });
  }

  function changeWing(wing: WingConfig) {
    saveIdentity({ archetype: wing.family, wing });
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
    saveIdentity({ palette });
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
        personalIntel?.overview ?? [],
      );
      const res = await api<{ token: string; share: ShareRow }>("/api/you/shares", {
        method: "POST",
        body: JSON.stringify({ payload: JSON.stringify(payload), ttl }),
      });
      setShares((s) => [...s, res.share]);
      setNewLink(`${window.location.origin}/share/${res.token}`);
      setNewLinkIsPermanent(ttl === "permanent");
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

  const anySectionSelected =
    (sections.overview && (personalIntel?.overview.length ?? 0) > 0) ||
    sections.about ||
    sections.communication ||
    sections.support ||
    sections.traits ||
    sections.colorMeanings;

  function printProfile() {
    // Always printable: the butterfly and mark carry the page even with no
    // sections. An inline note (below) nudges without blocking the dialog.
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
                saveIdentity({ motion: e.target.value as IdentityConfig["motion"] })
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

      <IntelligenceOverview intelligence={personalIntel} status={intelStatus} />

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
                onChange={() => saveIdentity({ symbol: s.id })}
              />
              <span className="you-symbol-art">
                <IdentityMark identity={liveIdentity} symbol={s.id} size={44} decorative />
              </span>
              <span className="you-symbol-name">{s.label}</span>
              <span className="you-symbol-blurb muted">{s.blurb}</span>
            </label>
          ))}
        </div>

        <h4>Wing family</h4>
        <p className="muted">
          Eight families to start from. Neurodivergent people are as varied as butterflies, so
          pick the silhouette that feels like you, then shape the details.
        </p>
        <WingFamilyPicker
          identity={liveIdentity}
          value={identity.archetype}
          onChange={changeFamily}
        />

        <h4>Wing details</h4>
        <WingDetails wing={identity.wing} onChange={changeWing} />

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
                style={{ background: paletteSwatchBackground(p.palette) }}
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
                onChange={(e) => {
                  // Hand-picking a color takes over from the rainbow drift.
                  const { rainbow: _drop, ...rest } = localPalette;
                  setLocalPalette({ ...rest, [slot]: e.target.value });
                }}
                onBlur={() => commitPalette(localPalette)}
              />
              <ColorMeaningInput
                slot={slot}
                label={SLOT_LABEL[slot] ?? slot}
                value={meaningFor(slot)}
                disabled={!profileLoaded}
                onLocalChange={(meaning) => {
                  // Local-only until commit so typing does not thrash encryption.
                  const prev = profileRef.current;
                  const rest = prev.colorMeanings.filter((m) => m.slot !== slot);
                  applyProfile({
                    ...prev,
                    colorMeanings: meaning.trim() ? [...rest, { slot, meaning }] : rest,
                  });
                }}
                onCommit={(meaning) => setColorMeaning(slot, meaning)}
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
            <SuggestionCard
              key={s.id}
              kindLabel={KIND_LABEL[s.kind]}
              title={s.label}
              because={s.because}
              acceptAriaLabel={`Accept trait: ${s.label}`}
              dismissAriaLabel={`Dismiss trait suggestion: ${s.label}`}
              onAccept={() => acceptSuggestion(s)}
              onDismiss={() => dismissSuggestion(s)}
            />
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

      {/* How to work with me: encrypted free text, drafted from the journal. */}
      <section className="panel you-section" aria-labelledby="you-profile-title">
        <h3 id="you-profile-title">How to work with you</h3>
        <p className="muted">
          Your own words for people you choose to share with. Optional draft lines come from
          your history; edit them in your voice. Nothing here is visible to anyone unless you
          share it below.
        </p>

        <label className="you-autodraft-toggle">
          <input
            type="checkbox"
            checked={profile.autoDraft}
            disabled={!profileLoaded}
            onChange={(e) => saveProfile({ autoDraft: e.target.checked })}
          />
          Suggest lines from my journal and tasks
        </label>

        {(profile.about.trim() || profile.communication.trim() || profile.support.trim()) && (
          <div className="you-profile-summary">
            {profile.about.trim() && (
              <div>
                <h4>About you</h4>
                <p>{profile.about}</p>
              </div>
            )}
            {profile.communication.trim() && (
              <div>
                <h4>How to communicate with you</h4>
                <p>{profile.communication}</p>
              </div>
            )}
            {profile.support.trim() && (
              <div>
                <h4>What helps on a hard day</h4>
                <p>{profile.support}</p>
              </div>
            )}
          </div>
        )}

        {profile.autoDraft && drafts.length === 0 && (
          <p className="muted you-drafts-empty">
            No new lines to suggest yet. Suggestions appear as your days and tasks grow.
          </p>
        )}
        {profile.autoDraft && drafts.length > 0 && (
          <div className="you-drafts">
            <h4>Suggested from your journal</h4>
            <p className="muted">
              Add what feels true. Each line explains the history behind it.
            </p>
            <ul className="you-suggestions">
              {drafts.map((line) => (
                <SuggestionCard
                  key={line.id}
                  kindLabel={DRAFT_FIELD_LABEL[line.field]}
                  title={line.text}
                  because={line.because}
                  acceptLabel="Add"
                  acceptAriaLabel={`Add to ${DRAFT_FIELD_LABEL[line.field]}: ${line.text}`}
                  dismissAriaLabel={`Dismiss suggestion: ${line.text}`}
                  onAccept={() => acceptDraft(line)}
                  onDismiss={() => dismissDraft(line)}
                />
              ))}
            </ul>
          </div>
        )}

        <details className="you-manual-flow">
          <summary>Add or edit details manually</summary>
          <p className="muted">
            Optional details add your own voice to the perspective. They are encrypted on this
            device before being saved, and you can dictate any field.
          </p>
          <DictatableField
            label="About you"
            multiline
            value={profile.about}
            maxLength={2000}
            disabled={!profileLoaded}
            onChange={(v) => applyProfile({ ...profileRef.current, about: v })}
            onCommit={(v) => saveProfile({ about: v })}
          />
          <DictatableField
            label="How to communicate with you"
            multiline
            value={profile.communication}
            maxLength={2000}
            disabled={!profileLoaded}
            onChange={(v) => applyProfile({ ...profileRef.current, communication: v })}
            onCommit={(v) => saveProfile({ communication: v })}
          />
          <DictatableField
            label="What helps on a hard day"
            multiline
            value={profile.support}
            maxLength={2000}
            disabled={!profileLoaded}
            onChange={(v) => applyProfile({ ...profileRef.current, support: v })}
            onCommit={(v) => saveProfile({ support: v })}
          />
        </details>
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
          {!anySectionSelected && " No sections are selected yet, so only your butterfly prints."}
        </p>

        <h4>Sections to include</h4>
        <div className="you-share-sections">
          {(
            [
              ["overview", "Energy intelligence overview"],
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
                disabled={key === "overview" && (personalIntel?.overview.length ?? 0) === 0}
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
              aria-describedby={ttl === "permanent" ? "you-share-permanent-note" : undefined}
              onChange={(e) => setTtl(e.target.value as typeof ttl)}
            >
              <option value="day">1 day</option>
              <option value="month">30 days</option>
              <option value="quarter">90 days</option>
              <option value="permanent">Permanent — until revoked</option>
            </select>
          </div>
          {ttl === "permanent" && (
            <p id="you-share-permanent-note" className="muted you-print-note">
              A permanent link keeps the selected plaintext available until you revoke it or delete
              your account.
            </p>
          )}
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
              This full link appears once. Anyone who has it can view the snapshot{" "}
              {newLinkIsPermanent
                ? "until you revoke it or delete your account"
                : "until it expires or you revoke it"}
              .
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
                    Created {new Date(s.createdAt).toLocaleDateString()} ·{" "}
                    {s.expiresAt
                      ? `expires ${new Date(s.expiresAt).toLocaleDateString()}`
                      : "permanent until revoked"}
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
        <ProfileSections
          variant="print"
          palette={liveIdentity.palette}
          name={user.displayName}
          overview={
            sections.overview
              ? personalIntel?.overview.map((line) => ({
                  text: line.text,
                  because: line.because,
                }))
              : undefined
          }
          about={sections.about ? profile.about : undefined}
          communication={sections.communication ? profile.communication : undefined}
          support={sections.support ? profile.support : undefined}
          traits={sections.traits ? profile.traits : undefined}
          colorMeanings={sections.colorMeanings ? profile.colorMeanings : undefined}
        />
        <p className="you-print-foot">Made with EAJ · Your Energy Matters</p>
      </section>
    </div>
  );
}

/**
 * The wing-color meaning field: a short text input with dictation, kept inline
 * with its color swatch. Commits to the encrypted profile on blur or when a
 * dictation session ends.
 */
function ColorMeaningInput({
  slot,
  label,
  value,
  disabled,
  onLocalChange,
  onCommit,
}: {
  slot: "primary" | "secondary" | "accent";
  label: string;
  value: string;
  disabled: boolean;
  onLocalChange: (meaning: string) => void;
  onCommit: (meaning: string) => void;
}) {
  const getValue = useCallback(() => value, [value]);
  const dictation = useDictation({
    getValue,
    onChange: onLocalChange,
    onCommit,
    maxLength: 120,
  });
  return (
    <div className="you-color-meaning-wrap">
      <label className="sr-only" htmlFor={`you-meaning-${slot}`}>
        {label} meaning
      </label>
      <input
        id={`you-meaning-${slot}`}
        type="text"
        className="you-color-meaning"
        placeholder="What this color means to you"
        maxLength={120}
        value={value}
        disabled={disabled}
        onChange={(e) => onLocalChange(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
      />
      <DictationControl dictation={dictation} label={`${label} meaning`} disabled={disabled} hidePill />
    </div>
  );
}
