/**
 * Hold window scroll still across async work that can reflow the page
 * (soft reloads, completing tasks, opening fixed modals that focus).
 */

export async function withPreservedScroll(run: () => Promise<void>): Promise<void> {
  const x = window.scrollX;
  const y = window.scrollY;
  const restore = () => {
    if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
  };
  try {
    await run();
  } finally {
    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }
}

/** Focus without scrolling the page underneath. */
export function focusWithoutScroll(el: HTMLElement | null | undefined): void {
  el?.focus({ preventScroll: true });
}
