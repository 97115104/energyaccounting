/**
 * Explains today's butterfly pose: what the label means, how wings respond,
 * and the concrete signals that produced it. Opened from the header state line.
 */

import { useEffect, useRef } from "react";
import { ModalCloseButton } from "./ModalCloseButton";
import {
  canonicalStateLabel,
  type ButterflyState,
} from "../lib/butterflyState";

type Props = {
  state: ButterflyState;
  onClose: () => void;
};

export function ButterflyStateModal({ state, onClose }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);
  const canonical = canonicalStateLabel(state.id);
  // Skip when the fun line already contains the plain name ("Feeling lively").
  const showAlso =
    state.label !== canonical &&
    !state.label.toLowerCase().includes(canonical.toLowerCase());

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    const focusables = () =>
      modal?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ?? [];

    const focusId = window.requestAnimationFrame(() => {
      const list = focusables();
      (list[list.length - 1] ?? modal)?.focus({ preventScroll: true });
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !modal) return;
      const list = [...focusables()];
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div
      className="insight-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        id="butterfly-state-modal"
        className="panel insight-modal butterfly-state-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="butterfly-state-title"
        tabIndex={-1}
      >
        <ModalCloseButton label="Close butterfly state details" onClick={onClose} />
        <p className="muted butterfly-state-eyebrow">Today&apos;s butterfly</p>
        <h2 id="butterfly-state-title" className="butterfly-state-title">
          {state.label}
        </h2>
        {showAlso && (
          <p className="muted butterfly-state-also">Also {canonical.toLowerCase()}.</p>
        )}
        <p>{state.summary}</p>
        <p className="muted">
          This pose comes from today&apos;s energy numbers, namely how much you have added, used,
          and still have available. It also sets how quickly the wings beat, unless you prefer
          calm or still motion.
        </p>
        {state.because.length > 0 && (
          <div className="butterfly-state-why-block">
            <h3 className="butterfly-state-why">Why this pose</h3>
            <div className="butterfly-state-because">
              {state.because.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
