/**
 * The You profile: everything a person writes or accepts about themselves.
 *
 * This is personal content, so it crosses the wire only as AES-GCM ciphertext
 * under the person's DEK, exactly like journal entries. The server stores one
 * encrypted blob per user and can never read it. Sharing is a deliberate,
 * separate act: the person picks sections, and only those picked sections are
 * copied (as plaintext, by choice) into a snapshot or a local file.
 */

import type { AcceptedTrait } from "./butterflyTraits";
import { decryptText, encryptText } from "./crypto";

export const YOU_PROFILE_AAD = "eaj-you-v1";

/** Shared vocabulary so every surface labels traits and colors identically. */
export const KIND_LABEL: Record<string, string> = {
  interest: "Interest",
  "energy-giver": "Adds energy",
  "energy-taker": "Uses energy",
  rhythm: "Rhythm",
};

export const SLOT_LABEL: Record<string, string> = {
  primary: "Forewing",
  secondary: "Hindwing",
  accent: "Ink",
};

export type ColorMeaning = {
  /** Which palette slot the meaning belongs to. */
  slot: "primary" | "secondary" | "accent";
  /** The person's own words for what this color means to them. */
  meaning: string;
};

export type YouProfile = {
  version: 1;
  /** Free-text intro in the person's own voice. */
  about: string;
  /** How to communicate with me. */
  communication: string;
  /** What helps on a hard day. */
  support: string;
  /** Accepted traits (from suggestions or written by hand). */
  traits: AcceptedTrait[];
  /** Suggestion ids the person dismissed, so they stay dismissed. */
  dismissedTraitIds: string[];
  /** Personal color meanings for the wing palette. */
  colorMeanings: ColorMeaning[];
  /** Show journal-drawn draft lines under the profile fields. Default on. */
  autoDraft: boolean;
  /** Draft line ids the person dismissed, so they stay dismissed. */
  dismissedDraftIds: string[];
};

export function emptyYouProfile(): YouProfile {
  return {
    version: 1,
    about: "",
    communication: "",
    support: "",
    traits: [],
    dismissedTraitIds: [],
    colorMeanings: [],
    autoDraft: true,
    dismissedDraftIds: [],
  };
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Coerce a decrypted blob into a valid profile; bad fields fall back empty. */
export function normalizeYouProfile(input: unknown): YouProfile {
  const empty = emptyYouProfile();
  if (!input || typeof input !== "object") return empty;
  const raw = input as Record<string, unknown>;
  const traits = Array.isArray(raw.traits)
    ? raw.traits.flatMap((t): AcceptedTrait[] => {
        if (!t || typeof t !== "object") return [];
        const r = t as Record<string, unknown>;
        if (typeof r.id !== "string" || typeof r.label !== "string") return [];
        const kind =
          r.kind === "interest" ||
          r.kind === "energy-giver" ||
          r.kind === "energy-taker" ||
          r.kind === "rhythm"
            ? r.kind
            : "interest";
        return [
          {
            id: r.id,
            kind,
            label: r.label,
            ...(typeof r.colorMeaning === "string" ? { colorMeaning: r.colorMeaning } : {}),
          },
        ];
      })
    : [];
  const colorMeanings = Array.isArray(raw.colorMeanings)
    ? raw.colorMeanings.flatMap((m): ColorMeaning[] => {
        if (!m || typeof m !== "object") return [];
        const r = m as Record<string, unknown>;
        if (
          (r.slot === "primary" || r.slot === "secondary" || r.slot === "accent") &&
          typeof r.meaning === "string"
        ) {
          return [{ slot: r.slot, meaning: r.meaning }];
        }
        return [];
      })
    : [];
  return {
    version: 1,
    about: asString(raw.about),
    communication: asString(raw.communication),
    support: asString(raw.support),
    traits,
    dismissedTraitIds: Array.isArray(raw.dismissedTraitIds)
      ? raw.dismissedTraitIds.filter((x): x is string => typeof x === "string")
      : [],
    colorMeanings,
    // Default on so returning profiles that predate this field still auto-draft.
    autoDraft: typeof raw.autoDraft === "boolean" ? raw.autoDraft : true,
    dismissedDraftIds: Array.isArray(raw.dismissedDraftIds)
      ? raw.dismissedDraftIds.filter((x): x is string => typeof x === "string")
      : [],
  };
}

export async function encryptYouProfile(
  dek: CryptoKey,
  profile: YouProfile,
): Promise<{ ciphertext: string; iv: string }> {
  return encryptText(dek, JSON.stringify(profile), YOU_PROFILE_AAD);
}

export async function decryptYouProfile(
  dek: CryptoKey,
  ciphertext: string,
  iv: string,
): Promise<YouProfile> {
  const plain = await decryptText(dek, ciphertext, iv, YOU_PROFILE_AAD);
  return normalizeYouProfile(JSON.parse(plain));
}

/** Sections a person can include in a share or export, each opt-in. */
export type ShareSections = {
  overview: boolean;
  about: boolean;
  communication: boolean;
  support: boolean;
  traits: boolean;
  colorMeanings: boolean;
};

export const DEFAULT_SHARE_SECTIONS: ShareSections = {
  overview: false,
  about: false,
  communication: false,
  support: false,
  traits: false,
  colorMeanings: false,
};

/**
 * Build the plaintext payload for a public snapshot or local export from only
 * the sections the person turned on. Never include dismissed ids or anything
 * the person did not choose.
 */
export type SharedOverviewLine = {
  text: string;
  because: string[];
};

export function selectShareContent(
  profile: YouProfile,
  sections: ShareSections,
  overview: SharedOverviewLine[] = [],
): Partial<
  Pick<YouProfile, "about" | "communication" | "support" | "traits" | "colorMeanings"> & {
    overview: SharedOverviewLine[];
  }
> {
  const sharedOverview = overview
    .map((line) => ({
      text: line.text.trim().slice(0, 400),
      because: line.because
        .map((reason) => reason.trim().slice(0, 240))
        .filter(Boolean)
        .slice(0, 4),
    }))
    .filter((line) => line.text)
    .slice(0, 8);
  return {
    ...(sections.overview && sharedOverview.length ? { overview: sharedOverview } : {}),
    ...(sections.about && profile.about.trim() ? { about: profile.about.trim() } : {}),
    ...(sections.communication && profile.communication.trim()
      ? { communication: profile.communication.trim() }
      : {}),
    ...(sections.support && profile.support.trim() ? { support: profile.support.trim() } : {}),
    ...(sections.traits && profile.traits.length ? { traits: profile.traits } : {}),
    ...(sections.colorMeanings && profile.colorMeanings.length
      ? { colorMeanings: profile.colorMeanings }
      : {}),
  };
}
