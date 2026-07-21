import { describe, expect, test } from "bun:test";
import { parseSharePayload } from "./identityShare";
import {
  DEFAULT_SHARE_SECTIONS,
  emptyYouProfile,
  normalizeYouProfile,
  selectShareContent,
} from "./youProfile";

describe("normalizeYouProfile", () => {
  test("round-trips a valid profile", () => {
    const profile = {
      version: 1,
      about: "I like trains.",
      communication: "Direct and written.",
      support: "Quiet room.",
      traits: [{ id: "interest:trains", kind: "interest", label: "Trains" }],
      dismissedTraitIds: ["rhythm:monday"],
      colorMeanings: [{ slot: "primary", meaning: "Trains at dusk" }],
    };
    expect(normalizeYouProfile(profile)).toEqual(profile as never);
  });

  test("junk collapses to an empty profile instead of crashing", () => {
    for (const junk of [null, 3, "x", [], { traits: "no", colorMeanings: 5 }]) {
      const out = normalizeYouProfile(junk);
      expect(out.version).toBe(1);
      expect(out.traits).toEqual([]);
      expect(out.colorMeanings).toEqual([]);
    }
  });

  test("invalid trait kinds fall back to interest, invalid slots are dropped", () => {
    const out = normalizeYouProfile({
      traits: [{ id: "x", kind: "villain-arc", label: "X" }],
      colorMeanings: [{ slot: "wing-99", meaning: "?" }],
    });
    expect(out.traits[0]!.kind).toBe("interest");
    expect(out.colorMeanings).toEqual([]);
  });
});

describe("selectShareContent", () => {
  const profile = {
    ...emptyYouProfile(),
    about: "About me.",
    communication: "Plainly.",
    traits: [{ id: "t", kind: "interest" as const, label: "Birds" }],
  };

  test("everything is off by default", () => {
    expect(selectShareContent(profile, DEFAULT_SHARE_SECTIONS)).toEqual({});
  });

  test("only chosen sections cross over", () => {
    const out = selectShareContent(profile, {
      ...DEFAULT_SHARE_SECTIONS,
      about: true,
      traits: true,
    });
    expect(out).toEqual({ about: "About me.", traits: profile.traits });
    expect("communication" in out).toBe(false);
  });

  test("empty chosen sections are omitted rather than shared blank", () => {
    const out = selectShareContent(profile, {
      ...DEFAULT_SHARE_SECTIONS,
      support: true,
      colorMeanings: true,
    });
    expect(out).toEqual({});
  });
});

describe("parseSharePayload", () => {
  test("parses a well-formed public payload", () => {
    const out = parseSharePayload({
      version: 1,
      name: "Alex",
      identity: {
        version: 1,
        symbol: "gold-infinity",
        archetype: "monarch",
        palette: { primary: "#112233", secondary: "#445566", accent: "#778899" },
        seed: "alex",
        motion: "auto",
      },
      about: "Hello.",
      traits: [{ id: "t", kind: "interest", label: "Maps" }],
    });
    expect(out?.name).toBe("Alex");
    expect(out?.identity.symbol).toBe("gold-infinity");
    expect(out?.about).toBe("Hello.");
    expect(out?.traits?.[0]?.label).toBe("Maps");
  });

  test("hostile payloads are neutralized, not rendered raw", () => {
    const out = parseSharePayload({
      name: 42,
      identity: { symbol: "evil", palette: { primary: "javascript:alert(1)" } },
      about: "",
      traits: [{ label: 9 }, "junk"],
    });
    expect(out?.name).toBeNull();
    expect(out?.identity.symbol).toBe("butterfly");
    expect(out?.identity.palette.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(out?.about).toBeUndefined();
    expect(out?.traits).toBeUndefined();
  });

  test("non-objects return null", () => {
    expect(parseSharePayload(null)).toBeNull();
    expect(parseSharePayload("x")).toBeNull();
  });
});
