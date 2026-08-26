// Integration test: real (in-memory) Mongo for the idempotency store, a
// mocked push provider (no real Firebase/console IO needed to prove the
// wiring). Covers the two things that matter here: schema validation drops
// bad events, and idempotency prevents a double-send on redelivery.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startInMemoryReplicaSet, connectMongoose } from "@vsb/test-utils";
import { buildEventEnvelope } from "@vsb/event-bus";
import { COUPON_REDEEMED_TOPIC } from "@vsb/event-schemas";
import { couponRedeemedConsumer } from "../../src/events/consumers/couponRedeemedConsumer.js";

describe("couponRedeemedConsumer", () => {
  let replSet;
  let connection;

  beforeAll(async () => {
    replSet = await startInMemoryReplicaSet();
    connection = await connectMongoose(replSet.uri, "notification-test");
  }, 60000);

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  function buildValidEvent() {
    return buildEventEnvelope({
      eventType: COUPON_REDEEMED_TOPIC,
      eventVersion: 1,
      source: "promotions-service",
      partitionKey: "driver_1",
      payload: { couponCode: "TEST10", driverId: "driver_1", amount: 150, currency: "PKR", redeemedAt: new Date().toISOString() },
    });
  }

  it("sends a push for a valid, first-time event", async () => {
    const pushProvider = { sendPush: vi.fn().mockResolvedValue({ success: true }) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const handler = couponRedeemedConsumer({ connection, pushProvider, logger });

    await handler(buildValidEvent());

    expect(pushProvider.sendPush).toHaveBeenCalledTimes(1);
    expect(pushProvider.sendPush.mock.calls[0][0]).toMatchObject({ token: "driver:driver_1" });
  }, 30000);

  it("skips a redelivered duplicate without sending twice", async () => {
    const pushProvider = { sendPush: vi.fn().mockResolvedValue({ success: true }) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const handler = couponRedeemedConsumer({ connection, pushProvider, logger });
    const event = buildValidEvent();

    await handler(event);
    await handler(event); // simulated redelivery, same eventId

    expect(pushProvider.sendPush).toHaveBeenCalledTimes(1);
  }, 30000);

  it("drops a malformed event without calling the push provider", async () => {
    const pushProvider = { sendPush: vi.fn() };
    const logger = { info: vi.fn(), error: vi.fn() };
    const handler = couponRedeemedConsumer({ connection, pushProvider, logger });

    const malformed = buildValidEvent();
    delete malformed.payload.driverId;

    await handler(malformed);

    expect(pushProvider.sendPush).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  }, 30000);
});
