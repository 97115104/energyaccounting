import { useEffect, useRef } from "react";

type FocusTrapOptions = Readonly<{
  open: boolean;
  modalId: string;
  onEscape: () => void;
  eventTarget?: "document" | "window";
  preferEnabledControl?: boolean;
}>;

const focusableSelector =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Preserves dialog focus, traps Tab, and returns focus on close. */
export function useModalFocusTrap({
  open,
  modalId,
  onEscape,
  eventTarget = "window",
  preferEnabledControl = false,
}: FocusTrapOptions): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.getElementById(modalId);
    const focusables = () =>
      modal
        ? Array.from(modal.querySelectorAll<HTMLElement>(focusableSelector))
            .filter((element) => !element.hasAttribute("disabled"))
        : [];
    const focusId = window.requestAnimationFrame(() => {
      const controls = focusables();
      const first = preferEnabledControl
        ? controls.find((element) => element.getAttribute("aria-disabled") !== "true") ?? controls[0]
        : controls[0];
      first?.focus({ preventScroll: true });
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusables();
      if (!controls.length) return;
      const first = controls[0]!;
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    if (eventTarget === "document") document.addEventListener("keydown", onKey);
    else window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusId);
      if (eventTarget === "document") document.removeEventListener("keydown", onKey);
      else window.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, modalId, eventTarget, preferEnabledControl]);
}
