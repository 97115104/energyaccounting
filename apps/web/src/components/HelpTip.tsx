import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ModalCloseButton } from "./ModalCloseButton";

type Props = {
  label: string;
  children: ReactNode;
  /** Defaults to the quiet "?" chip; pass text (e.g. "Why this?") for a link-style trigger. */
  buttonContent?: ReactNode;
  buttonClassName?: string;
};

const MOBILE_MQ = "(max-width: 719px)";
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Ref-count body scroll lock so nested/overlapping tips do not thrash overflow. */
let bodyScrollLocks = 0;
let bodyOverflowPrev = "";

function lockBodyScroll() {
  if (typeof document === "undefined") return;
  if (bodyScrollLocks === 0) {
    bodyOverflowPrev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLocks += 1;
}

function unlockBodyScroll() {
  if (typeof document === "undefined") return;
  bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
  if (bodyScrollLocks === 0) {
    document.body.style.overflow = bodyOverflowPrev;
  }
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MQ).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

/**
 * Progressive-disclosure help: a small control that reveals a short
 * explanation. Desktop: fixed panel above the trigger (portaled, clamped).
 * Mobile: Apple-style bottom sheet so long tips stay readable.
 */
export function HelpTip({
  label,
  children,
  buttonContent = "?",
  buttonClassName = "help-tip-btn",
}: Props) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const needsAriaLabel = buttonContent === "?";

  function close() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      if (sheetRef.current?.contains(t)) return;
      close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Desktop: measure trigger and place a fixed panel above (flip below if needed).
  useLayoutEffect(() => {
    if (!open || isMobile) return;

    function place() {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const tr = trigger.getBoundingClientRect();
      const margin = 8;
      const width = Math.min(260, window.innerWidth - margin * 2);
      // Pin width before measuring height so clamp math is stable.
      panel.style.width = `${width}px`;
      const pr = panel.getBoundingClientRect();
      const spaceAbove = tr.top - margin;
      const spaceBelow = window.innerHeight - tr.bottom - margin;
      const placeBelow = pr.height > spaceAbove && spaceBelow > spaceAbove;

      let left = tr.left + tr.width / 2 - pr.width / 2;
      left = Math.min(Math.max(margin, left), window.innerWidth - pr.width - margin);
      const top = placeBelow
        ? Math.min(tr.bottom + 8, window.innerHeight - pr.height - margin)
        : Math.max(margin, tr.top - pr.height - 8);

      setPanelStyle({
        position: "fixed",
        top,
        left,
        width,
        zIndex: 70,
      });
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, isMobile, children]);

  // Mobile sheet: scroll lock, focus trap, restore focus to trigger.
  useEffect(() => {
    if (!open || !isMobile) return;
    const previous = document.activeElement as HTMLElement | null;
    lockBodyScroll();

    const focusables = () =>
      sheetRef.current
        ? Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => !el.hasAttribute("disabled"),
          )
        : [];

    const focusId = window.requestAnimationFrame(() => {
      focusables()[0]?.focus({ preventScroll: true });
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
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

    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      window.removeEventListener("keydown", onKey);
      unlockBodyScroll();
      (previous ?? triggerRef.current)?.focus?.({ preventScroll: true });
    };
  }, [open, isMobile]);

  // Desktop Escape closes without a full modal trap.
  useEffect(() => {
    if (!open || isMobile) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isMobile]);

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={buttonClassName}
      aria-label={needsAriaLabel ? `About ${label}` : undefined}
      aria-expanded={open}
      aria-controls={panelId}
      aria-haspopup={isMobile ? "dialog" : undefined}
      onClick={() => setOpen((o) => !o)}
    >
      {buttonContent}
    </button>
  );

  const portalTarget = typeof document !== "undefined" ? document.body : null;

  return (
    <span className="help-tip" ref={rootRef}>
      {trigger}
      {open &&
        portalTarget &&
        isMobile &&
        createPortal(
          <div className="help-tip-scrim" role="presentation">
            <button
              type="button"
              className="help-tip-scrim-dismiss"
              aria-label="Dismiss help"
              onClick={close}
            />
            <div
              ref={sheetRef}
              id={panelId}
              className="help-tip-sheet"
              role="dialog"
              aria-modal="true"
              aria-label={label}
            >
              <div className="help-tip-sheet-head">
                <h2 className="help-tip-sheet-title">{label}</h2>
                <ModalCloseButton label="Close help" onClick={close} />
              </div>
              <div className="help-tip-sheet-body">{children}</div>
            </div>
          </div>,
          portalTarget,
        )}
      {open &&
        portalTarget &&
        !isMobile &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="note"
            className="help-tip-panel help-tip-panel-fixed"
            style={panelStyle}
          >
            {children}
          </div>,
          portalTarget,
        )}
    </span>
  );
}
