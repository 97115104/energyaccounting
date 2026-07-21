/**
 * Butterfly wing geometry: a small visual grammar, not a pile of one-off SVGs.
 *
 * Diversity comes from combining independent traits, the same way neurodivergent
 * people are diverse: a wing family sets the silhouette, then edge, tail,
 * pattern, and complexity layer on top. Everything is pure and deterministic so
 * the same config draws the same butterfly on every device and can be unit
 * tested without a DOM.
 *
 * Silhouettes are landmark polylines, not hand-tuned Bézier soup: each family
 * lists the points a wing outline passes through, plus which stretch of it is
 * the outer margin. The edge trait then decides how that margin is drawn into
 * the FILLED path (flowing spline, straight facets, or scallop lobes), so
 * choosing "angular" visibly changes the silhouette instead of overlaying
 * decorative strokes.
 *
 * Coordinate system: a 200-wide box with the body on x=100. Every outline is
 * drawn for the LEFT wing (x < 100); the component mirrors it for the right.
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

/**
 * One wing outline: ordered landmarks from the upper body root around the tip
 * and back to the lower body root, plus the segment span [from, to) that forms
 * the outer margin and receives the edge treatment.
 */
export type WingOutline = {
  points: Point[];
  margin: [number, number];
};

/** Both outlines of a family's left wing, exported so tests can measure them. */
export type FamilySilhouette = { fore: WingOutline; hind: WingOutline };

export type WingRender = {
  forewing: string;
  hindwing: string;
  /** Tail paths blended into the hindwing, or empty when tailless. */
  tails: string[];
  veins: string[];
  bands: string[];
  spots: { x: number; y: number; r: number }[];
  eyespots: { x: number; y: number; r: number }[];
  /** Lighter "clear" panels for glasswing-style wings. */
  clearPanels: string[];
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
// Landmarks per family. `reach` (from spread) pushes the wingtips outward;
// `lift` (from aspect) raises the forewing apex. Proportions are the family's
// identity: monarch is a broad triangle, longwing a slim blade, owl carries a
// deep hindwing, and so on.

/**
 * The left-wing silhouette for a family. Exported for tests, which assert real
 * geometric differences (reach, depth) instead of comparing path strings.
 */
export function familySilhouette(
  family: WingFamily,
  reach: number,
  lift: number,
): FamilySilhouette {
  switch (family) {
    case "monarch":
      // Danaus plexippus: broad rounded-triangular forewing sweeping up to a
      // soft apex, full but compact hindwing. The classic emoji silhouette.
      return {
        fore: {
          points: [
            { x: 97, y: 88 },
            { x: 88, y: 62 },
            { x: 66 - reach, y: 34 - lift },
            { x: 40 - reach, y: 28 - lift },
            { x: 30 - reach, y: 44 },
            { x: 36, y: 62 },
            { x: 52, y: 78 },
            { x: 78, y: 88 },
            { x: 97, y: 92 },
          ],
          margin: [3, 7],
        },
        hind: {
          points: [
            { x: 97, y: 96 },
            { x: 72, y: 96 },
            { x: 52, y: 104 },
            { x: 40, y: 120 },
            { x: 44, y: 138 },
            { x: 58, y: 148 },
            { x: 78, y: 142 },
            { x: 92, y: 124 },
            { x: 97, y: 100 },
          ],
          margin: [3, 7],
        },
      };
    case "morpho":
      // Wide, almost circular span: broad forewing and a big round hindwing.
      return {
        fore: {
          points: [
            { x: 97, y: 88 },
            { x: 84, y: 58 },
            { x: 62 - reach, y: 32 - lift },
            { x: 36 - reach, y: 28 - lift },
            { x: 20 - reach, y: 44 },
            { x: 18 - reach, y: 64 },
            { x: 32, y: 82 },
            { x: 60, y: 90 },
            { x: 97, y: 92 },
          ],
          margin: [3, 7],
        },
        hind: {
          points: [
            { x: 97, y: 96 },
            { x: 66, y: 96 },
            { x: 40, y: 106 },
            { x: 28, y: 126 },
            { x: 34, y: 148 },
            { x: 54, y: 158 },
            { x: 76, y: 150 },
            { x: 90, y: 132 },
            { x: 97, y: 104 },
          ],
          margin: [3, 7],
        },
      };
    case "swallowtail":
      // Swept, pointed forewing and a hindwing that narrows toward the tail
      // lobe. Its default angular edge keeps the facets crisp.
      return {
        fore: {
          points: [
            { x: 97, y: 88 },
            { x: 80, y: 60 },
            { x: 54 - reach, y: 36 - lift },
            { x: 26 - reach, y: 26 - lift },
            { x: 34, y: 50 },
            { x: 44, y: 68 },
            { x: 68, y: 84 },
            { x: 97, y: 92 },
          ],
          margin: [3, 6],
        },
        hind: {
          points: [
            { x: 97, y: 96 },
            { x: 74, y: 98 },
            { x: 54, y: 106 },
            { x: 42, y: 122 },
            { x: 46, y: 136 },
            { x: 54, y: 146 },
            { x: 68, y: 140 },
            { x: 82, y: 128 },
            { x: 92, y: 114 },
            { x: 97, y: 100 },
          ],
          margin: [3, 8],
        },
      };
    case "glasswing":
      // Narrow, elongated wings held close to the body; the tips stay well
      // inside where broader families reach (half-strength spread).
      return {
        fore: {
          points: [
            { x: 97, y: 88 },
            { x: 86, y: 64 },
            { x: 72 - reach * 0.5, y: 42 - lift },
            { x: 58 - reach * 0.5, y: 30 - lift },
            { x: 48, y: 40 },
            { x: 52, y: 58 },
            { x: 66, y: 76 },
            { x: 84, y: 88 },
            { x: 97, y: 92 },
          ],
          margin: [3, 6],
        },
        hind: {
          points: [
            { x: 97, y: 96 },
            { x: 80, y: 98 },
            { x: 66, y: 106 },
            { x: 58, y: 120 },
            { x: 62, y: 134 },
            { x: 74, y: 140 },
            { x: 86, y: 132 },
            { x: 93, y: 118 },
            { x: 97, y: 102 },
          ],
          margin: [3, 6],
        },
      };
    case "longwing":
      // Heliconius: a long slim forewing blade angled far up and out, with a
      // small round hindwing tucked beneath.
      return {
        fore: {
          points: [
            { x: 97, y: 88 },
            { x: 82, y: 70 },
            { x: 52 - reach, y: 40 - lift },
            { x: 24 - reach, y: 24 - lift },
            { x: 18 - reach, y: 34 },
            { x: 38, y: 56 },
            { x: 64, y: 78 },
            { x: 97, y: 92 },
          ],
          margin: [3, 6],
        },
        hind: {
          points: [
            { x: 97, y: 96 },
            { x: 80, y: 98 },
            { x: 62, y: 102 },
            { x: 52, y: 114 },
            { x: 56, y: 130 },
            { x: 72, y: 138 },
            { x: 88, y: 130 },
            { x: 96, y: 114 },
            { x: 97, y: 102 },
          ],
          margin: [3, 6],
        },
      };
    case "owl":
      // Caligo: a modest forewing over a deep, tall hindwing built to carry
      // large eyespots. The hindwing dominates the silhouette.
      return {
        fore: {
          points: [
            { x: 97, y: 88 },
            { x: 86, y: 62 },
            { x: 66 - reach, y: 38 - lift },
            { x: 46 - reach, y: 34 - lift },
            { x: 34, y: 48 },
            { x: 38, y: 68 },
            { x: 56, y: 84 },
            { x: 80, y: 91 },
            { x: 97, y: 92 },
          ],
          margin: [3, 6],
        },
        hind: {
          points: [
            { x: 97, y: 96 },
            { x: 72, y: 96 },
            { x: 50, y: 104 },
            { x: 38, y: 122 },
            { x: 36, y: 144 },
            { x: 46, y: 160 },
            { x: 66, y: 164 },
            { x: 84, y: 152 },
            { x: 94, y: 130 },
            { x: 97, y: 104 },
          ],
          margin: [3, 8],
        },
      };
    case "sulphur":
      // Compact, leaf-like wings: a pointed forewing apex and a hindwing that
      // tapers to a soft leaf tip.
      return {
        fore: {
          points: [
            { x: 97, y: 88 },
            { x: 84, y: 64 },
            { x: 64 - reach, y: 44 - lift },
            { x: 46 - reach, y: 36 - lift },
            { x: 38, y: 52 },
            { x: 46, y: 70 },
            { x: 66, y: 82 },
            { x: 86, y: 90 },
            { x: 97, y: 92 },
          ],
          margin: [3, 6],
        },
        hind: {
          points: [
            { x: 97, y: 96 },
            { x: 76, y: 97 },
            { x: 58, y: 104 },
            { x: 48, y: 118 },
            { x: 52, y: 132 },
            { x: 62, y: 142 },
            { x: 76, y: 137 },
            { x: 89, y: 125 },
            { x: 96, y: 111 },
            { x: 97, y: 102 },
          ],
          margin: [3, 7],
        },
      };
    case "peacock":
    default:
      // Aglais io: broad wings whose outer margins carry built-in notches and
      // lobes; the scalloped default edge deepens them further.
      return {
        fore: {
          points: [
            { x: 97, y: 88 },
            { x: 82, y: 58 },
            { x: 58 - reach, y: 32 - lift },
            { x: 34 - reach, y: 30 - lift },
            { x: 26, y: 44 },
            { x: 36, y: 54 },
            { x: 30, y: 66 },
            { x: 44, y: 78 },
            { x: 68, y: 88 },
            { x: 97, y: 92 },
          ],
          margin: [3, 8],
        },
        hind: {
          points: [
            { x: 97, y: 96 },
            { x: 70, y: 96 },
            { x: 46, y: 104 },
            { x: 34, y: 122 },
            { x: 42, y: 136 },
            { x: 36, y: 148 },
            { x: 52, y: 155 },
            { x: 70, y: 148 },
            { x: 86, y: 134 },
            { x: 94, y: 116 },
            { x: 97, y: 100 },
          ],
          margin: [3, 9],
        },
      };
  }
}

// --- Outline serialization --------------------------------------------------
// Landmarks become one filled path. Inner and leading edges always flow as a
// Catmull-Rom spline (real wings hinge smoothly at the body); the outer margin
// obeys the edge trait: spline (smooth), straight facets (angular), or
// outward scallop lobes (scalloped).

const r = (n: number) => Math.round(n * 10) / 10;

function catmullControls(pts: Point[], i: number): [Point, Point] {
  const p0 = pts[Math.max(0, i - 1)]!;
  const p1 = pts[i]!;
  const p2 = pts[i + 1]!;
  const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
  return [
    { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
  ];
}

/** Scallop lobes along one margin segment, bulging away from the wing center. */
function scallopSegment(a: Point, b: Point, cx: number, cy: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const lobes = len >= 26 ? 2 : 1;
  let nx = dy / len;
  let ny = -dx / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // Flip the normal if it points into the wing rather than out of it.
  if (nx * (mx - cx) + ny * (my - cy) < 0) {
    nx = -nx;
    ny = -ny;
  }
  const depth = 5;
  let d = "";
  for (let i = 0; i < lobes; i++) {
    const qx = a.x + dx * ((i + 0.5) / lobes) + nx * depth;
    const qy = a.y + dy * ((i + 0.5) / lobes) + ny * depth;
    const ex = a.x + dx * ((i + 1) / lobes);
    const ey = a.y + dy * ((i + 1) / lobes);
    d += ` Q${r(qx)} ${r(qy)}, ${r(ex)} ${r(ey)}`;
  }
  return d;
}

function outlinePath(outline: WingOutline, edge: WingEdge): string {
  const pts = outline.points;
  const [mFrom, mTo] = outline.margin;
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let d = `M${r(pts[0]!.x)} ${r(pts[0]!.y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const b = pts[i + 1]!;
    const onMargin = i >= mFrom && i < mTo;
    if (onMargin && edge === "angular") {
      d += ` L${r(b.x)} ${r(b.y)}`;
    } else if (onMargin && edge === "scalloped") {
      d += scallopSegment(pts[i]!, b, cx, cy);
    } else {
      const [c1, c2] = catmullControls(pts, i);
      d += ` C${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(b.x)} ${r(b.y)}`;
    }
  }
  return `${d} Z`;
}

// --- Tails -------------------------------------------------------------------

/**
 * Tail streamers anchor on real hindwing landmarks and start a few units above
 * them, so the join disappears under the shared fill and reads as one wing.
 * Twin uses the two deepest landmarks: the deepest carries the primary tail,
 * the next-deepest carries the shorter second streamer.
 */
function tailPaths(tail: WingTail, hind: WingOutline, tailLen: number): string[] {
  if (tail === "none") return [];
  const byDepth = [...hind.points].sort((a, b) => b.y - a.y);
  const anchor = byDepth[0]!;
  const second = byDepth[1] ?? anchor;
  const drop = { short: 16, long: 34, twin: 24 }[tail] * (0.75 + tailLen * 0.5);
  const streamer = (x: number, y: number, len: number, halfW: number) =>
    `M${r(x - halfW)} ${r(y)} C${r(x - halfW - 2)} ${r(y + len * 0.45)}, ${r(
      x - halfW * 0.6,
    )} ${r(y + len * 0.85)}, ${r(x - 2)} ${r(y + len)} C${r(x + 1)} ${r(y + len * 0.7)}, ${r(
      x + halfW * 0.6,
    )} ${r(y + len * 0.35)}, ${r(x + halfW)} ${r(y)} Z`;
  if (tail === "twin") {
    return [
      streamer(anchor.x, anchor.y - 4, drop, 5),
      streamer(second.x, second.y - 4, drop * 0.7, 4),
    ];
  }
  return [streamer(anchor.x, anchor.y - 4, drop, 6)];
}

// --- Interior marks ----------------------------------------------------------

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
  const sil = familySilhouette(wing.family, reach, lift);
  const c = wing.complexity;

  const forewing = outlinePath(sil.fore, wing.edge);
  const hindwing = outlinePath(sil.hind, wing.edge);
  const tails = tailPaths(wing.tail, sil.hind, variation.aspect);

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
      // Border-following bands: stroke the outlines themselves, clipped inside.
      bands = [forewing, hindwing].slice(0, Math.min(2, c));
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

  return { forewing, hindwing, tails, veins, bands, spots, eyespots, clearPanels };
}
