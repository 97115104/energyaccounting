/**
 * ProfileSections: one renderer for the shareable "how to work with me" blocks,
 * used by both the public share page and the print/PDF document. Callers pass
 * already-selected content, so section gating stays where the person controls
 * it. Two variants keep the share-card and print class names intact.
 */

import type { AcceptedTrait } from "../lib/butterflyTraits";
import type { ButterflyPalette } from "../lib/identity";
import { KIND_LABEL, SLOT_LABEL, type ColorMeaning } from "../lib/youProfile";

type Props = {
  variant: "share" | "print";
  palette: ButterflyPalette;
  name?: string | null;
  about?: string;
  communication?: string;
  support?: string;
  traits?: AcceptedTrait[];
  colorMeanings?: ColorMeaning[];
};

export function ProfileSections({
  variant,
  palette,
  name,
  about,
  communication,
  support,
  traits,
  colorMeanings,
}: Props) {
  const blockClass = variant === "share" ? "share-block" : "you-print-block";
  const Heading = variant === "share" ? "h3" : "h2";
  const who = name?.trim() || (variant === "share" ? "them" : "me");

  return (
    <>
      {about?.trim() && (
        <div className={blockClass}>
          <Heading>About</Heading>
          <p>{about}</p>
        </div>
      )}
      {communication?.trim() && (
        <div className={blockClass}>
          <Heading>How to communicate with {who}</Heading>
          <p>{communication}</p>
        </div>
      )}
      {support?.trim() && (
        <div className={blockClass}>
          <Heading>What helps on a hard day</Heading>
          <p>{support}</p>
        </div>
      )}
      {traits && traits.length > 0 && (
        <div className={blockClass}>
          <Heading>Traits</Heading>
          <ul className={variant === "share" ? "share-traits" : undefined}>
            {traits.map((t) => (
              <li key={t.id}>
                <span className="you-trait-kind">{KIND_LABEL[t.kind] ?? t.kind}</span> {t.label}
              </li>
            ))}
          </ul>
        </div>
      )}
      {colorMeanings && colorMeanings.length > 0 && (
        <div className={blockClass}>
          <Heading>Wing colors</Heading>
          <ul className={variant === "share" ? "share-colors" : undefined}>
            {colorMeanings.map((m) => (
              <li key={m.slot}>
                <span
                  className="you-print-swatch"
                  style={{ background: palette[m.slot] }}
                  aria-hidden="true"
                />
                {SLOT_LABEL[m.slot] ?? m.slot}: {m.meaning}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
