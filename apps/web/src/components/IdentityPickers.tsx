/**
 * Controlled identity pickers shared by onboarding and the You page.
 *
 * Each picker takes a value and an onChange and holds no persistence logic, so
 * onboarding can save on finish while You saves immediately. Wing details are
 * kept compatible with the chosen family through normalizeWing.
 */

import { Butterfly } from "./Butterfly";
import { IdentityMark } from "./IdentityMark";
import {
  ARCHETYPES,
  SYMBOLS,
  compatibleTraits,
  normalizeIdentity,
  type ButterflyArchetype,
  type IdentityConfig,
  type IdentitySymbol,
} from "../lib/identity";
import {
  WING_EDGES,
  normalizeWing,
  type WingConfig,
  type WingEdge,
} from "../lib/butterflyGeometry";

export function SymbolPicker({
  identity,
  value,
  onChange,
}: {
  identity: IdentityConfig;
  value: IdentitySymbol;
  onChange: (symbol: IdentitySymbol) => void;
}) {
  return (
    <div className="you-symbol-grid" role="radiogroup" aria-label="External symbol">
      {SYMBOLS.map((s) => (
        <label key={s.id} className={`you-symbol-card${value === s.id ? " selected" : ""}`}>
          <input
            type="radio"
            name="you-symbol"
            value={s.id}
            checked={value === s.id}
            onChange={() => onChange(s.id)}
          />
          <span className="you-symbol-art">
            <IdentityMark identity={identity} symbol={s.id} size={44} decorative />
          </span>
          <span className="you-symbol-name">{s.label}</span>
          <span className="you-symbol-blurb muted">{s.blurb}</span>
        </label>
      ))}
    </div>
  );
}

export function WingFamilyPicker({
  identity,
  value,
  onChange,
  suggestPalettes = false,
  /** Compact row cards for tight surfaces (onboarding slide). */
  compact = false,
  /**
   * Thumbnail grid for onboarding: names only in a 2×4 layout, with the
   * selected family's blurb shown once under the grid (progressive disclosure).
   */
  density = "default" as "default" | "compact" | "thumbnails",
  /** Radio input name; unique when multiple pickers could share a page. */
  name = "you-archetype",
}: {
  identity: IdentityConfig;
  value: ButterflyArchetype;
  onChange: (family: ButterflyArchetype) => void;
  /** Preview each family in its suggested palette (onboarding, where the
      palette is chosen together with the family). */
  suggestPalettes?: boolean;
  compact?: boolean;
  density?: "default" | "compact" | "thumbnails";
  name?: string;
}) {
  // compact remains supported for older call sites; thumbnails win when set.
  const mode = density === "default" && compact ? "compact" : density;
  const artSize = mode === "thumbnails" ? 44 : mode === "compact" ? 52 : 64;
  const selected = ARCHETYPES.find((a) => a.id === value) ?? ARCHETYPES[0]!;
  const gridClass =
    mode === "thumbnails"
      ? "you-symbol-grid you-symbol-grid--thumbs"
      : mode === "compact"
        ? "you-symbol-grid you-symbol-grid--compact"
        : "you-symbol-grid";

  return (
    <div className={mode === "thumbnails" ? "ob-wing-pick" : undefined}>
      <div className={gridClass} role="radiogroup" aria-label="Wing family">
        {ARCHETYPES.map((a) => (
          <label key={a.id} className={`you-symbol-card${value === a.id ? " selected" : ""}`}>
            <input
              type="radio"
              name={name}
              value={a.id}
              checked={value === a.id}
              onChange={() => onChange(a.id)}
            />
            <span className="you-symbol-art">
              <Butterfly
                identity={{
                  ...identity,
                  archetype: a.id,
                  wing: normalizeWing(a.id, identity.wing),
                  ...(suggestPalettes ? { palette: { ...a.palette } } : {}),
                }}
                beatMs={null}
                size={artSize}
                decorative
              />
            </span>
            <span className="you-symbol-copy">
              <span className="you-symbol-name">{a.label}</span>
              {mode !== "thumbnails" && (
                <span className="you-symbol-blurb muted">{a.blurb}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      {mode === "thumbnails" && (
        <p className="ob-family-blurb muted">
          <strong>{selected.label}.</strong> {selected.blurb}
        </p>
      )}
    </div>
  );
}

const EDGE_LABEL: Record<WingEdge, string> = {
  smooth: "Smooth",
  scalloped: "Scalloped",
  angular: "Angular",
};

const TAIL_LABEL: Record<string, string> = {
  none: "None",
  short: "Short",
  long: "Long",
  twin: "Twin",
};

const PATTERN_LABEL: Record<string, string> = {
  veined: "Veined",
  banded: "Banded",
  spotted: "Spotted",
  eyespots: "Eyespots",
  clear: "Clear panels",
};

/** Advanced wing morphology, kept off the calm onboarding path. */
export function WingDetails({
  wing,
  onChange,
}: {
  wing: WingConfig;
  onChange: (wing: WingConfig) => void;
}) {
  const compat = compatibleTraits(wing.family);
  const set = (patch: Partial<WingConfig>) =>
    onChange(normalizeWing(wing.family, { ...wing, ...patch }));

  return (
    <div className="wing-details">
      <div className="field">
        <label htmlFor="wing-edge">Edge</label>
        <select
          id="wing-edge"
          value={wing.edge}
          onChange={(e) => set({ edge: e.target.value as WingEdge })}
        >
          {WING_EDGES.map((edge) => (
            <option key={edge} value={edge}>
              {EDGE_LABEL[edge]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="wing-tail">Tail</label>
        <select
          id="wing-tail"
          value={wing.tail}
          onChange={(e) => set({ tail: e.target.value as WingConfig["tail"] })}
        >
          {compat.tails.map((tail) => (
            <option key={tail} value={tail}>
              {TAIL_LABEL[tail]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="wing-pattern">Pattern</label>
        <select
          id="wing-pattern"
          value={wing.pattern}
          onChange={(e) => set({ pattern: e.target.value as WingConfig["pattern"] })}
        >
          {compat.patterns.map((pattern) => (
            <option key={pattern} value={pattern}>
              {PATTERN_LABEL[pattern]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="wing-complexity">
          Detail: {wing.complexity}
        </label>
        <input
          id="wing-complexity"
          type="range"
          min={0}
          max={4}
          step={1}
          value={wing.complexity}
          onChange={(e) => set({ complexity: Number(e.target.value) as WingConfig["complexity"] })}
        />
      </div>
      <p className="muted wing-detail-note">
        Detail is visual richness only. It is never a measure of you.
      </p>
    </div>
  );
}

/** Re-export so callers can normalize identity in one import. */
export { normalizeIdentity };
