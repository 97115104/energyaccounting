import { describe, expect, test } from "bun:test";
import {
  WING_EDGES,
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

    // Swallowtail's forewing apex is a sharp point; monarch's is broad.
    const apexAngle = (f: string) => {
      const pts = sil[f]!.fore.points;
      const i = pts.reduce((best, p, idx) => (p.x < pts[best]!.x ? idx : best), 0);
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const c = pts[i + 1]!;
      const v1 = Math.atan2(a.y - b.y, a.x - b.x);
      const v2 = Math.atan2(c.y - b.y, c.x - b.x);
      let deg = (Math.abs(v1 - v2) * 180) / Math.PI;
      if (deg > 180) deg = 360 - deg;
      return deg;
    };
    expect(apexAngle("swallowtail")).toBeLessThan(60);
    expect(apexAngle("monarch")).toBeGreaterThan(70);

    // Peacock's forewing margin doubles back on itself: the built-in notch.
    const peacock = sil.peacock!.fore;
    const [mFrom, mTo] = peacock.margin;
    const marginXs = peacock.points.slice(mFrom, mTo + 1).map((p) => p.x);
    const outwardThenBack = marginXs.some(
      (x, i) => i >= 1 && i < marginXs.length - 1 && x > marginXs[i - 1]! && x > marginXs[i + 1]!,
    );
    expect(outwardThenBack).toBe(true);
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

  test("swallowtail tails anchor on real hindwing landmarks", () => {
    const sil = familySilhouette("swallowtail", 12 * V.spread, 8 * V.aspect);
    const byDepth = [...sil.hind.points].sort((a, b) => b.y - a.y);
    for (const tail of ["short", "long", "twin"] as const) {
      const render = buildWingRender(
        { family: "swallowtail", edge: "angular", tail, pattern: "banded", complexity: 2 },
        V,
      );
      expect(render.tails.length).toBe(tail === "twin" ? 2 : 1);
      render.tails.forEach((d, i) => {
        // Each streamer's top edge is centered on its anchor landmark and
        // starts above it, so the shapes overlap and fill as one wing.
        const anchor = byDepth[i]!;
        const [x0, y0] = d.replace("M", "").split(" ").map(Number) as [number, number];
        const halfW = anchor.x - x0;
        expect(halfW).toBeGreaterThan(2);
        expect(halfW).toBeLessThan(8);
        expect(y0).toBe(anchor.y - 4);
      });
    }
  });

  test("all rendered outlines stay inside the viewBox and left of the body", () => {
    // Sample the extreme corners of the variation space with every edge, and
    // bound every coordinate that appears in the serialized paths. Control
    // points can overshoot the landmarks slightly, so the bounds include a
    // small tolerance while still catching runaway math.
    const extremes: WingVariation[] = [
      { ...V, spread: 0.35, aspect: 0 },
      { ...V, spread: 0.35, aspect: 1 },
      { ...V, spread: 0.85, aspect: 0 },
      { ...V, spread: 0.85, aspect: 1 },
    ];
    for (const family of WING_FAMILIES) {
      for (const edge of WING_EDGES) {
        for (const variation of extremes) {
          const render = buildWingRender({ family, ...NEUTRAL, edge }, variation);
          for (const d of [render.forewing, render.hindwing, ...render.tails]) {
            const coords = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
            for (let i = 0; i < coords.length; i += 2) {
              expect(coords[i]!).toBeGreaterThanOrEqual(0);
              expect(coords[i]!).toBeLessThanOrEqual(100);
              expect(coords[i + 1]!).toBeGreaterThanOrEqual(0);
              expect(coords[i + 1]!).toBeLessThanOrEqual(210);
            }
          }
        }
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
