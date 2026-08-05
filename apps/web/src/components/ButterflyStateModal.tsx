/**
 * Explains today's butterfly pose: what the label means, how wings respond,
 * and the concrete signals that produced it. Opened from the header state line.
 */

import { DialogFrame } from "./DialogFrame";
import {
  canonicalStateLabel,
  type ButterflyState,
} from "../lib/butterflyState";

type Props = {
  state: ButterflyState;
  onClose: () => void;
};

export function ButterflyStateModal({ state, onClose }: Props) {
  const canonical = canonicalStateLabel(state.id);
  // Skip when the fun line already contains the plain name ("Feeling lively").
  const showAlso =
    state.label !== canonical &&
    !state.label.toLowerCase().includes(canonical.toLowerCase());

  return (
    <DialogFrame
      id="butterfly-state-modal"
      className="butterfly-state-modal"
      ariaLabelledby="butterfly-state-title"
      closeLabel="Close butterfly state details"
      onClose={onClose}
      header={
        <>
          <p className="muted butterfly-state-eyebrow">Today&apos;s butterfly</p>
          <h2 id="butterfly-state-title" className="butterfly-state-title">
            {state.label}
          </h2>
          {showAlso && (
            <p className="muted butterfly-state-also">Also {canonical.toLowerCase()}.</p>
          )}
        </>
      }
    >
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
    </DialogFrame>
  );
}
