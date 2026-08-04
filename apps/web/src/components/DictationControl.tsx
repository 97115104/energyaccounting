/**
 * DictationControl: compact icon-only dictation control plus status, driven
 * entirely by a useDictation instance.
 */

import type { UseDictation } from "../lib/useDictation";

export function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
      />
    </svg>
  );
}

type Props = {
  dictation: UseDictation;
  /** Field name used in the accessible button label, e.g. "journal". */
  label: string;
  disabled?: boolean;
  /** Hide the "listening" pill (e.g. when the caller renders its own). */
  hidePill?: boolean;
};

export function DictationControl({ dictation, label, disabled, hidePill }: Props) {
  const { supported, listening, notice, error, start, stop } = dictation;
  if (!supported) return null;
  return (
    <div className="dictate-row">
      {!listening ? (
        <button
          type="button"
          className="btn secondary mic-btn mic-btn-icon"
          disabled={disabled}
          title="Typing is hard sometimes. Talk instead."
          aria-label={`Dictate ${label}`}
          onClick={start}
        >
          <MicIcon />
        </button>
      ) : (
        <button
          type="button"
          className="btn danger mic-btn mic-btn-icon"
          title={`Stop dictating ${label}`}
          aria-label={`Stop dictating ${label}`}
          onClick={stop}
        >
          <span className="rec-dot" aria-hidden="true" />
        </button>
      )}
      {listening && !hidePill && (
        <span className="listening-pill" role="status">
          Listening · your words appear as you talk
        </span>
      )}
      {notice && (
        <p className="dictation-status" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="dictation-notice" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
