// Covers both halves of this service: the consumer building the read model,
// and the HTTP API reading it back — against a real (in-memory) Mongo.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { startInMemoryReplicaSet, connectMongoose } from "@vsb/test-utils";
import { buildEventEnvelope } from "@vsb/event-bus";
import { COUPON_REDEEMED_TOPIC } from "@vsb/event-schemas";
import { createApp } from "../../src/app.js";
import { createLogger } from "@vsb/logger";
import { getRedemptionModel } from "../../src/models/redemptionReadModel.js";
import { couponRedeemedConsumer } from "../../src/events/consumers/couponRedeemedConsumer.js";

describe("analytics-service redemptions", () => {
  let replSet;
  let connection;
  let app;
  let logger;

  beforeAll(async () => {
    replSet = await startInMemoryReplicaSet();
    connection = await connectMongoose(replSet.uri, "analytics-test");
    logger = createLogger("analytics-service-test");
    app = createApp({ connection, logger });
  }, 60000);

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    await getRedemptionModel(connection).deleteMany({});
  });

  function buildEvent(overrides = {}) {
    return buildEventEnvelope({
      eventType: COUPON_REDEEMED_TOPIC,
      eventVersion: 1,
      source: "promotions-service",
      partitionKey: "driver_1",
      payload: {
        couponCode: "TEST10",
        driverId: "driver_1",
        amount: 150,
        currency: "PKR",
        redeemedAt: new Date().toISOString(),
        ...overrides,
      },
    });
  }

  it("consumer writes a queryable row, then the API returns it", async () => {
    const handler = couponRedeemedConsumer({ connection, logger });
    await handler(buildEvent());

    const res = await request(app).get("/api/v1/analytics/redemptions").query({ driverId: "driver_1" });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.redemptions[0]).toMatchObject({ couponCode: "TEST10", driverId: "driver_1", amount: 150 });
  }, 30000);

  it("filters by couponCode case-insensitively via the query param", async () => {
    const handler = couponRedeemedConsumer({ connection, logger });
    await handler(buildEvent({ couponCode: "SUMMER5" }));
    await handler(buildEvent({ couponCode: "TEST10" }));

    const res = await request(app).get("/api/v1/analytics/redemptions").query({ couponCode: "summer5" });

    expect(res.body.count).toBe(1);
    expect(res.body.redemptions[0].couponCode).toBe("SUMMER5");
  }, 30000);
});
