import { type FormEvent, type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { useModalFocusTrap } from "../lib/useModalFocusTrap";
import { ModalCloseButton } from "./ModalCloseButton";

export type DialogRole = "dialog" | "alertdialog";
export type DialogSurface = "div" | "form";

export type DialogOverlayProps = Readonly<{
  children: ReactNode;
  className?: string;
  onBackdropClick?: () => void;
}>;

export type DialogSlotProps = Readonly<{
  children: ReactNode;
  className?: string;
}>;

export type DialogFrameProps = Readonly<{
  /** Stable DOM identity used for focus management. */
  id: string;
  children: ReactNode;
  open?: boolean;
  className?: string;
  overlayClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  header?: ReactNode;
  footer?: ReactNode;
  role?: DialogRole;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
  onClose?: () => void;
  closeLabel?: string;
  closeDisabled?: boolean;
  /** Blocks every dismissal path while an irreversible action is in flight. */
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  dismissOnEscape?: boolean;
  surface?: DialogSurface;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}>;

const joinClassNames = (...names: Array<string | undefined>) => names.filter(Boolean).join(" ");

/**
 * Visual overlay only. Dismissal is supplied by the owning dialog, so busy and
 * destructive flows can retain their current safety guarantees.
 */
export function DialogOverlay({ children, className, onBackdropClick }: DialogOverlayProps) {
  return (
    <div
      className={joinClassNames("insight-scrim", "dialog-overlay", className)}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onBackdropClick?.();
      }}
    >
      {children}
    </div>
  );
}

/** Presentational slot for a persistent dialog heading and close control. */
export function DialogHeader({ children, className }: DialogSlotProps) {
  return <div className={joinClassNames("dialog-header", className)}>{children}</div>;
}

/** Presentational slot for the independently scrollable dialog content. */
export function DialogBody({ children, className }: DialogSlotProps) {
  return <div className={joinClassNames("dialog-body", className)}>{children}</div>;
}

/** Presentational slot for persistent action controls. */
export function DialogFooter({ children, className }: DialogSlotProps) {
  return <div className={joinClassNames("dialog-footer", className)}>{children}</div>;
}

type ScrollLockSnapshot = Readonly<{
  appRootHeight: string;
  appRootLeft: string;
  appRootOverflow: string;
  appRootPosition: string;
  appRootRight: string;
  appRootTop: string;
  appRootWidth: string;
  bodyMinHeight: string;
  bodyOverflow: string;
  rootOverflow: string;
  scrollY: number;
}>;

let scrollLockDepth = 0;
let scrollLockSnapshot: ScrollLockSnapshot | null = null;

function acquirePageScrollLock(): void {
  if (scrollLockDepth === 0) {
    const body = document.body;
    const root = document.documentElement;
    const appRoot = document.getElementById("root");
    if (!appRoot) return;
    scrollLockSnapshot = {
      appRootHeight: appRoot.style.height,
      appRootLeft: appRoot.style.left,
      appRootOverflow: appRoot.style.overflow,
      appRootPosition: appRoot.style.position,
      appRootRight: appRoot.style.right,
      appRootTop: appRoot.style.top,
      appRootWidth: appRoot.style.width,
      bodyMinHeight: body.style.minHeight,
      bodyOverflow: body.style.overflow,
      rootOverflow: root.style.overflow,
      scrollY: window.scrollY,
    };
    // Keep the document's original scroll range while the app is fixed. This
    // avoids iOS clamping scrollY to zero and preserves the view behind a dialog.
    body.style.minHeight = `${document.documentElement.scrollHeight}px`;
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    // Do not fix body: iOS WebKit offsets fixed descendants of an offset body,
    // which leaves a visible gap beneath a modal scrim in installed PWAs.
    appRoot.style.position = "fixed";
    appRoot.style.top = `-${scrollLockSnapshot.scrollY}px`;
    appRoot.style.right = "0";
    appRoot.style.left = "0";
    appRoot.style.width = "100%";
    appRoot.style.height = "100dvh";
    appRoot.style.overflow = "hidden";
  }
  scrollLockDepth += 1;
}

function releasePageScrollLock(): void {
  if (scrollLockDepth === 0) return;
  scrollLockDepth -= 1;
  if (scrollLockDepth !== 0 || !scrollLockSnapshot) return;

  const body = document.body;
  const root = document.documentElement;
  const snapshot = scrollLockSnapshot;
  const appRoot = document.getElementById("root");
  if (appRoot) {
    appRoot.style.position = snapshot.appRootPosition;
    appRoot.style.top = snapshot.appRootTop;
    appRoot.style.right = snapshot.appRootRight;
    appRoot.style.left = snapshot.appRootLeft;
    appRoot.style.width = snapshot.appRootWidth;
    appRoot.style.height = snapshot.appRootHeight;
    appRoot.style.overflow = snapshot.appRootOverflow;
  }
  body.style.minHeight = snapshot.bodyMinHeight;
  body.style.overflow = snapshot.bodyOverflow;
  root.style.overflow = snapshot.rootOverflow;
  scrollLockSnapshot = null;
  window.scrollTo(0, snapshot.scrollY);
}

/** Locks page scrolling while one or more dialogs are open, including iOS PWAs. */
export function usePageScrollLock(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    acquirePageScrollLock();
    return releasePageScrollLock;
  }, [open]);
}

/**
 * Composes a modal overlay with typed accessibility, focus, close, and
 * scroll-lock behavior. Layout CSS owns the responsive header/body/footer
 * geometry through the stable dialog-* class hooks.
 */
export function DialogFrame({
  id,
  children,
  open = true,
  className,
  overlayClassName,
  bodyClassName,
  footerClassName,
  header,
  footer,
  role = "dialog",
  ariaLabelledby,
  ariaDescribedby,
  onClose,
  closeLabel = "Close",
  closeDisabled = false,
  busy = false,
  dismissOnBackdrop = true,
  dismissOnEscape = true,
  surface = "div",
  onSubmit,
}: DialogFrameProps) {
  const dismissalBlocked = closeDisabled || busy;
  const requestClose = () => {
    if (!dismissalBlocked) onClose?.();
  };
  const canClose = Boolean(onClose) && !dismissalBlocked;

  useModalFocusTrap({
    open,
    modalId: id,
    onEscape: dismissOnEscape ? requestClose : () => {},
  });
  usePageScrollLock(open);

  if (!open) return null;

  const content = (
    <>
      <DialogHeader>
        {onClose && (
          <ModalCloseButton label={closeLabel} disabled={dismissalBlocked} onClick={requestClose} />
        )}
        {header}
      </DialogHeader>
      <DialogBody className={bodyClassName}>{children}</DialogBody>
      {footer && <DialogFooter className={footerClassName}>{footer}</DialogFooter>}
    </>
  );

  const sharedSurfaceProps = {
    id,
    className: joinClassNames("panel", "insight-modal", "dialog-frame", className),
    role,
    "aria-modal": true,
    "aria-busy": busy || undefined,
    "aria-labelledby": ariaLabelledby,
    "aria-describedby": ariaDescribedby,
    tabIndex: -1,
  } as const;

  const overlay = (
    <DialogOverlay
      className={overlayClassName}
      onBackdropClick={canClose && dismissOnBackdrop ? requestClose : undefined}
    >
      {surface === "form" ? (
        <form {...sharedSurfaceProps} onSubmit={onSubmit}>
          {content}
        </form>
      ) : (
        <div {...sharedSurfaceProps}>{content}</div>
      )}
    </DialogOverlay>
  );

  // Keep the fixed scrim outside the locked application shell on iOS PWAs.
  return typeof document === "undefined" ? overlay : createPortal(overlay, document.body);
}
