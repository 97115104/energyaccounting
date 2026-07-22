import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
  /** Defaults to the quiet "?" chip; pass text (e.g. "Why this?") for a link-style trigger. */
  buttonContent?: ReactNode;
  buttonClassName?: string;
};

/**
 * Progressive-disclosure help: a small control that reveals a short
 * explanation in a floating panel. The HIG-style treatment keeps the primary UI
 * terse, and the verbose "what does this mean" copy hides until asked.
 * Works for touch and keyboard (hover-only title= tooltips do not).
 */
export function HelpTip({
  label,
  children,
  buttonContent = "?",
  buttonClassName = "help-tip-btn",
}: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  // "?" chips need an explicit name; text triggers already expose their label.
  const needsAriaLabel = buttonContent === "?";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Swallow the key so an enclosing dialog doesn't also close.
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="help-tip" ref={rootRef}>
      <button
        type="button"
        className={buttonClassName}
        aria-label={needsAriaLabel ? `About ${label}` : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {buttonContent}
      </button>
      {open && (
        <span id={panelId} role="note" className="help-tip-panel">
          {children}
        </span>
      )}
    </span>
  );
}
