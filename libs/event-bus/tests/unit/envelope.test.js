// Pure-function test — no Mongo/Kafka needed, mirrors vsb-backend's
// unit-vs-integration split (tests/unit = no IO).
import { describe, it, expect } from "vitest";
import { buildEventEnvelope } from "../../src/envelope.js";

describe("buildEventEnvelope", () => {
  it("stamps a fresh eventId and ISO timestamp onto the given fields", () => {
    const envelope = buildEventEnvelope({
      eventType: "promotions.coupon.redeemed",
      eventVersion: 1,
      source: "promotions-service",
      partitionKey: "driver_1",
      payload: { couponCode: "TEST10" },
    });

    expect(envelope.eventId).toBeTypeOf("string");
    expect(envelope.eventId.length).toBeGreaterThan(0);
    expect(() => new Date(envelope.occurredAt).toISOString()).not.toThrow();
    expect(envelope.eventType).toBe("promotions.coupon.redeemed");
    expect(envelope.payload).toEqual({ couponCode: "TEST10" });
  });

  it("generates a distinct eventId on each call", () => {
    const a = buildEventEnvelope({ eventType: "x", eventVersion: 1, source: "s", partitionKey: "k", payload: {} });
    const b = buildEventEnvelope({ eventType: "x", eventVersion: 1, source: "s", partitionKey: "k", payload: {} });
    expect(a.eventId).not.toBe(b.eventId);
  });
});
