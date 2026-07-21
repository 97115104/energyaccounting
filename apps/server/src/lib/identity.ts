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
const ARCHETYPES = new Set([
  "monarch",
  "morpho",
  "swallowtail",
  "glasswing",
  "longwing",
  "owl",
  "sulphur",
  "peacock",
]);
const MOTIONS = new Set(["auto", "calm", "still"]);
const EDGES = new Set(["smooth", "scalloped", "angular"]);
const TAILS = new Set(["none", "short", "long", "twin"]);
const PATTERNS = new Set(["veined", "banded", "spotted", "eyespots", "clear"]);

const ARCHETYPE_PALETTE: Record<string, { primary: string; secondary: string; accent: string }> = {
  monarch: { primary: "#e07a1a", secondary: "#9a3d28", accent: "#2a1608" },
  morpho: { primary: "#3f7bd6", secondary: "#7b5bd6", accent: "#141a2e" },
  swallowtail: { primary: "#f4b942", secondary: "#2f6b6b", accent: "#2a2208" },
  glasswing: { primary: "#8fb7c9", secondary: "#5a7d8c", accent: "#20323a" },
  longwing: { primary: "#e2542f", secondary: "#2a2a2a", accent: "#141414" },
  owl: { primary: "#8a5a2b", secondary: "#40301f", accent: "#1c140a" },
  sulphur: { primary: "#f0c419", secondary: "#c98a1a", accent: "#3a2a08" },
  peacock: { primary: "#8a2f4a", secondary: "#2f4b8a", accent: "#1a1226" },
};

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export type StoredWing = {
  family: string;
  edge: string;
  tail: string;
  pattern: string;
  complexity: number;
};

export type StoredIdentity = {
  version: 1;
  symbol: string;
  archetype: string;
  wing: StoredWing;
  palette: { primary: string; secondary: string; accent: string };
  seed: string;
  motion: string;
};

function sanitizeWing(archetype: string, input: unknown): StoredWing {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const complexityRaw = Number(raw.complexity);
  const complexity = Number.isFinite(complexityRaw)
    ? Math.min(4, Math.max(0, Math.round(complexityRaw)))
    : 2;
  return {
    // Family is authoritative from archetype so the two never disagree.
    family: archetype,
    edge: EDGES.has(String(raw.edge)) ? String(raw.edge) : "smooth",
    tail: TAILS.has(String(raw.tail)) ? String(raw.tail) : "none",
    pattern: PATTERNS.has(String(raw.pattern)) ? String(raw.pattern) : "veined",
    complexity,
  };
}

/** Coerce untrusted client input into the allowlisted shape, or null. */
export function sanitizeIdentity(input: unknown, fallbackSeed: string): StoredIdentity | null {
  if (input === null) return null;
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const archetype = ARCHETYPES.has(String(raw.archetype)) ? String(raw.archetype) : "monarch";
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
    wing: sanitizeWing(archetype, raw.wing),
    palette: {
      primary: isHex(paletteRaw.primary) ? paletteRaw.primary : preset.primary,
      secondary: isHex(paletteRaw.secondary) ? paletteRaw.secondary : preset.secondary,
      accent: isHex(paletteRaw.accent) ? paletteRaw.accent : preset.accent,
    },
    seed,
    motion: MOTIONS.has(String(raw.motion)) ? String(raw.motion) : "auto",
  };
}
