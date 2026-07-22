/**
 * Content pack smoke tests: JSON catalogs must stay uniquely keyed and tagged
 * so Activity suggestions can filter physical items without runtime surprises.
 */
import { describe, expect, it } from "bun:test";
import affirmations from "../content/affirmations.json";
import greetings from "../content/greetings.json";
import movement from "../content/movement-families.json";
import novel from "../content/novel-activities.json";
import play from "../content/play-prompts.json";
import { MOVEMENT_FAMILIES } from "./activityCatalog";
import { suggestActivities } from "./activitySuggest";
import { suggestPlayDeposits } from "./playCategories";

describe("content packs", () => {
  it("affirmations are unique non-empty strings", () => {
    expect(affirmations.length).toBeGreaterThan(100);
    expect(new Set(affirmations).size).toBe(affirmations.length);
    for (const line of affirmations) expect(line.trim().length).toBeGreaterThan(0);
  });

  it("greetings cover classic slots, humor, and cited facts", () => {
    for (const slot of ["morning", "afternoon", "evening", "night"] as const) {
      expect(greetings.classic[slot].named.length).toBeGreaterThan(0);
      expect(greetings.classic[slot].anonymous.length).toBeGreaterThan(0);
    }
    expect(greetings.humor.named.length).toBe(greetings.humor.anonymous.length);
    expect(greetings.facts.length).toBeGreaterThan(10);
    for (const fact of greetings.facts) {
      expect(fact.source.url.startsWith("http")).toBe(true);
      expect(Array.isArray(fact.links)).toBe(true);
      expect(fact.links.length).toBeGreaterThan(0);
      for (const link of fact.links) {
        expect(fact.anonymous).toContain(link.phrase);
        expect(link.url.startsWith("http")).toBe(true);
      }
    }
  });

  it("play prompts declare physical tags", () => {
    expect(play.some((p) => p.physical)).toBe(true);
    expect(play.some((p) => !p.physical)).toBe(true);
  });

  it("novel activities have unique ids and known conditions", () => {
    const ids = novel.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of novel) {
      expect(["always", "outdoorSafe"]).toContain(n.condition);
      expect(typeof n.physical).toBe("boolean");
    }
  });

  it("movement families compile matchers that recognize dose labels", () => {
    expect(MOVEMENT_FAMILIES).toHaveLength(movement.length);
    for (const family of MOVEMENT_FAMILIES) {
      expect(family.matcher.test(family.primary.tiers[0]!.label)).toBe(true);
      expect(family.gentlerMatcher.test(family.gentler.tiers[0]!.label)).toBe(true);
    }
  });
});

describe("includePhysicalActivities gating", () => {
  const base = {
    date: "2026-07-21",
    available: 80,
    weatherKind: "cloud" as const,
    uvMax: 3,
    isDaylight: true,
    withdrawalHeavy: true,
    existingLabels: [] as string[],
    candidates: [],
  };

  it("suppresses movement and physical novel tips when false", () => {
    const suggestions = suggestActivities({
      ...base,
      includePhysicalActivities: false,
    });
    expect(suggestions.every((s) => !s.id.startsWith("movement:"))).toBe(true);
    expect(suggestions.every((s) => s.id !== "healthy:short-walk")).toBe(true);
    expect(suggestions.every((s) => s.id !== "healthy:gentle-stretch")).toBe(true);
    expect(
      suggestions.some((s) =>
        ["healthy:journal", "healthy:call-or-text", "healthy:read-poem", "healthy:mindful-pause"].includes(
          s.id,
        ),
      ),
    ).toBe(true);
  });

  it("suppresses familiar indoor physical history when false", () => {
    const suggestions = suggestActivities({
      ...base,
      includePhysicalActivities: false,
      candidates: [
        {
          id: "c1",
          side: "deposit",
          label: "Gym workout",
          typicalCost: 20,
          weekdayMask: 127,
          useCount: 12,
          lastUsed: "2026-07-20",
        },
        {
          id: "c2",
          side: "deposit",
          label: "Journal for five minutes",
          typicalCost: 10,
          weekdayMask: 127,
          useCount: 4,
          lastUsed: "2026-07-20",
        },
      ],
    });
    expect(suggestions.every((s) => s.label !== "Gym workout")).toBe(true);
    expect(suggestions.some((s) => s.label === "Journal for five minutes" || s.id.startsWith("healthy:"))).toBe(
      true,
    );
  });

  it("filters physical play prompts when false but keeps stim", () => {
    const plays = suggestPlayDeposits({
      existingLabels: [],
      daySeed: "2026-07-21",
      count: 8,
      includePhysicalActivities: false,
    });
    expect(plays.every((p) => !p.physical)).toBe(true);
    expect(plays.some((p) => p.label === "Movement or stim break")).toBe(true);
    expect(plays.some((p) => p.label === "Dance to one song")).toBe(false);
  });
});
