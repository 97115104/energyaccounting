/**
 * The butterfly: EAJ's living mark of becoming.
 *
 * One SVG body plan, eight wing families, and composable edge / tail / pattern /
 * complexity traits, all resolved into flat render layers by butterflyGeometry.
 * The component only composes those layers; it holds no shape logic of its own,
 * so the same code serves onboarding previews, the You hero, exports, and the
 * compact header mark.
 *
 * Motion honors both the person's own setting and prefers-reduced-motion: when
 * either says still, the wings hold a calm open pose and the state stays legible
 * through the label and vitality ring rendered by callers.
 */

import type { CSSProperties } from "react";
import { useId } from "react";
import { buildWingRender } from "../lib/butterflyGeometry";
import type { IdentityConfig } from "../lib/identity";
import { wingVariation } from "../lib/identity";

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
  const geo = buildWingRender(identity.wing, variation);
  const { primary, secondary, accent } = identity.palette;
  const seedKey = identity.seed.replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = `bf-${instanceId}-${seedKey}-${identity.wing.family}`;
  const clipId = `${gradientId}-clip`;
  const animated = beatMs != null && beatMs > 0;
  // Angular edges keep their crisp corners; everything else rounds gently.
  const joins = identity.wing.edge === "angular" ? ("miter" as const) : ("round" as const);
  const wingStyle: CSSProperties | undefined = animated
    ? ({ "--beat": `${beatMs}ms` } as CSSProperties)
    : undefined;
  // Rainbow theme: the whole mark drifts through the hue wheel. A person who
  // chose "still" keeps the resting colors; prefers-reduced-motion is handled
  // in CSS. "calm" halves the drift speed.
  const rainbow = identity.palette.rainbow === true && identity.motion !== "still";
  const rainbowStyle: CSSProperties | undefined = rainbow
    ? ({ "--rainbow-period": identity.motion === "calm" ? "48s" : "24s" } as CSSProperties)
    : undefined;

  const wing = (
    <g>
      {geo.tails.map((d, i) => (
        <path
          key={`t${i}`}
          d={d}
          fill={`url(#${gradientId}-hind)`}
          stroke={accent}
          strokeWidth="1.6"
          strokeLinejoin={joins}
        />
      ))}
      <path
        d={geo.forewing}
        fill={`url(#${gradientId}-fore)`}
        stroke={accent}
        strokeWidth="2"
        strokeLinejoin={joins}
      />
      <path
        d={geo.hindwing}
        fill={`url(#${gradientId}-hind)`}
        stroke={accent}
        strokeWidth="2"
        strokeLinejoin={joins}
      />
      {/* Interior marks are clipped to the wing so veins and spots never poke
          past the silhouette on narrow families. */}
      <g clipPath={`url(#${clipId})`}>
        {geo.clearPanels.map((d, i) => (
          <path key={`c${i}`} d={d} fill="#ffffff" opacity="0.4" stroke="none" />
        ))}
        {geo.bands.map((d, i) => (
          <path
            key={`b${i}`}
            d={d}
            fill="none"
            stroke={secondary}
            strokeWidth={2.5 + variation.band * 3.5}
            strokeLinejoin="round"
            opacity="0.35"
          />
        ))}
        {geo.veins.map((d, i) => (
          <path
            key={`v${i}`}
            d={d}
            fill="none"
            stroke={accent}
            strokeWidth="1.1"
            strokeLinecap="round"
            opacity="0.55"
          />
        ))}
        {geo.spots.map((s, i) => (
          <circle key={`s${i}`} cx={s.x} cy={s.y} r={s.r} fill={accent} opacity="0.8" />
        ))}
        {geo.eyespots.map((s, i) => (
          <g key={`ey${i}`}>
            <circle cx={s.x} cy={s.y} r={s.r} fill={accent} opacity="0.85" />
            <circle cx={s.x} cy={s.y} r={s.r * 0.5} fill={primary} opacity="0.95" />
            <circle cx={s.x} cy={s.y} r={s.r * 0.2} fill="#ffffff" opacity="0.9" />
          </g>
        ))}
      </g>
    </g>
  );

  return (
    <svg
      viewBox="0 0 200 210"
      width={size}
      height={size}
      className={[className, rainbow ? "butterfly-rainbow" : null].filter(Boolean).join(" ") || undefined}
      style={rainbowStyle}
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
        <clipPath id={clipId}>
          <path d={geo.forewing} />
          <path d={geo.hindwing} />
          {geo.tails.map((d, i) => (
            <path key={`ct${i}`} d={d} />
          ))}
        </clipPath>
      </defs>
      {/* Left wing beats around the body axis; right is the mirror. The mirror
          lives on an outer group because the CSS beat animation owns the inner
          group's transform and would overwrite an inline one. */}
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
