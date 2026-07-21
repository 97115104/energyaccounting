import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Progressive-disclosure help: a small "?" button that reveals a short
 * explanation in place. HIG-style — the primary UI stays terse and the
 * verbose "what does this mean, how is it computed" copy hides until asked.
 * Works for touch and keyboard (hover-only title= tooltips do not).
 */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

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
        className="help-tip-btn"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <span id={panelId} role="note" className="help-tip-panel">
          {children}
        </span>
      )}
    </span>
  );
}
