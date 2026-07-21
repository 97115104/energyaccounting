/**
 * The butterfly: EAJ's living mark of becoming.
 *
 * One SVG body plan, three archetypes, deterministic per-person variation from
 * the identity seed, and a wing beat whose tempo follows the day's energy.
 * Everything renders from IdentityConfig plus an optional ButterflyState, so
 * the same component serves onboarding previews, the You page hero, exports,
 * and the compact header mark.
 *
 * Motion honors both the person's own setting and prefers-reduced-motion:
 * when either says still, the wings hold a calm open pose and the state is
 * still legible through the label and vitality ring rendered by callers.
 */

import type { CSSProperties } from "react";
import { useId } from "react";
import type { ButterflyArchetype, IdentityConfig } from "../lib/identity";
import { wingVariation } from "../lib/identity";

type WingGeometry = {
  /** Upper (fore) wing outline, drawn for the left side; right is mirrored. */
  forewing: string;
  /** Lower (hind) wing outline for the left side. */
  hindwing: string;
  /** Vein strokes inside the wings. */
  veins: string[];
  /** Eyespot centers on the hindwing, used up to the variation's count. */
  eyespotCenters: { x: number; y: number }[];
};

/**
 * Wing outlines per archetype, parameterized by the deterministic variation.
 * Coordinates live in a 200x200 box with the body on x=100; the left wing
 * draws in x<100 and the right wing is the same geometry mirrored.
 */
function geometryFor(
  archetype: ButterflyArchetype,
  spread: number,
  tail: number,
): WingGeometry {
  // spread widens the wingtip reach; kept subtle so every result stays elegant.
  const reach = 12 * spread;
  if (archetype === "swallowtail") {
    const tailDrop = 26 + 16 * tail;
    return {
      forewing: `M97 88 C86 52, ${54 - reach} 30, ${34 - reach} 36 C${20 - reach} 41, ${
        22 - reach
      } 62, 38 78 C56 94, 82 96, 97 92 Z`,
      hindwing: `M97 96 C80 96, 52 102, 42 116 C32 130, 40 146, 52 148 C58 ${
        148 + tailDrop * 0.35
      }, 54 ${150 + tailDrop}, 62 ${152 + tailDrop} C70 ${148 + tailDrop * 0.55}, 72 140, 80 130 C88 120, 96 110, 97 100 Z`,
      veins: [
        `M96 90 C78 74, ${58 - reach} 52, ${40 - reach} 42`,
        "M96 92 C76 84, 58 82, 44 82",
        "M96 98 C80 104, 62 112, 52 122",
        "M96 100 C84 110, 76 122, 66 136",
      ],
      eyespotCenters: [
        { x: 56, y: 132 },
        { x: 70, y: 118 },
        { x: 48, y: 118 },
      ],
    };
  }
  if (archetype === "monarch") {
    // Monarch: long, swept forewing with an angular apex held high, over a
    // compact rounded hindwing. Reads as a diagonal, athletic silhouette.
    return {
      forewing: `M97 88 C88 66, ${62 - reach} 32, ${38 - reach} 26 C${26 - reach} 23, ${
        20 - reach
      } 34, ${28 - reach} 44 C${40 - reach} 60, 56 76, 70 85 C80 91, 90 93, 97 92 Z`,
      hindwing:
        "M97 96 C84 94, 62 98, 52 108 C42 118, 44 136, 56 142 C68 148, 84 140, 92 126 C95 118, 97 106, 97 100 Z",
      veins: [
        `M96 90 C82 72, ${60 - reach} 44, ${40 - reach} 32`,
        `M96 90 C80 78, ${62 - reach} 60, ${48 - reach} 48`,
        "M96 92 C82 88, 70 84, 60 76",
        "M96 98 C82 102, 68 108, 58 118",
        "M96 102 C86 112, 76 124, 66 134",
      ],
      eyespotCenters: [
        { x: 60, y: 120 },
        { x: 72, y: 114 },
        { x: 64, y: 132 },
      ],
    };
  }
  // Morpho: very broad, round wings that nearly close into a disc, with the
  // hindwing dropping lower and wider than any other base.
  return {
    forewing: `M97 88 C92 56, ${70 - reach} 30, ${44 - reach} 30 C${24 - reach} 30, ${
      14 - reach
    } 46, ${18 - reach} 62 C${24 - reach} 78, 42 87, 62 90 C76 92, 88 93, 97 92 Z`,
    hindwing:
      "M97 96 C80 94, 52 98, 40 112 C30 124, 34 146, 52 154 C70 161, 90 148, 95 128 C96 120, 97 104, 97 100 Z",
    veins: [
      `M96 90 C78 68, ${58 - reach} 46, ${38 - reach} 40`,
      `M96 92 C72 82, ${48 - reach} 74, ${28 - reach} 62`,
      "M96 92 C74 90, 56 88, 42 84",
      "M96 98 C76 102, 56 112, 46 126",
      "M96 102 C84 116, 74 132, 64 146",
    ],
    eyespotCenters: [
      { x: 56, y: 130 },
      { x: 72, y: 120 },
      { x: 46, y: 122 },
    ],
  };
}

type Props = {
  identity: IdentityConfig;
  /** Wing-beat period in ms; null renders a still, open pose. */
  beatMs?: number | null;
  /** Pixel size of the square SVG. */
  size?: number;
  /** Accessible name; defaults to a plain description. */
  title?: string;
  className?: string;
  /** Hide from the accessibility tree when nested inside a named control. */
  decorative?: boolean;
};

export function Butterfly({
  identity,
  beatMs = null,
  size = 160,
  title,
  className,
  decorative = false,
}: Props) {
  const instanceId = useId().replace(/:/g, "");
  const variation = wingVariation(identity.seed);
  const geometry = geometryFor(identity.archetype, variation.spread, variation.tail);
  const { primary, secondary, accent } = identity.palette;
  const gradientId = `bf-${instanceId}-${identity.seed.replace(/[^a-zA-Z0-9_-]/g, "")}-${identity.archetype}`;
  const animated = beatMs != null && beatMs > 0;
  const wingStyle: CSSProperties | undefined = animated
    ? ({ "--beat": `${beatMs}ms` } as CSSProperties)
    : undefined;

  const wing = (
    <g>
      <path d={geometry.forewing} fill={`url(#${gradientId}-fore)`} stroke={accent} strokeWidth="2" strokeLinejoin="round" />
      <path d={geometry.hindwing} fill={`url(#${gradientId}-hind)`} stroke={accent} strokeWidth="2" strokeLinejoin="round" />
      {geometry.veins.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={accent} strokeWidth="1.1" strokeLinecap="round" opacity="0.55" />
      ))}
      {geometry.eyespotCenters.slice(0, variation.eyespots).map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r={4.6} fill={accent} opacity="0.85" />
          <circle cx={c.x} cy={c.y} r={2.2} fill={primary} opacity="0.9" />
        </g>
      ))}
      {/* Pattern band along the forewing edge; thickness is per-person. */}
      <path
        d={geometry.forewing}
        fill="none"
        stroke={secondary}
        strokeWidth={2.5 + variation.band * 3.5}
        strokeLinejoin="round"
        opacity="0.35"
      />
    </g>
  );

  return (
    <svg
      viewBox="0 0 200 204"
      width={size}
      height={size}
      className={className}
      {...(decorative
        ? { "aria-hidden": true as const }
        : { role: "img" as const, "aria-label": title ?? "Your butterfly" })}
    >
      <defs>
        <linearGradient id={`${gradientId}-fore`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={primary} />
          <stop offset="100%" stopColor={secondary} />
        </linearGradient>
        <linearGradient id={`${gradientId}-hind`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={secondary} />
          <stop offset="100%" stopColor={primary} />
        </linearGradient>
      </defs>
      {/* Left wing beats around the body axis; right is the mirror. The
          mirror lives on an outer group because the CSS beat animation owns
          the inner group's transform and would overwrite an inline one. */}
      <g className={animated ? "butterfly-wing" : undefined} style={wingStyle}>
        {wing}
      </g>
      <g transform="scale(-1,1) translate(-200,0)">
        <g className={animated ? "butterfly-wing" : undefined} style={wingStyle}>
          {wing}
        </g>
      </g>
      {/* Body, head, antennae: always still, so the mark reads calm. */}
      <g className={animated ? "butterfly-body" : undefined} style={wingStyle}>
        <ellipse cx="100" cy="108" rx="5" ry="26" fill={accent} />
        <circle cx="100" cy="76" r="7" fill={accent} />
        <path d="M97 71 C90 58, 84 52, 78 48" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" />
        <path d="M103 71 C110 58, 116 52, 122 48" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" />
        <circle cx="78" cy="48" r="2.4" fill={accent} />
        <circle cx="122" cy="48" r="2.4" fill={accent} />
      </g>
    </svg>
  );
}
