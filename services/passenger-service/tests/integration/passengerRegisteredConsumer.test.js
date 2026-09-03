// Same coverage shape as notification-service's/analytics-service's
// consumer tests: schema validation drops bad events, idempotency
// prevents a double-create on redelivery, and — specific to this
// service — the created document's _id is exactly the passengerId from
// the event, not a freshly generated one.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { startInMemoryReplicaSet, connectMongoose } from "@vsb/test-utils";
import { buildEventEnvelope } from "@vsb/event-bus";
import { PASSENGER_REGISTERED_TOPIC } from "@vsb/event-schemas";
import { createLogger } from "@vsb/logger";
import { passengerRegisteredConsumer } from "../../src/events/consumers/passengerRegisteredConsumer.js";
import { getPassengerProfileModel } from "../../src/models/passengerProfileModel.js";

describe("passengerRegisteredConsumer", () => {
  let replSet;
  let connection;
  const logger = createLogger("passenger-service-test");

  beforeAll(async () => {
    replSet = await startInMemoryReplicaSet();
    connection = await connectMongoose(replSet.uri, "passenger-service-test");
  }, 60000);

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    await getPassengerProfileModel(connection).deleteMany({});
  });

  function buildEvent(overrides = {}) {
    return buildEventEnvelope({
      eventType: PASSENGER_REGISTERED_TOPIC,
      eventVersion: 1,
      source: "auth-service",
      partitionKey: "6a0000000000000000000001",
      payload: {
        passengerId: "6a0000000000000000000001",
        phone: "+923001234567",
        firstName: "Amina",
        lastName: "Khan",
        gender: "Female",
        email: "amina@example.com",
        city: "Lahore",
        ...overrides,
      },
    });
  }

  it("creates a profile keyed by the exact passengerId from the event", async () => {
    const handler = passengerRegisteredConsumer({ connection, logger });
    await handler(buildEvent());

    const profile = await getPassengerProfileModel(connection).findById("6a0000000000000000000001").lean();
    expect(profile).not.toBeNull();
    expect(profile.firstName).toBe("Amina");
    expect(profile.city).toBe("Lahore");
  }, 30000);

  it("skips a redelivered duplicate without creating twice", async () => {
    const handler = passengerRegisteredConsumer({ connection, logger });
    const event = buildEvent();

    await handler(event);
    await handler(event);

    const count = await getPassengerProfileModel(connection).countDocuments({});
    expect(count).toBe(1);
  }, 30000);

  it("drops a malformed event without creating a profile", async () => {
    const handler = passengerRegisteredConsumer({ connection, logger });
    const malformed = buildEvent();
    delete malformed.payload.gender; // required field

    await handler(malformed);

    const count = await getPassengerProfileModel(connection).countDocuments({});
    expect(count).toBe(0);
  }, 30000);
});
