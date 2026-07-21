import { createHash, randomBytes } from "node:crypto";

// 16 random bytes = 128 bits of entropy per code — unguessable even against
// offline brute force of the stored SHA-256 hashes.
export const INVITE_CODE_BYTES = 16;
const NORMALIZED_LENGTH = INVITE_CODE_BYTES * 2; // hex chars

/**
 * Lowercase and strip separators so "AB12-CD34…" and "ab12cd34…" hash
 * identically. Non-hex characters are dropped, which also makes typos
 * (e.g. "g" for "9") fail the well-formed check instead of hashing garbage.
 */
export function normalizeInviteCode(code: string): string {
  return code.toLowerCase().replace(/[^0-9a-f]/g, "");
}

export function isWellFormedInviteCode(code: string): boolean {
  return normalizeInviteCode(code).length === NORMALIZED_LENGTH;
}

/** Dash-grouped hex, e.g. "3f9a-1c…" — easier to read aloud and copy. */
export function generateInviteCode(): string {
  const hex = randomBytes(INVITE_CODE_BYTES).toString("hex");
  return hex.match(/.{4}/g)!.join("-");
}

/** Only this hash is stored server-side; the plaintext code never enters the DB. */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(normalizeInviteCode(code)).digest("hex");
}
