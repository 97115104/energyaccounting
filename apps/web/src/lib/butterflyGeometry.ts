/**
 * Butterfly wing geometry: a small visual grammar, not a pile of one-off SVGs.
 *
 * Diversity comes from combining independent traits, the same way neurodivergent
 * people are diverse: a wing family sets the silhouette, then edge, tail,
 * pattern, and complexity layer on top. Everything is pure and deterministic so
 * the same config draws the same butterfly on every device and can be unit
 * tested without a DOM.
 *
 * Coordinate system: a 200-wide box with the body on x=100. Every path is drawn
 * for the LEFT wing (x < 100); the component mirrors it for the right side.
 */

export type WingFamily =
  | "monarch"
  | "morpho"
  | "swallowtail"
  | "glasswing"
  | "longwing"
  | "owl"
  | "sulphur"
  | "peacock";

export type WingEdge = "smooth" | "scalloped" | "angular";
export type WingTail = "none" | "short" | "long" | "twin";
export type WingPattern = "veined" | "banded" | "spotted" | "eyespots" | "clear";
/** Visual richness only. Never a measure of worth, productivity, or "severity." */
export type WingComplexity = 0 | 1 | 2 | 3 | 4;

export type WingConfig = {
  family: WingFamily;
  edge: WingEdge;
  tail: WingTail;
  pattern: WingPattern;
  complexity: WingComplexity;
};

export const WING_FAMILIES: WingFamily[] = [
  "monarch",
  "morpho",
  "swallowtail",
  "glasswing",
  "longwing",
  "owl",
  "sulphur",
  "peacock",
];

export const WING_EDGES: WingEdge[] = ["smooth", "scalloped", "angular"];
export const WING_TAILS: WingTail[] = ["none", "short", "long", "twin"];
export const WING_PATTERNS: WingPattern[] = [
  "veined",
  "banded",
  "spotted",
  "eyespots",
  "clear",
];

/** Per-person variation, derived deterministically from the identity seed. */
export type WingVariation = {
  /** 0..1 broader wingtip reach. */
  spread: number;
  /** 0..1 vertical stretch of the wing. */
  aspect: number;
  /** 0..1 vein fan density within the pattern's own cap. */
  veinFan: number;
  /** 0..1 mark placement jitter. */
  jitter: number;
  /** 0..1 pattern-band thickness. */
  band: number;
};

type Point = { x: number; y: number };

export type WingRender = {
  forewing: string;
  hindwing: string;
  /** Tail path appended to the hindwing, or null when tailless. */
  tails: string[];
  veins: string[];
  bands: string[];
  spots: { x: number; y: number; r: number }[];
  eyespots: { x: number; y: number; r: number }[];
  /** Lighter "clear" panels for glasswing-style wings. */
  clearPanels: string[];
  /** Edge treatment strokes along the outer margin (scallops / points). */
  edgeMarks: string[];
};

/**
 * Not every trait fits every family. This keeps combinations plausible so a
 * generated or chosen butterfly always reads as a real wing.
 */
export function compatibleTraits(family: WingFamily): {
  tails: WingTail[];
  patterns: WingPattern[];
} {
  switch (family) {
    case "swallowtail":
      return {
        tails: ["short", "long", "twin"],
        patterns: ["veined", "banded", "spotted", "eyespots"],
      };
    case "glasswing":
      // Narrow wings: no room for busy eyespots; clear panels are the point.
      return { tails: ["none"], patterns: ["clear", "veined", "banded"] };
    case "longwing":
      return { tails: ["none", "short"], patterns: ["banded", "spotted", "veined"] };
    case "owl":
      // Broad hindwing built to carry big eyespots.
      return { tails: ["none", "short"], patterns: ["eyespots", "veined", "banded"] };
    case "sulphur":
      return { tails: ["none", "short"], patterns: ["veined", "spotted"] };
    case "peacock":
      return { tails: ["none", "short"], patterns: ["eyespots", "banded", "spotted"] };
    case "morpho":
      return { tails: ["none", "short"], patterns: ["banded", "veined", "eyespots"] };
    case "monarch":
    default:
      return {
        tails: ["none", "short"],
        patterns: ["veined", "banded", "spotted", "eyespots"],
      };
  }
}

/** Coerce a wing config so it is always a plausible, drawable combination. */
export function normalizeWing(family: WingFamily, wing?: Partial<WingConfig>): WingConfig {
  const compat = compatibleTraits(family);
  const edge: WingEdge = WING_EDGES.includes(wing?.edge as WingEdge)
    ? (wing!.edge as WingEdge)
    : defaultWingFor(family).edge;
  const tail: WingTail = compat.tails.includes(wing?.tail as WingTail)
    ? (wing!.tail as WingTail)
    : defaultWingFor(family).tail;
  const pattern: WingPattern = compat.patterns.includes(wing?.pattern as WingPattern)
    ? (wing!.pattern as WingPattern)
    : defaultWingFor(family).pattern;
  const rawComplexity = Number(wing?.complexity);
  const complexity = (
    Number.isFinite(rawComplexity) ? Math.min(4, Math.max(0, Math.round(rawComplexity))) : 2
  ) as WingComplexity;
  return { family, edge, tail, pattern, complexity };
}

/** A sensible starting wing per family, used for onboarding and migration. */
export function defaultWingFor(family: WingFamily): WingConfig {
  switch (family) {
    case "monarch":
      return { family, edge: "smooth", tail: "none", pattern: "veined", complexity: 2 };
    case "morpho":
      return { family, edge: "smooth", tail: "none", pattern: "banded", complexity: 2 };
    case "swallowtail":
      return { family, edge: "angular", tail: "long", pattern: "banded", complexity: 2 };
    case "glasswing":
      return { family, edge: "smooth", tail: "none", pattern: "clear", complexity: 1 };
    case "longwing":
      return { family, edge: "smooth", tail: "none", pattern: "banded", complexity: 2 };
    case "owl":
      return { family, edge: "scalloped", tail: "none", pattern: "eyespots", complexity: 3 };
    case "sulphur":
      return { family, edge: "smooth", tail: "none", pattern: "veined", complexity: 1 };
    case "peacock":
      return { family, edge: "scalloped", tail: "short", pattern: "eyespots", complexity: 3 };
  }
}

// --- Base silhouettes -------------------------------------------------------
// Each family defines a left-side forewing and hindwing outline. `reach`
// (from spread) widens the tips; `lift` (from aspect) raises the forewing apex.

type Base = { forewing: string; hindwing: string; hindLow: number; hindOut: number };

function familyBase(family: WingFamily, reach: number, lift: number): Base {
  switch (family) {
    case "monarch":
      // Danaus plexippus: a broad, rounded triangular forewing that sweeps up
      // and outward to a soft apex, with a full but compact rounded hindwing.
      // This is the shape people read in the butterfly emoji.
      return {
        forewing: `M97 89 C94 ${64 - lift}, ${72 - reach} ${34 - lift}, ${48 - reach} ${
          32 - lift
        } C${34 - reach} ${32 - lift}, ${28 - reach} 44, 34 58 C42 74, 62 85, 80 89 C88 91, 94 91, 97 89 Z`,
        hindwing:
          "M97 96 C85 95, 62 98, 51 109 C41 119, 43 137, 57 144 C71 150, 87 141, 93 125 C96 117, 97 105, 97 100 Z",
        hindLow: 144,
        hindOut: 51,
      };
    case "morpho":
      return {
        forewing: `M97 88 C93 ${56 - lift}, ${72 - reach} ${30 - lift}, ${46 - reach} ${
          30 - lift
        } C${26 - reach} 30, ${16 - reach} 46, ${20 - reach} 62 C${
          26 - reach
        } 78, 44 87, 62 90 C76 92, 88 93, 97 92 Z`,
        hindwing:
          "M97 96 C80 94, 52 98, 40 112 C30 124, 34 146, 52 154 C70 161, 90 148, 95 128 C96 120, 97 104, 97 100 Z",
        hindLow: 154,
        hindOut: 40,
      };
    case "swallowtail":
      return {
        forewing: `M97 88 C88 ${52 - lift}, ${56 - reach} ${30 - lift}, ${36 - reach} 36 C${
          22 - reach
        } 41, ${24 - reach} 62, 40 78 C58 92, 82 96, 97 92 Z`,
        hindwing:
          "M97 96 C80 96, 54 102, 44 116 C34 130, 42 146, 56 148 C66 149, 78 140, 86 128 C92 118, 97 108, 97 100 Z",
        hindLow: 148,
        hindOut: 44,
      };
    case "glasswing":
      // Narrow, elongated wings held close to the body.
      return {
        forewing: `M97 88 C93 ${58 - lift}, ${74 - reach} ${34 - lift}, ${58 - reach} ${
          32 - lift
        } C${46 - reach} 32, ${42 - reach} 48, 50 64 C60 80, 78 90, 97 92 Z`,
        hindwing:
          "M97 96 C86 96, 66 100, 58 112 C50 124, 54 140, 66 144 C78 148, 90 138, 94 124 C96 116, 97 106, 97 100 Z",
        hindLow: 144,
        hindOut: 58,
      };
    case "longwing":
      // Heliconius: long, slim forewing, small rounded hindwing.
      return {
        forewing: `M97 88 C92 ${52 - lift}, ${70 - reach} ${26 - lift}, ${50 - reach} ${
          24 - lift
        } C${40 - reach} 24, ${36 - reach} 40, 44 58 C54 76, 76 90, 97 92 Z`,
        hindwing:
          "M97 96 C88 96, 70 100, 62 110 C54 120, 58 134, 70 138 C82 142, 92 132, 95 120 C96 112, 97 104, 97 100 Z",
        hindLow: 138,
        hindOut: 62,
      };
    case "owl":
      // Caligo: broad, tall hindwing to carry large eyespots.
      return {
        forewing: `M97 88 C90 ${54 - lift}, ${64 - reach} ${32 - lift}, ${42 - reach} 34 C${
          28 - reach
        } 40, ${28 - reach} 60, 44 76 C60 90, 84 95, 97 92 Z`,
        hindwing:
          "M97 96 C78 94, 48 100, 38 118 C28 136, 38 158, 58 160 C78 162, 92 140, 96 118 C97 110, 97 104, 97 100 Z",
        hindLow: 160,
        hindOut: 38,
      };
    case "sulphur":
      // Compact, leaf-like rounded wings.
      return {
        forewing: `M97 88 C92 ${60 - lift}, ${68 - reach} ${38 - lift}, ${50 - reach} 40 C${
          38 - reach
        } 42, ${36 - reach} 60, 48 74 C62 88, 84 94, 97 92 Z`,
        hindwing:
          "M97 96 C82 95, 58 100, 50 112 C42 124, 48 140, 62 143 C76 146, 90 134, 94 120 C96 112, 97 105, 97 100 Z",
        hindLow: 143,
        hindOut: 50,
      };
    case "peacock":
    default:
      return {
        forewing: `M97 88 C90 ${52 - lift}, ${60 - reach} ${30 - lift}, ${40 - reach} 34 C${
          26 - reach
        } 40, ${28 - reach} 62, 44 78 C60 92, 84 96, 97 92 Z`,
        hindwing:
          "M97 96 C80 95, 52 100, 42 116 C32 132, 40 152, 58 153 C76 154, 90 136, 95 118 C96 110, 97 104, 97 100 Z",
        hindLow: 153,
        hindOut: 42,
      };
  }
}

function tailPaths(tail: WingTail, base: Base, tailLen: number): string[] {
  if (tail === "none") return [];
  const anchorX = base.hindOut + 8;
  const top = base.hindLow - 8;
  const drop = { short: 14, long: 30, twin: 22 }[tail] * (0.7 + tailLen * 0.6);
  if (tail === "twin") {
    return [
      `M${anchorX} ${top} C${anchorX - 3} ${top + drop * 0.6}, ${anchorX - 5} ${
        top + drop
      }, ${anchorX - 1} ${top + drop} C${anchorX + 2} ${top + drop * 0.6}, ${anchorX + 3} ${
        top + drop * 0.4
      }, ${anchorX + 4} ${top} Z`,
      `M${anchorX + 10} ${top - 2} C${anchorX + 8} ${top + drop * 0.55}, ${anchorX + 7} ${
        top + drop * 0.9
      }, ${anchorX + 11} ${top + drop * 0.9} C${anchorX + 14} ${top + drop * 0.55}, ${
        anchorX + 15
      } ${top + drop * 0.3}, ${anchorX + 16} ${top - 2} Z`,
    ];
  }
  return [
    `M${anchorX} ${top} C${anchorX - 4} ${top + drop * 0.6}, ${anchorX - 6} ${
      top + drop
    }, ${anchorX} ${top + drop} C${anchorX + 5} ${top + drop * 0.6}, ${anchorX + 6} ${
      top + drop * 0.35
    }, ${anchorX + 8} ${top} Z`,
  ];
}

function veinPaths(count: number, veinFan: number): string[] {
  // A fan of curves radiating from the body joint across both wings.
  const targets: Point[] = [
    { x: 42, y: 40 },
    { x: 40, y: 74 },
    { x: 50, y: 118 },
    { x: 62, y: 140 },
    { x: 34, y: 56 },
    { x: 46, y: 96 },
  ];
  const out: string[] = [];
  const n = Math.min(count, targets.length);
  for (let i = 0; i < n; i++) {
    const t = targets[i]!;
    const bend = 1 + veinFan * 0.4;
    const midX = 96 - (96 - t.x) * 0.55 * bend;
    const midY = 90 - (90 - t.y) * 0.5;
    out.push(`M96 90 C${midX} ${midY}, ${(96 + t.x) / 2} ${(90 + t.y) / 2}, ${t.x} ${t.y}`);
  }
  return out;
}

function bandPaths(count: number, base: Base, thickness: number): string[] {
  // Border-following bands near the outer margin of each wing.
  const out: string[] = [];
  if (count >= 1) out.push(base.forewing);
  if (count >= 2) out.push(base.hindwing);
  return out.map((d) => d);
  void thickness;
}

function jittered(p: Point, jitter: number, i: number): Point {
  const dx = ((((i * 37) % 11) - 5) / 5) * 3 * jitter;
  const dy = ((((i * 53) % 9) - 4) / 4) * 3 * jitter;
  return { x: p.x + dx, y: p.y + dy };
}

/**
 * Compose all render layers for a wing config. O(number of visible marks),
 * which is bounded by the complexity level, so compact marks stay cheap.
 */
export function buildWingRender(wing: WingConfig, variation: WingVariation): WingRender {
  const reach = 12 * variation.spread;
  const lift = 8 * variation.aspect;
  const base = familyBase(wing.family, reach, lift);
  const c = wing.complexity;

  const tails = tailPaths(wing.tail, base, variation.aspect);

  let veins: string[] = [];
  let bands: string[] = [];
  let spots: WingRender["spots"] = [];
  let eyespots: WingRender["eyespots"] = [];
  let clearPanels: string[] = [];

  const spotSlots: Point[] = [
    { x: 54, y: 128 },
    { x: 70, y: 118 },
    { x: 46, y: 116 },
    { x: 62, y: 138 },
    { x: 58, y: 104 },
    { x: 50, y: 96 },
  ];
  const eyespotSlots: Point[] = [
    { x: 56, y: 126 },
    { x: 70, y: 120 },
    { x: 48, y: 132 },
    { x: 62, y: 112 },
  ];

  switch (wing.pattern) {
    case "veined": {
      veins = veinPaths(2 + c, variation.veinFan);
      break;
    }
    case "banded": {
      bands = bandPaths(Math.min(2, c), base, variation.band);
      veins = veinPaths(Math.max(0, c - 1), variation.veinFan);
      break;
    }
    case "spotted": {
      const n = Math.min(spotSlots.length, 1 + c);
      spots = spotSlots.slice(0, n).map((p, i) => {
        const j = jittered(p, variation.jitter, i);
        return { x: j.x, y: j.y, r: 3 + (i % 2) };
      });
      veins = veinPaths(Math.max(0, c - 2), variation.veinFan);
      break;
    }
    case "eyespots": {
      const n = Math.min(eyespotSlots.length, 1 + Math.ceil(c / 1.5));
      eyespots = eyespotSlots.slice(0, n).map((p, i) => {
        const j = jittered(p, variation.jitter, i);
        return { x: j.x, y: j.y, r: 5 + (c >= 3 ? 1.5 : 0) };
      });
      veins = veinPaths(Math.max(0, c - 2), variation.veinFan);
      break;
    }
    case "clear": {
      // Translucent central panels; fewer marks keep them legible.
      clearPanels = [
        "M92 86 C84 74, 70 60, 58 56 C54 66, 58 78, 70 84 C78 88, 86 88, 92 86 Z",
        "M92 104 C82 106, 68 112, 62 122 C70 126, 82 122, 90 112 Z",
      ].slice(0, 1 + Math.min(1, c));
      veins = veinPaths(Math.max(1, c - 1), variation.veinFan);
      break;
    }
  }

  const edgeMarks = edgeTreatment(wing.edge, base, c);

  return { forewing: base.forewing, hindwing: base.hindwing, tails, veins, bands, spots, eyespots, clearPanels, edgeMarks };
}

function edgeTreatment(edge: WingEdge, base: Base, complexity: number): string[] {
  if (edge === "smooth") return [];
  // A short row of arcs (scalloped) or chevrons (angular) along the lower
  // outer margin of the hindwing. Count scales gently with complexity.
  const count = 3 + complexity;
  const startX = base.hindOut + 4;
  const endX = 92;
  const y = base.hindLow - 6;
  const step = (endX - startX) / count;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = startX + step * i;
    const yy = y - (i % 2) * 3;
    if (edge === "scalloped") {
      out.push(`M${x} ${yy} q${step / 2} 5, ${step} 0`);
    } else {
      out.push(`M${x} ${yy} l${step / 2} 4 l${step / 2} -4`);
    }
  }
  return out;
}
