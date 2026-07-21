import { beforeEach, describe, expect, test } from "bun:test";
import { greetingDetailFor, resetGreetingStateForTests } from "./greeting";

describe("greetingDetailFor", () => {
  beforeEach(() => resetGreetingStateForTests());

  test("facts always ship a verifiable https source link", () => {
    const detail = greetingDetailFor("Sam", { style: "facts" });
    expect(detail.text.length).toBeGreaterThan(0);
    expect(detail.factSource).toBeDefined();
    expect(detail.factSource!.label.length).toBeGreaterThan(0);
    expect(detail.factSource!.url.startsWith("https://")).toBe(true);
  });

  test("non-fact styles carry no source link", () => {
    const detail = greetingDetailFor("Sam", {
      style: "classic",
      now: new Date("2026-07-20T15:00:00Z"),
    });
    expect(detail.factSource).toBeUndefined();
  });
});
