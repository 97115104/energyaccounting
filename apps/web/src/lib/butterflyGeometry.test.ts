import { describe, expect, test } from "bun:test";
import {
  WING_FAMILIES,
  buildWingRender,
  compatibleTraits,
  defaultWingFor,
  familySilhouette,
  normalizeWing,
  type WingConfig,
  type WingVariation,
} from "./butterflyGeometry";

const V: WingVariation = { spread: 0.6, aspect: 0.5, veinFan: 0.5, jitter: 0.4, band: 0.5 };

/** A trait set every family can render, so silhouette differences are family-only. */
const NEUTRAL: Omit<WingConfig, "family"> = {
  edge: "smooth",
  tail: "none",
  pattern: "veined",
  complexity: 2,
};

describe("wing geometry", () => {
  test("every family renders a non-empty forewing and hindwing", () => {
    for (const family of WING_FAMILIES) {
      const render = buildWingRender(defaultWingFor(family), V);
      expect(render.forewing.startsWith("M")).toBe(true);
      expect(render.hindwing.startsWith("M")).toBe(true);
    }
  });

  test("families produce distinct fore- and hindwings under identical traits", () => {
    const renders = WING_FAMILIES.map((family) =>
      buildWingRender({ family, ...NEUTRAL }, V),
    );
    expect(new Set(renders.map((r) => r.forewing)).size).toBe(WING_FAMILIES.length);
    expect(new Set(renders.map((r) => r.hindwing)).size).toBe(WING_FAMILIES.length);
  });

  test("family proportions match their described anatomy", () => {
    const reach = 12 * V.spread;
    const lift = 8 * V.aspect;
    const sil = Object.fromEntries(
      WING_FAMILIES.map((f) => [f, familySilhouette(f, reach, lift)]),
    );
    const foreReach = (f: string) => Math.min(...sil[f]!.fore.points.map((p) => p.x));
    const hindDepth = (f: string) => Math.max(...sil[f]!.hind.points.map((p) => p.y));

    // Slim families stay well inside the broad ones.
    expect(foreReach("glasswing")).toBeGreaterThan(foreReach("monarch"));
    expect(foreReach("glasswing")).toBeGreaterThan(foreReach("morpho"));
    // Longwing's blade reaches at least as far out as any broad family.
    expect(foreReach("longwing")).toBeLessThanOrEqual(foreReach("monarch"));
    // Owl's hindwing is the deepest; small-hindwing families sit well above it.
    expect(hindDepth("owl")).toBeGreaterThan(hindDepth("longwing"));
    expect(hindDepth("owl")).toBeGreaterThan(hindDepth("glasswing"));
    expect(hindDepth("owl")).toBeGreaterThan(hindDepth("monarch"));
  });

  test("edge trait reshapes the filled outline, not just decorations", () => {
    for (const family of WING_FAMILIES) {
      const smooth = buildWingRender({ family, ...NEUTRAL, edge: "smooth" }, V);
      const angular = buildWingRender({ family, ...NEUTRAL, edge: "angular" }, V);
      const scalloped = buildWingRender({ family, ...NEUTRAL, edge: "scalloped" }, V);
      expect(angular.forewing).not.toBe(smooth.forewing);
      expect(scalloped.forewing).not.toBe(smooth.forewing);
      expect(scalloped.forewing).not.toBe(angular.forewing);
      expect(angular.hindwing).not.toBe(smooth.hindwing);
      expect(scalloped.hindwing).not.toBe(smooth.hindwing);
    }
  });

  test("pattern and complexity never change the silhouette", () => {
    const base = buildWingRender({ family: "monarch", ...NEUTRAL }, V);
    for (const pattern of compatibleTraits("monarch").patterns) {
      for (const complexity of [0, 4] as const) {
        const render = buildWingRender(
          { family: "monarch", ...NEUTRAL, pattern, complexity },
          V,
        );
        expect(render.forewing).toBe(base.forewing);
        expect(render.hindwing).toBe(base.hindwing);
      }
    }
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

  test("swallowtail tails attach at the hindwing's lowest landmark", () => {
    for (const tail of ["short", "long", "twin"] as const) {
      const render = buildWingRender(
        { family: "swallowtail", edge: "angular", tail, pattern: "banded", complexity: 2 },
        V,
      );
      expect(render.tails.length).toBe(tail === "twin" ? 2 : 1);
      // Each tail starts overlapping the wing (above the lowest point), so the
      // fill joins seamlessly.
      const sil = familySilhouette("swallowtail", 12 * V.spread, 8 * V.aspect);
      const lowest = Math.max(...sil.hind.points.map((p) => p.y));
      for (const d of render.tails) {
        const startY = Number(d.split(" ")[1]);
        expect(startY).toBeLessThan(lowest);
      }
    }
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
});
