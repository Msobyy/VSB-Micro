import { describe, it, expect } from "vitest";
import { buildRedemptionQuery } from "../../src/controllers/redemptionsController.js";

describe("buildRedemptionQuery", () => {
  it("defaults to no filter and a limit of 50", () => {
    expect(buildRedemptionQuery({})).toEqual({ filter: {}, limit: 50 });
  });

  it("uppercases couponCode and passes driverId through", () => {
    const { filter } = buildRedemptionQuery({ driverId: "driver_1", couponCode: "test10" });
    expect(filter).toEqual({ driverId: "driver_1", couponCode: "TEST10" });
  });

  it("caps limit at 200 even if a larger value is requested", () => {
    expect(buildRedemptionQuery({ limit: "9999" }).limit).toBe(200);
  });
});
