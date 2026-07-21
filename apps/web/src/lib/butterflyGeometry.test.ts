import { describe, expect, test } from "bun:test";
import {
  WING_FAMILIES,
  buildWingRender,
  compatibleTraits,
  defaultWingFor,
  normalizeWing,
  type WingVariation,
} from "./butterflyGeometry";

const V: WingVariation = { spread: 0.6, aspect: 0.5, veinFan: 0.5, jitter: 0.4, band: 0.5 };

describe("wing geometry", () => {
  test("every family renders a non-empty forewing and hindwing", () => {
    for (const family of WING_FAMILIES) {
      const render = buildWingRender(defaultWingFor(family), V);
      expect(render.forewing.startsWith("M")).toBe(true);
      expect(render.hindwing.startsWith("M")).toBe(true);
    }
  });

  test("families produce distinct silhouettes", () => {
    const fores = WING_FAMILIES.map((f) => buildWingRender(defaultWingFor(f), V).forewing);
    expect(new Set(fores).size).toBe(WING_FAMILIES.length);
  });

  test("geometry is deterministic for the same config and variation", () => {
    const a = buildWingRender(defaultWingFor("monarch"), V);
    const b = buildWingRender(defaultWingFor("monarch"), V);
    expect(a).toEqual(b);
  });

  test("complexity bounds the number of marks", () => {
    const low = buildWingRender(
      { family: "peacock", edge: "smooth", tail: "none", pattern: "eyespots", complexity: 0 },
      V,
    );
    const high = buildWingRender(
      { family: "peacock", edge: "smooth", tail: "none", pattern: "eyespots", complexity: 4 },
      V,
    );
    expect(high.eyespots.length).toBeGreaterThanOrEqual(low.eyespots.length);
    expect(high.eyespots.length).toBeLessThanOrEqual(4);
  });

  test("tailless families never emit tail paths", () => {
    const render = buildWingRender(defaultWingFor("glasswing"), V);
    expect(render.tails).toEqual([]);
  });

  test("swallowtail with a long tail emits a tail path", () => {
    const render = buildWingRender(
      { family: "swallowtail", edge: "angular", tail: "long", pattern: "banded", complexity: 2 },
      V,
    );
    expect(render.tails.length).toBeGreaterThan(0);
  });

  test("clear pattern only appears on families with room for it", () => {
    for (const family of WING_FAMILIES) {
      const compat = compatibleTraits(family);
      const wing = normalizeWing(family, { pattern: "clear" });
      if (compat.patterns.includes("clear")) {
        expect(wing.pattern).toBe("clear");
      } else {
        expect(wing.pattern).not.toBe("clear");
      }
    }
  });

  test("edge treatment adds marks for scalloped and angular only", () => {
    const smooth = buildWingRender(
      { family: "owl", edge: "smooth", tail: "none", pattern: "eyespots", complexity: 2 },
      V,
    );
    const scalloped = buildWingRender(
      { family: "owl", edge: "scalloped", tail: "none", pattern: "eyespots", complexity: 2 },
      V,
    );
    expect(smooth.edgeMarks.length).toBe(0);
    expect(scalloped.edgeMarks.length).toBeGreaterThan(0);
  });
});
