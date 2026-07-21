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

export function cacheIdentity(identity: IdentityConfig, name?: string | null): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ identity, name: name?.trim() || null }));
  } catch {
    // A butterfly on the sign-in screen is a nicety, not a requirement.
  }
}

function readEntry(): { identity: unknown; name: string | null } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Older entries stored the identity config bare, without the wrapper.
    if (parsed && typeof parsed === "object" && "identity" in parsed) {
      return {
        identity: parsed.identity,
        name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : null,
      };
    }
    return { identity: parsed, name: null };
  } catch {
    return null;
  }
}

export function readCachedIdentity(): IdentityConfig | null {
  const entry = readEntry();
  return entry ? normalizeIdentity(entry.identity, "returning") : null;
}

/** The last person's display name, for "Welcome back, NAME" before sign-in. */
export function readCachedName(): string | null {
  return readEntry()?.name ?? null;
}

export function forgetCachedIdentity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do when storage is unavailable.
  }
}
