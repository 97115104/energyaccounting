/**
 * Share URL tokens are shown once by the server (hash-only storage). Remember
 * them on this device so "Your links" can offer Copy again after creation.
 */

const KEY = "eaj-share-tokens";

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, token] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof token === "string" && token.length > 0) out[id] = token;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* private mode / quota, Copy-later simply won't be available */
  }
}

export function rememberShareToken(shareId: string, token: string) {
  const map = readMap();
  map[shareId] = token;
  writeMap(map);
}

export function readShareToken(shareId: string): string | null {
  return readMap()[shareId] ?? null;
}

export function forgetShareToken(shareId: string) {
  const map = readMap();
  if (!(shareId in map)) return;
  delete map[shareId];
  writeMap(map);
}
