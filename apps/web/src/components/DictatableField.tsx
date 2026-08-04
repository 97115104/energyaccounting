/**
 * DictatableField: a labelled text input or textarea with dictation built in.
 *
 * This is the reusable field primitive. It owns the controlled value plumbing
 * and the dictation wiring; callers own persistence via onChange and the
 * optional onCommit (fired on blur and when a dictation session ends). No
 * knowledge of encryption or the API lives here.
 */

import { useCallback, useId } from "react";
import { useDictation } from "../lib/useDictation";
import { MicIcon } from "./DictationControl";

type BaseProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Persist hook: called on blur and when dictation ends. */
  onCommit?: (value: string) => void;
  maxLength?: number;
  disabled?: boolean;
  placeholder?: string;
  autoComplete?: string;
  /** Accessible label for the dictate button; defaults to the field label. */
  dictateLabel?: string;
  className?: string;
};

type Props = BaseProps &
  ({ multiline?: false } | { multiline: true; rows?: number });

export function DictatableField(props: Props) {
  const {
    label,
    value,
    onChange,
    onCommit,
    maxLength,
    disabled,
    placeholder,
    autoComplete,
    dictateLabel,
  } = props;
  const id = useId();
  const getValue = useCallback(() => value, [value]);
  const dictation = useDictation({
    getValue,
    onChange,
    onCommit,
    maxLength,
  });

  const nearLimit = maxLength != null && value.length >= maxLength - 500;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`dictatable-field ${props.multiline ? "multiline" : "single-line"}`}>
      {props.multiline ? (
        <textarea
          id={id}
          className="dictation-textarea"
          rows={props.rows ?? 3}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit?.(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="dictation-input"
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit?.(e.target.value)}
        />
      )}
        {dictation.supported && (
          <button
            type="button"
            className={`dictate-field-button${dictation.listening ? " recording" : ""}`}
            disabled={disabled || (!dictation.listening && maxLength != null && value.length >= maxLength)}
            title={dictation.listening ? "Stop dictating" : `Dictate ${dictateLabel ?? label.toLowerCase()}`}
            aria-label={
              dictation.listening
                ? `Stop dictating ${dictateLabel ?? label.toLowerCase()}`
                : `Dictate ${dictateLabel ?? label.toLowerCase()}`
            }
            onClick={() => {
              if (dictation.listening) {
                dictation.stop();
                return;
              }
              dictation.start();
            }}
          >
            {dictation.listening ? (
              <span className="rec-dot" aria-hidden="true" />
            ) : (
              <MicIcon />
            )}
          </button>
        )}
      </div>
      {nearLimit && (
        <p className={`char-counter${value.length >= (maxLength ?? 0) ? " at-limit" : ""}`}>
          {value.length.toLocaleString()} / {maxLength!.toLocaleString()} characters
        </p>
      )}
      {dictation.listening && (
        <p className="listening-pill" role="status">
          Listening · your words appear as you talk
        </p>
      )}
      {dictation.notice && (
        <p className="dictation-status" role="status">
          {dictation.notice}
        </p>
      )}
      {dictation.error && (
        <p className="dictation-notice" role="status">
          {dictation.error}
        </p>
      )}
    </div>
  );
}
