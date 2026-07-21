import { beforeEach, describe, expect, test } from "bun:test";
import {
  UNLOCK_TTL_MS,
  forgetAllRememberedSessionDeks,
  forgetRememberedSessionDek,
  generateDek,
  getSessionDek,
  rememberSessionDek,
  restoreRememberedSessionDek,
  setSessionDek,
} from "./crypto";

const values = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  },
});

describe("remembered journal unlock", () => {
  beforeEach(() => {
    values.clear();
    setSessionDek(null);
  });

  test("restores a key during the 24-hour window", async () => {
    const dek = await generateDek();
    await rememberSessionDek(dek, "user-1", 1_000);
    const restored = await restoreRememberedSessionDek("user-1", 1_000 + UNLOCK_TTL_MS - 1);
    expect(restored).not.toBeNull();
    expect(getSessionDek()).toBe(restored);
  });

  test("deletes and rejects an expired key", async () => {
    const dek = await generateDek();
    await rememberSessionDek(dek, "user-1", 1_000);
    const restored = await restoreRememberedSessionDek("user-1", 1_000 + UNLOCK_TTL_MS);
    expect(restored).toBeNull();
    expect(values.size).toBe(0);
  });

  test("caps unlock storage to the remaining server session", async () => {
    const dek = await generateDek();
    await rememberSessionDek(dek, "user-1", 1_000, 1_000 + 60_000);
    const restored = await restoreRememberedSessionDek("user-1", 1_000 + 60_001);
    expect(restored).toBeNull();
    expect(values.size).toBe(0);
  });

  test("forget helpers clear stored unlock material", async () => {
    const dek = await generateDek();
    await rememberSessionDek(dek, "user-1", 1_000);
    await rememberSessionDek(dek, "user-2", 1_000);
    forgetRememberedSessionDek("user-1");
    expect(values.has("eaj-unlock-v1:user-1")).toBe(false);
    forgetAllRememberedSessionDeks();
    expect(values.size).toBe(0);
  });
});
