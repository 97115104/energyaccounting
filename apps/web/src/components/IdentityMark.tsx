/**
 * IdentityMark and NeuroMe: the compact external identity surfaces.
 *
 * IdentityMark draws the person's chosen symbol (butterfly, rainbow infinity,
 * gold infinity, rainbow pride). NeuroMe wraps a mark in the circular seal
 * used on the header, login return, and shares: symbol in the middle,
 * vitality ring around it when a daily state is known.
 */

import type { CSSProperties } from "react";
import type { ButterflyState } from "../lib/butterflyState";
import type { IdentityConfig, IdentitySymbol } from "../lib/identity";
import { symbolMeta } from "../lib/identity";
import { Butterfly } from "./Butterfly";

// Six-band pride palette, also the rainbow-infinity gradient stops.
const RAINBOW = ["#d1273b", "#e8853a", "#e5c33a", "#2f8f4e", "#3563b0", "#7a4a9e"];

const INFINITY_PATH =
  "M22 50 C22 33, 42 33, 50 50 C58 67, 78 67, 78 50 C78 33, 58 33, 50 50 C42 67, 22 67, 22 50 Z";

function InfinitySymbol({ gradientId, gold }: { gradientId: string; gold: boolean }) {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          {gold ? (
            <>
              <stop offset="0%" stopColor="#f0b429" />
              <stop offset="55%" stopColor="#c98a1a" />
              <stop offset="100%" stopColor="#8a5a10" />
            </>
          ) : (
            RAINBOW.map((c, i) => (
              <stop key={c} offset={`${(i / (RAINBOW.length - 1)) * 100}%`} stopColor={c} />
            ))
          )}
        </linearGradient>
      </defs>
      <path
        d={INFINITY_PATH}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RainbowPrideSymbol() {
  // A rising arc: six concentric bands, calm and unmistakable.
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      {RAINBOW.map((color, i) => {
        const r = 40 - i * 5;
        return (
          <path
            key={color}
            d={`M${50 - r} 72 A${r} ${r} 0 0 1 ${50 + r} 72`}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

type MarkProps = {
  identity: IdentityConfig;
  /** Which symbol to draw; defaults to the person's chosen external symbol. */
  symbol?: IdentitySymbol;
  size?: number;
  className?: string;
  decorative?: boolean;
};

export function IdentityMark({ identity, symbol, size = 40, className, decorative }: MarkProps) {
  const which = symbol ?? identity.symbol;
  const label = symbolMeta(which).label;
  const gradientId = `mark-${which}-${identity.seed.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const box: CSSProperties = { width: size, height: size, display: "inline-block" };
  if (which === "butterfly") {
    return (
      <span className={className} style={box} {...(decorative ? { "aria-hidden": true as const } : {})}>
        <Butterfly identity={identity} beatMs={null} size={size} title={decorative ? undefined : label} decorative={decorative} />
      </span>
    );
  }
  return (
    <span
      className={className}
      style={box}
      {...(decorative
        ? { "aria-hidden": true as const }
        : { role: "img" as const, "aria-label": label })}
    >
      {which === "rainbow-infinity" && <InfinitySymbol gradientId={gradientId} gold={false} />}
      {which === "gold-infinity" && <InfinitySymbol gradientId={gradientId} gold={true} />}
      {which === "rainbow-pride" && <RainbowPrideSymbol />}
    </span>
  );
}

type NeuroMeProps = {
  identity: IdentityConfig;
  /** Daily state adds the vitality ring; omit it for a plain seal. */
  state?: ButterflyState | null;
  size?: number;
  className?: string;
  /** When nested inside a named control, hide from the accessibility tree. */
  decorative?: boolean;
};

/**
 * The NeuroMe seal: chosen symbol inside a soft circle, with a vitality ring
 * showing today's remaining energy. Ring meaning is duplicated in text by
 * callers (label + points), so color and geometry are never the only carrier.
 */
export function NeuroMe({
  identity,
  state = null,
  size = 44,
  className,
  decorative = false,
}: NeuroMeProps) {
  const ring = 3;
  const r = size / 2 - ring;
  const circumference = 2 * Math.PI * r;
  const filled = state ? circumference * state.vitality : 0;
  const label = state
    ? `Your mark. Today: ${state.label.toLowerCase()}, ${Math.round(state.vitality * 100)}% energy remaining.`
    : "Your mark";
  return (
    <span
      className={`neurome-seal ${className ?? ""}`}
      style={{ width: size, height: size }}
      {...(decorative
        ? { "aria-hidden": true as const }
        : { role: "img" as const, "aria-label": label })}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        {/* Backing disc follows the sky theme (--bg0) so the seal sits in the
            page instead of punching a white hole in it. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="neurome-disc"
          strokeWidth="1"
        />
        {state && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={identity.palette.primary}
            strokeWidth={ring}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference - filled}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <span className="neurome-symbol" style={{ inset: ring + 2 }}>
        <IdentityMark identity={identity} size={size - (ring + 2) * 2} decorative />
      </span>
    </span>
  );
}
