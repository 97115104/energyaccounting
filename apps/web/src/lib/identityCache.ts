/**
 * Local cache of the last person's NeuroMe identity, so the butterfly can greet
 * them on the full sign-in screen before any session or key exists.
 *
 * Identity is render-only by design (colors and wing shape, no journal data),
 * which is why it is safe to keep in localStorage. Nothing here touches
 * encrypted content. The value is best-effort: any read/write failure simply
 * falls back to no cached mark.
 */

import { normalizeIdentity, type IdentityConfig } from "./identity";

const KEY = "eaj-last-identity-v1";

export function cacheIdentity(identity: IdentityConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // A butterfly on the sign-in screen is a nicety, not a requirement.
  }
}

export function readCachedIdentity(): IdentityConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizeIdentity(JSON.parse(raw), "returning");
  } catch {
    return null;
  }
}

export function forgetCachedIdentity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do when storage is unavailable.
  }
}
