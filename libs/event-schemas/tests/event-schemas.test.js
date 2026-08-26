import { describe, it, expect } from "vitest";
import { couponRedeemedEventV1, COUPON_REDEEMED_TOPIC } from "../src/index.js";

describe("couponRedeemedEventV1", () => {
  const validEvent = {
    eventId: "evt_1",
    eventType: COUPON_REDEEMED_TOPIC,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    source: "promotions-service",
    partitionKey: "driver_123",
    payload: {
      couponCode: "TEST10",
      driverId: "driver_123",
      amount: 100,
      currency: "PKR",
      redeemedAt: new Date().toISOString(),
    },
  };

  it("accepts a well-formed event", () => {
    expect(couponRedeemedEventV1.safeParse(validEvent).success).toBe(true);
  });

  it("rejects a payload missing required fields", () => {
    const invalid = { ...validEvent, payload: { couponCode: "TEST10" } };
    expect(couponRedeemedEventV1.safeParse(invalid).success).toBe(false);
  });

  it("rejects an unsupported currency", () => {
    const invalid = { ...validEvent, payload: { ...validEvent.payload, currency: "USD" } };
    expect(couponRedeemedEventV1.safeParse(invalid).success).toBe(false);
  });
});
