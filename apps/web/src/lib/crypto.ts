/** Client-side E2E helpers: password → KEK (Argon2id) → wrap/unwrap DEK → AES-GCM. */

import { argon2id } from "hash-wasm";

const textEnc = new TextEncoder();
const textDec = new TextDecoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export async function deriveKek(password: string, saltB64: string): Promise<CryptoKey> {
  const salt = fromB64(saltB64);
  const hash = await argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 4,
    memorySize: 65536,
    hashLength: 32,
    outputType: "binary",
  });
  return crypto.subtle.importKey("raw", hash as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export function newSalt(): string {
  return b64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function generateDek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function wrapDek(dek: CryptoKey, kek: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", dek);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, raw);
  return JSON.stringify({ iv: b64(iv), ct: b64(ct) });
}

export async function unwrapDek(wrapped: string, kek: CryptoKey): Promise<CryptoKey> {
  const { iv, ct } = JSON.parse(wrapped) as { iv: string; ct: string };
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) as BufferSource },
    kek,
    fromB64(ct) as BufferSource,
  );
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptText(
  dek: CryptoKey,
  plaintext: string,
  aad = "eaj",
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: textEnc.encode(aad) },
    dek,
    textEnc.encode(plaintext),
  );
  return { ciphertext: b64(ct), iv: b64(iv) };
}

export async function decryptText(
  dek: CryptoKey,
  ciphertext: string,
  iv: string,
  aad = "eaj",
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromB64(iv) as BufferSource,
      additionalData: textEnc.encode(aad),
    },
    dek,
    fromB64(ciphertext) as BufferSource,
  );
  return textDec.decode(pt);
}

export async function labelHash(label: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEnc.encode(label.trim().toLowerCase()),
  );
  return b64(digest);
}

let sessionDek: CryptoKey | null = null;
export const UNLOCK_TTL_MS = 24 * 60 * 60 * 1000;
const UNLOCK_KEY_PREFIX = "eaj-unlock-v1:";

type StoredDek = {
  version: 1;
  rawKey: string;
  expiresAt: number;
};

export function setSessionDek(dek: CryptoKey | null) {
  sessionDek = dek;
}

export function getSessionDek(): CryptoKey | null {
  return sessionDek;
}

function unlockStorageKey(userId: string): string {
  return `${UNLOCK_KEY_PREFIX}${userId}`;
}

/**
 * Remember the journal key for the selected 24-hour convenience window.
 * Cap storage lifetime to the remaining server session so DEK cannot outlive auth.
 * This intentionally trades some at-rest browser protection for restart persistence.
 */
export async function rememberSessionDek(
  dek: CryptoKey,
  userId: string,
  now = Date.now(),
  sessionExpiresAt?: number,
): Promise<void> {
  const raw = await crypto.subtle.exportKey("raw", dek);
  const unlockCap = now + UNLOCK_TTL_MS;
  const expiresAt =
    typeof sessionExpiresAt === "number" && Number.isFinite(sessionExpiresAt)
      ? Math.min(unlockCap, sessionExpiresAt)
      : unlockCap;
  if (expiresAt <= now) {
    forgetRememberedSessionDek(userId);
    return;
  }
  const stored: StoredDek = {
    version: 1,
    rawKey: b64(raw),
    expiresAt,
  };
  try {
    localStorage.setItem(unlockStorageKey(userId), JSON.stringify(stored));
  } catch {
    // The in-memory unlock still works when storage is blocked or full.
  }
}

export async function restoreRememberedSessionDek(
  userId: string,
  now = Date.now(),
): Promise<CryptoKey | null> {
  let serialized: string | null = null;
  try {
    serialized = localStorage.getItem(unlockStorageKey(userId));
  } catch {
    return null;
  }
  if (!serialized) return null;

  try {
    const stored = JSON.parse(serialized) as Partial<StoredDek>;
    if (
      stored.version !== 1 ||
      typeof stored.rawKey !== "string" ||
      typeof stored.expiresAt !== "number" ||
      stored.expiresAt <= now
    ) {
      forgetRememberedSessionDek(userId);
      return null;
    }
    const dek = await crypto.subtle.importKey(
      "raw",
      fromB64(stored.rawKey) as BufferSource,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    setSessionDek(dek);
    return dek;
  } catch {
    forgetRememberedSessionDek(userId);
    return null;
  }
}

export function forgetRememberedSessionDek(userId: string): void {
  try {
    localStorage.removeItem(unlockStorageKey(userId));
  } catch {
    // Nothing else can be cleared when browser storage is unavailable.
  }
}

/** Drop every cached unlock key when the httpOnly session is gone. */
export function forgetAllRememberedSessionDeks(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(UNLOCK_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Nothing else can be cleared when browser storage is unavailable.
  }
}
