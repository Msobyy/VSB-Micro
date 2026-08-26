import { describe, it, expect } from "vitest";
import { computeRedeemedAmount } from "../../src/services/couponService.js";

describe("computeRedeemedAmount", () => {
  it("returns the flat value unchanged regardless of fare", () => {
    expect(computeRedeemedAmount({ type: "flat", value: 150 }, 900)).toBe(150);
  });

  it("computes a percentage of the fare, rounded to 2 decimals", () => {
    expect(computeRedeemedAmount({ type: "percent", value: 10 }, 999)).toBe(99.9);
  });
});
