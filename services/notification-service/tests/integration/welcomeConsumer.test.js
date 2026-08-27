// Same coverage shape as couponRedeemedConsumer.test.js — see that file's
// header comment.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startInMemoryReplicaSet, connectMongoose } from "@vsb/test-utils";
import { buildEventEnvelope } from "@vsb/event-bus";
import { PASSENGER_REGISTERED_TOPIC } from "@vsb/event-schemas";
import { welcomeConsumer } from "../../src/events/consumers/welcomeConsumer.js";

describe("welcomeConsumer", () => {
  let replSet;
  let connection;

  beforeAll(async () => {
    replSet = await startInMemoryReplicaSet();
    connection = await connectMongoose(replSet.uri, "notification-welcome-test");
  }, 60000);

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  function buildValidEvent() {
    return buildEventEnvelope({
      eventType: PASSENGER_REGISTERED_TOPIC,
      eventVersion: 1,
      source: "auth-service",
      partitionKey: "passenger_1",
      payload: { passengerId: "passenger_1", phone: "+923001234567", firstName: "Amina", lastName: "Khan", gender: "Female" },
    });
  }

  it("sends a welcome push for a valid, first-time event", async () => {
    const pushProvider = { sendPush: vi.fn().mockResolvedValue({ success: true }) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const handler = welcomeConsumer({ connection, pushProvider, logger });

    await handler(buildValidEvent());

    expect(pushProvider.sendPush).toHaveBeenCalledTimes(1);
    expect(pushProvider.sendPush.mock.calls[0][0]).toMatchObject({ token: "passenger:passenger_1" });
    expect(pushProvider.sendPush.mock.calls[0][0].body).toMatch(/Amina/);
  }, 30000);

  it("skips a redelivered duplicate without sending twice", async () => {
    const pushProvider = { sendPush: vi.fn().mockResolvedValue({ success: true }) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const handler = welcomeConsumer({ connection, pushProvider, logger });
    const event = buildValidEvent();

    await handler(event);
    await handler(event);

    expect(pushProvider.sendPush).toHaveBeenCalledTimes(1);
  }, 30000);

  it("drops a malformed event without calling the push provider", async () => {
    const pushProvider = { sendPush: vi.fn() };
    const logger = { info: vi.fn(), error: vi.fn() };
    const handler = welcomeConsumer({ connection, pushProvider, logger });

    const malformed = buildValidEvent();
    delete malformed.payload.passengerId;

    await handler(malformed);

    expect(pushProvider.sendPush).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  }, 30000);
});
