import { describe, expect, test } from "bun:test";
import { formatCityLabel } from "./reverseGeocode";

describe("formatCityLabel", () => {
  test("prefers locality over broader city, with region", () => {
    expect(
      formatCityLabel({
        locality: "Covina",
        city: "Los Angeles",
        region: "California",
      }),
    ).toBe("Covina, California");
  });

  test("falls back to city when locality is missing", () => {
    expect(formatCityLabel({ city: "Portland", region: "Oregon" })).toBe(
      "Portland, Oregon",
    );
  });

  test("avoids duplicating place and region", () => {
    expect(formatCityLabel({ city: "California", region: "California" })).toBe(
      "California",
    );
  });

  test("returns null when empty", () => {
    expect(formatCityLabel({})).toBeNull();
  });
});
