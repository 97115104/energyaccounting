/**
 * Header control for today's butterfly pose label. Opens the explain dialog.
 * Shared across Today, Dashboard, You, and Settings so the top bar stays consistent.
 */

import type { ButterflyState } from "../lib/butterflyState";

type Props = {
  state: ButterflyState;
  expanded: boolean;
  onOpen: () => void;
};

export function ButterflyStateButton({ state, expanded, onOpen }: Props) {
  return (
    <button
      type="button"
      className="greeting-state"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      title="What this means"
      onClick={onOpen}
    >
      {state.label}
    </button>
  );
}
