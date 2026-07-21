import { describe, expect, test } from "bun:test";
import {
  generateInviteCode,
  hashInviteCode,
  isWellFormedInviteCode,
  normalizeInviteCode,
} from "./inviteCodes.ts";

describe("generateInviteCode", () => {
  test("produces well-formed codes with 128 bits of hex payload", () => {
    const code = generateInviteCode();
    expect(isWellFormedInviteCode(code)).toBe(true);
    expect(normalizeInviteCode(code)).toMatch(/^[0-9a-f]{32}$/);
  });

  test("codes are unique across many generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateInviteCode());
    expect(seen.size).toBe(1000);
  });
});

describe("normalizeInviteCode", () => {
  test("case and separators do not change identity", () => {
    const code = generateInviteCode();
    const shouted = code.toUpperCase().replace(/-/g, " ");
    expect(normalizeInviteCode(shouted)).toBe(normalizeInviteCode(code));
    expect(hashInviteCode(shouted)).toBe(hashInviteCode(code));
  });
});

describe("isWellFormedInviteCode", () => {
  test("rejects short, empty, and non-hex input", () => {
    expect(isWellFormedInviteCode("")).toBe(false);
    expect(isWellFormedInviteCode("abcd-1234")).toBe(false);
    // "g" is not hex: stripping it leaves 31 chars, so a typo fails cleanly.
    expect(isWellFormedInviteCode("g" + normalizeInviteCode(generateInviteCode()).slice(1))).toBe(
      false,
    );
    expect(isWellFormedInviteCode(generateInviteCode() + "ff")).toBe(false);
  });
});

describe("hashInviteCode", () => {
  test("distinct codes hash distinctly and deterministically", () => {
    const a = generateInviteCode();
    const b = generateInviteCode();
    expect(hashInviteCode(a)).toBe(hashInviteCode(a));
    expect(hashInviteCode(a)).not.toBe(hashInviteCode(b));
    expect(hashInviteCode(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
