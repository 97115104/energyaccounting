/**
 * Server-side allowlist for the plaintext NeuroMe identity config.
 * Mirrors the client's normalizeIdentity so arbitrary keys never land in
 * identity_json (which rides on /me and the corpus export outside the DEK).
 */

// The puzzle piece was removed from the offering; stored "puzzle" values
// coerce back to the butterfly here and in the client normalizer.
const SYMBOLS = new Set([
  "butterfly",
  "rainbow-infinity",
  "gold-infinity",
  "rainbow-pride",
]);
const ARCHETYPES = new Set(["swallowtail", "monarch", "morpho"]);
const MOTIONS = new Set(["auto", "calm", "still"]);

const ARCHETYPE_PALETTE: Record<string, { primary: string; secondary: string; accent: string }> = {
  swallowtail: { primary: "#f4b942", secondary: "#2f6b6b", accent: "#2a2208" },
  monarch: { primary: "#e07a1a", secondary: "#9a3d28", accent: "#2a1608" },
  morpho: { primary: "#3f7bd6", secondary: "#7b5bd6", accent: "#141a2e" },
};

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export type StoredIdentity = {
  version: 1;
  symbol: string;
  archetype: string;
  palette: { primary: string; secondary: string; accent: string };
  seed: string;
  motion: string;
};

/** Coerce untrusted client input into the allowlisted shape, or null. */
export function sanitizeIdentity(input: unknown, fallbackSeed: string): StoredIdentity | null {
  if (input === null) return null;
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const archetype = ARCHETYPES.has(String(raw.archetype)) ? String(raw.archetype) : "swallowtail";
  const preset = ARCHETYPE_PALETTE[archetype]!;
  const paletteRaw =
    raw.palette && typeof raw.palette === "object"
      ? (raw.palette as Record<string, unknown>)
      : {};
  const seed =
    typeof raw.seed === "string" && raw.seed.trim()
      ? raw.seed.trim().slice(0, 64)
      : fallbackSeed.slice(0, 64);
  return {
    version: 1,
    symbol: SYMBOLS.has(String(raw.symbol)) ? String(raw.symbol) : "butterfly",
    archetype,
    palette: {
      primary: isHex(paletteRaw.primary) ? paletteRaw.primary : preset.primary,
      secondary: isHex(paletteRaw.secondary) ? paletteRaw.secondary : preset.secondary,
      accent: isHex(paletteRaw.accent) ? paletteRaw.accent : preset.accent,
    },
    seed,
    motion: MOTIONS.has(String(raw.motion)) ? String(raw.motion) : "auto",
  };
}
