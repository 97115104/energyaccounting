/**
 * SuggestionCard: one presentational contract for anything the on-device
 * intelligence proposes (traits, profile draft lines, morphology ideas). It
 * shows a kind label, the proposal, its evidence, and accept / dismiss actions.
 * It shares no domain model, so each caller keeps its own types.
 */

import type { ReactNode } from "react";

type Props = {
  kindLabel?: string;
  title: ReactNode;
  because: string[];
  acceptLabel?: string;
  onAccept: () => void;
  onDismiss: () => void;
  dismissLabel?: string;
  /** Accessible names so several cards' buttons stay distinguishable. */
  acceptAriaLabel?: string;
  dismissAriaLabel?: string;
};

export function SuggestionCard({
  kindLabel,
  title,
  because,
  acceptLabel = "Accept",
  onAccept,
  onDismiss,
  dismissLabel = "Dismiss",
  acceptAriaLabel,
  dismissAriaLabel,
}: Props) {
  return (
    <li className="you-suggestion">
      <div>
        {kindLabel && <span className="you-trait-kind">{kindLabel}</span>}{" "}
        <strong>{title}</strong>
        {because.length > 0 && (
          <p className="muted you-suggestion-why">{because.join(" ")}</p>
        )}
      </div>
      <div className="you-suggestion-actions">
        <button
          type="button"
          className="btn secondary"
          aria-label={acceptAriaLabel}
          onClick={onAccept}
        >
          {acceptLabel}
        </button>
        <button
          type="button"
          className="linkish"
          aria-label={dismissAriaLabel}
          onClick={onDismiss}
        >
          {dismissLabel}
        </button>
      </div>
    </li>
  );
}
