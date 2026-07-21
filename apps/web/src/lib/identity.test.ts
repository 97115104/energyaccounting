import { describe, expect, test } from "bun:test";
import {
  ARCHETYPES,
  SYMBOLS,
  defaultIdentity,
  normalizeIdentity,
  seedHash,
  wingVariation,
} from "./identity";

describe("identity config", () => {
  test("default identity is valid and butterfly-first", () => {
    const id = defaultIdentity("user-1");
    expect(id.symbol).toBe("butterfly");
    expect(id.seed).toBe("user-1");
    expect(ARCHETYPES.some((a) => a.id === id.archetype)).toBe(true);
  });

  test("normalize accepts a full valid config unchanged", () => {
    const config = {
      version: 1,
      symbol: "rainbow-pride",
      archetype: "morpho",
      palette: { primary: "#112233", secondary: "#445566", accent: "#778899" },
      seed: "abc",
      motion: "calm",
    };
    expect(normalizeIdentity(config, "fallback")).toEqual(config as never);
  });

  test("normalize repairs junk field by field", () => {
    const out = normalizeIdentity(
      {
        symbol: "sparkle-unicorn",
        archetype: "monarch",
        palette: { primary: "red", secondary: "#445566", accent: 42 },
        motion: "chaotic",
      },
      "seed-x",
    );
    expect(out.symbol).toBe("butterfly");
    expect(out.archetype).toBe("monarch");
    // Bad colors fall back to the archetype preset; the valid one stays.
    expect(out.palette.secondary).toBe("#445566");
    expect(out.palette.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(out.motion).toBe("auto");
    expect(out.seed).toBe("seed-x");
  });

  test("normalize handles null, arrays, and primitives", () => {
    for (const junk of [null, undefined, 7, "hi", []]) {
      const out = normalizeIdentity(junk, "s");
      expect(out.version).toBe(1);
      expect(out.symbol).toBe("butterfly");
    }
  });

  test("the puzzle piece is not offered, and stored values coerce to butterfly", () => {
    expect(SYMBOLS.map((s) => s.id)).toEqual([
      "butterfly",
      "rainbow-infinity",
      "gold-infinity",
      "rainbow-pride",
    ]);
    const out = normalizeIdentity({ symbol: "puzzle" }, "seed-x");
    expect(out.symbol).toBe("butterfly");
  });
});

describe("deterministic variation", () => {
  test("same seed always gives the same hash and variation", () => {
    expect(seedHash("alice")).toBe(seedHash("alice"));
    expect(wingVariation("alice")).toEqual(wingVariation("alice"));
  });

  test("different seeds diverge", () => {
    expect(seedHash("alice")).not.toBe(seedHash("bob"));
  });

  test("variation stays inside drawable bounds", () => {
    for (const seed of ["a", "b", "user-123", "0", "🦋"]) {
      const v = wingVariation(seed);
      expect(v.spread).toBeGreaterThanOrEqual(0.35);
      expect(v.spread).toBeLessThanOrEqual(0.85);
      expect(v.tail).toBeGreaterThanOrEqual(0);
      expect(v.tail).toBeLessThanOrEqual(1);
      expect(v.eyespots).toBeGreaterThanOrEqual(0);
      expect(v.eyespots).toBeLessThanOrEqual(3);
      expect(v.band).toBeGreaterThanOrEqual(0.3);
      expect(v.band).toBeLessThanOrEqual(0.9);
    }
  });
});
