import { describe, expect, test } from "bun:test";
import { normalizeIdentity } from "./identity.ts";
import { identityFaviconSvg } from "./identityFavicon.ts";

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

  test("butterfly output includes wing gradients", () => {
    const identity = normalizeIdentity({ symbol: "butterfly" }, "bf");
    const svg = identityFaviconSvg(identity, "#12182e", 32);
    expect(svg).toContain("linearGradient");
    expect(svg).toContain("favicon-bf-fore");
  });
});
