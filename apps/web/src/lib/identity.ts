/**
 * NeuroMe identity model: the render-safe configuration behind a person's
 * butterfly and their chosen external symbol.
 *
 * Nothing in this module is sensitive. The identity config describes how to
 * draw a mark (symbol, archetype, palette, motion), so it lives as plaintext on
 * the user row and can be cached locally to welcome a returning person before
 * their encrypted journal unlocks. Private "how to work with me" content lives
 * in youProfile.ts behind the encryption boundary instead.
 *
 * The butterfly is always the internal symbol for the You experience. The
 * external symbol is the person's public mark, chosen because it resonates with
 * how they see their own neurodivergence.
 */

import {
  WING_FAMILIES,
  compatibleTraits,
  defaultWingFor,
  normalizeWing,
  type WingConfig,
  type WingFamily,
  type WingVariation,
} from "./butterflyGeometry";

export type IdentitySymbol =
  | "butterfly"
  | "rainbow-infinity"
  | "gold-infinity"
  | "rainbow-pride";

/** A butterfly's wing family. Kept as an alias so existing call sites read well. */
export type ButterflyArchetype = WingFamily;

export type MotionPreference = "auto" | "calm" | "still";

/** A wing palette. Meanings are optional and owned entirely by the person. */
export type ButterflyPalette = {
  /** Upper forewing fill. */
  primary: string;
  /** Lower hindwing fill. */
  secondary: string;
  /** Vein, border, and eyespot ink. */
  accent: string;
  /** Living rainbow: the wings slowly cycle hue through the whole wheel.
      The hex fields above are the resting pose (and the reduced-motion look). */
  rainbow?: boolean;
};

export type IdentityConfig = {
  version: 1;
  /** External mark shown on profile, login return, and public shares. */
  symbol: IdentitySymbol;
  /** Wing family; kept in sync with wing.family for readable call sites. */
  archetype: ButterflyArchetype;
  /** Composable wing morphology: family, edge, tail, pattern, complexity. */
  wing: WingConfig;
  palette: ButterflyPalette;
  /** Stable string that seeds deterministic per-person wing variation. */
  seed: string;
  motion: MotionPreference;
};

export type SymbolMeta = {
  id: IdentitySymbol;
  label: string;
  /** One calm sentence shown when choosing. */
  blurb: string;
};

/**
 * Symbol choices offered in onboarding and You. Order is intentional: the
 * butterfly leads because it is the app's own symbol of becoming.
 */
export const SYMBOLS: SymbolMeta[] = [
  {
    id: "butterfly",
    label: "Butterfly",
    blurb:
      "Growth through change, the symbol this app is built around. Your butterfly is always your inside self.",
  },
  {
    id: "rainbow-infinity",
    label: "Rainbow infinity",
    blurb:
      "The neurodiversity movement's mark for endless variation across many kinds of minds.",
  },
  {
    id: "gold-infinity",
    label: "Gold infinity",
    blurb:
      "Autistic pride, from the chemical symbol Au. A mark chosen by autistic self-advocates.",
  },
  {
    id: "rainbow-pride",
    label: "Rainbow pride",
    blurb:
      "One mark for people who hold both neurodivergent and LGBTQ+ identity together, or if you just like rainbows.",
  },
];

export type ArchetypeMeta = {
  id: ButterflyArchetype;
  label: string;
  blurb: string;
  /** Suggested palette when a person first picks this base. */
  palette: ButterflyPalette;
};

/**
 * Wing families offered in onboarding and You. Species names describe the
 * visual inspiration, not a claim that the generated mark is biologically
 * exact. Order leads with the most familiar silhouettes.
 */
export const ARCHETYPES: ArchetypeMeta[] = [
  {
    id: "monarch",
    label: "Monarch",
    blurb: "Broad upper wings, bold veins, and a resilient, gliding beat.",
    palette: { primary: "#e07a1a", secondary: "#9a3d28", accent: "#2a1608" },
  },
  {
    id: "morpho",
    label: "Morpho",
    blurb: "Wide, rounded wings with a bright structural shimmer.",
    palette: { primary: "#3f7bd6", secondary: "#7b5bd6", accent: "#141a2e" },
  },
  {
    id: "swallowtail",
    label: "Swallowtail",
    blurb: "Angular forewings and long hindwing tails, made for gliding.",
    palette: { primary: "#f4b942", secondary: "#2f6b6b", accent: "#2a2208" },
  },
  {
    id: "glasswing",
    label: "Glasswing",
    blurb: "Slim wings with calm, translucent central panels.",
    palette: { primary: "#8fb7c9", secondary: "#5a7d8c", accent: "#20323a" },
  },
  {
    id: "longwing",
    label: "Longwing",
    blurb: "Long, slim forewings and a compact, unhurried shape.",
    palette: { primary: "#e2542f", secondary: "#2a2a2a", accent: "#141414" },
  },
  {
    id: "owl",
    label: "Owl",
    blurb: "Deep, tall hindwings built to carry watchful eyespots.",
    palette: { primary: "#8a5a2b", secondary: "#40301f", accent: "#1c140a" },
  },
  {
    id: "sulphur",
    label: "Sulphur",
    blurb: "Compact, leaf-like wings with a soft, quick flutter.",
    palette: { primary: "#f0c419", secondary: "#c98a1a", accent: "#3a2a08" },
  },
  {
    id: "peacock",
    label: "Peacock",
    blurb: "Scalloped edges and layered eyespots, quietly striking.",
    palette: { primary: "#8a2f4a", secondary: "#2f4b8a", accent: "#1a1226" },
  },
];

/** A small, legible starter set. People can set any hex later. */
export const PALETTE_PRESETS: { label: string; palette: ButterflyPalette }[] = [
  { label: "Ember", palette: { primary: "#e07a1a", secondary: "#9a3d28", accent: "#2a1608" } },
  { label: "Meadow", palette: { primary: "#4b9d54", secondary: "#2f6b6b", accent: "#173a24" } },
  { label: "Dusk", palette: { primary: "#c96f8e", secondary: "#7b5bd6", accent: "#2a1832" } },
  { label: "Tide", palette: { primary: "#3f7bd6", secondary: "#2f9bb0", accent: "#12233a" } },
  { label: "Gold", palette: { primary: "#f0b429", secondary: "#c98a1a", accent: "#3a2a08" } },
  {
    label: "Rainbow",
    // Red-to-violet resting gradient; the rainbow flag makes the wings drift
    // through the full hue wheel, so these are the pose it passes through.
    palette: { primary: "#d1273b", secondary: "#7a4a9e", accent: "#2a1226", rainbow: true },
  },
];

/** CSS background for a preset swatch; the rainbow preset shows all bands. */
export function paletteSwatchBackground(palette: ButterflyPalette): string {
  if (palette.rainbow) {
    return "linear-gradient(135deg, #d1273b, #e8853a, #e5c33a, #2f8f4e, #3563b0, #7a4a9e)";
  }
  return `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`;
}

export function isIdentitySymbol(value: unknown): value is IdentitySymbol {
  return SYMBOLS.some((s) => s.id === value);
}

export function isArchetype(value: unknown): value is ButterflyArchetype {
  return ARCHETYPES.some((a) => a.id === value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function symbolMeta(id: IdentitySymbol): SymbolMeta {
  return SYMBOLS.find((s) => s.id === id) ?? SYMBOLS[0]!;
}

export function archetypeMeta(id: ButterflyArchetype): ArchetypeMeta {
  return ARCHETYPES.find((a) => a.id === id) ?? ARCHETYPES[0]!;
}

/** A deterministic default so a person always has a valid, drawable mark. */
export function defaultIdentity(seed: string): IdentityConfig {
  const archetype = ARCHETYPES[0]!;
  return {
    version: 1,
    symbol: "butterfly",
    archetype: archetype.id,
    wing: defaultWingFor(archetype.id),
    palette: { ...archetype.palette },
    seed: seed || "eaj",
    motion: "auto",
  };
}

/**
 * Coerce untrusted stored/config input into a valid IdentityConfig, falling
 * back field by field so a corrupt palette never blanks the whole mark.
 * Legacy configs without a wing block migrate to the family's default wing.
 */
export function normalizeIdentity(input: unknown, seed: string): IdentityConfig {
  const base = defaultIdentity(seed);
  if (!input || typeof input !== "object") return base;
  const raw = input as Record<string, unknown>;
  const archetype = isArchetype(raw.archetype) ? raw.archetype : base.archetype;
  const preset = archetypeMeta(archetype).palette;
  const paletteRaw =
    raw.palette && typeof raw.palette === "object"
      ? (raw.palette as Record<string, unknown>)
      : {};
  const wingRaw =
    raw.wing && typeof raw.wing === "object" ? (raw.wing as Partial<WingConfig>) : undefined;
  return {
    version: 1,
    symbol: isIdentitySymbol(raw.symbol) ? raw.symbol : base.symbol,
    archetype,
    // Family is authoritative from archetype; wing carries the rest of the shape.
    wing: normalizeWing(archetype, wingRaw),
    palette: {
      primary: isHexColor(paletteRaw.primary) ? paletteRaw.primary : preset.primary,
      secondary: isHexColor(paletteRaw.secondary) ? paletteRaw.secondary : preset.secondary,
      accent: isHexColor(paletteRaw.accent) ? paletteRaw.accent : preset.accent,
      ...(paletteRaw.rainbow === true ? { rainbow: true } : {}),
    },
    seed: typeof raw.seed === "string" && raw.seed.trim() ? raw.seed : base.seed,
    motion:
      raw.motion === "calm" || raw.motion === "still" || raw.motion === "auto"
        ? raw.motion
        : base.motion,
  };
}

/** Compatibility helpers re-exported for pickers and validators. */
export { WING_FAMILIES, compatibleTraits, defaultWingFor };
export type { WingConfig };

/**
 * A tiny deterministic hash (cyrb53-lite) used to derive stable per-person wing
 * variation from the seed. Same seed gives the same numbers everywhere, so a
 * butterfly looks identical on every device by construction.
 */
export function seedHash(seed: string): number {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) * 4294967296 + (h1 >>> 0);
}

export type { WingVariation };

/**
 * Deterministic wing variation from the seed, stable across renders. This
 * personalizes a butterfly within its chosen grammar; it never overrides an
 * explicit family, edge, tail, pattern, or complexity choice.
 */
export function wingVariation(seed: string): WingVariation {
  const h = seedHash(seed);
  const a = (h % 1000) / 1000;
  const b = ((h >>> 3) % 1000) / 1000;
  const c = ((h >>> 7) % 1000) / 1000;
  const d = ((h >>> 11) % 1000) / 1000;
  const e = ((h >>> 15) % 1000) / 1000;
  return {
    spread: 0.35 + a * 0.5,
    aspect: b,
    veinFan: c,
    jitter: 0.2 + d * 0.6,
    band: 0.3 + e * 0.6,
  };
}
