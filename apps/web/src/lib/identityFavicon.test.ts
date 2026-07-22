import { describe, expect, test } from "bun:test";
import { normalizeIdentity } from "./identity.ts";
import { identityFaviconSvg } from "./identityFaviconSvg.ts";

describe("identityFaviconSvg", () => {
  test("renders each symbol as a namespaced SVG tile", () => {
    for (const symbol of [
      "butterfly",
      "rainbow-infinity",
      "gold-infinity",
      "rainbow-pride",
    ] as const) {
      const identity = normalizeIdentity({ symbol }, "favicon-test");
      const svg = identityFaviconSvg(identity, "#fff6c8");
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain('fill="#fff6c8"');
      expect(svg.length).toBeGreaterThan(200);
    }
  });

  test("identity favicon scales from the correct viewBox width and height", () => {
    const identity = normalizeIdentity({ symbol: "butterfly" }, "vb");
    const svg = identityFaviconSvg(identity, "#fff6c8", 180);
    // Correct parse yields a non-zero scale and a translate that is not half-width.
    expect(svg).toMatch(/scale\(0\.\d+\)/);
    expect(svg).not.toMatch(/translate\(90\.00/);
  });
});
