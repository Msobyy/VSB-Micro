// Integration test: real (in-memory) replica-set Mongo, real Express app,
// no Kafka involved — proves the transaction + outbox-row-creation half of
// the pilot loop. The Kafka-publish half is covered by
// @vsb/event-bus's own outbox.test.js.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { startInMemoryReplicaSet, connectMongoose } from "@vsb/test-utils";
import { getOutboxModel } from "@vsb/event-bus";
import { createApp } from "../../src/app.js";
import { getCouponModel } from "../../src/models/couponModel.js";
import { createLogger } from "@vsb/logger";

describe("POST /api/v1/promotions/coupons/:code/redeem", () => {
  let replSet;
  let connection;
  let app;

  beforeAll(async () => {
    replSet = await startInMemoryReplicaSet();
    connection = await connectMongoose(replSet.uri, "promotions-test");
    app = createApp({ connection, logger: createLogger("promotions-service-test") });
  }, 60000);

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    await getCouponModel(connection).deleteMany({});
    await getOutboxModel(connection).deleteMany({});
  });

  async function seedCoupon(overrides = {}) {
    return getCouponModel(connection).create({
      code: "TEST10",
      type: "flat",
      value: 150,
      maxRedemptionsTotal: 2,
      validFrom: new Date(Date.now() - 86400000),
      validTo: new Date(Date.now() + 86400000),
      active: true,
      ...overrides,
    });
  }

  it("redeems a valid coupon and queues the event via the outbox", async () => {
    await seedCoupon();

    const res = await request(app)
      .post("/api/v1/promotions/coupons/test10/redeem")
      .send({ driverId: "driver_1", fareAmount: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.redemptionsCount).toBe(1);
    expect(res.body.eventId).toBeTypeOf("string");

    const outboxRow = await getOutboxModel(connection).findOne({ eventId: res.body.eventId });
    expect(outboxRow).not.toBeNull();
    expect(outboxRow.status).toBe("pending");
    expect(outboxRow.envelope.payload.amount).toBe(150);
  }, 30000);

  it("rejects redemption once the cap is exhausted", async () => {
    await seedCoupon({ maxRedemptionsTotal: 1 });

    const first = await request(app)
      .post("/api/v1/promotions/coupons/TEST10/redeem")
      .send({ driverId: "driver_1", fareAmount: 500 });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/v1/promotions/coupons/TEST10/redeem")
      .send({ driverId: "driver_2", fareAmount: 500 });
    expect(second.status).toBe(409);
  }, 30000);

  it("rejects a request missing driverId", async () => {
    await seedCoupon();
    const res = await request(app)
      .post("/api/v1/promotions/coupons/TEST10/redeem")
      .send({ fareAmount: 500 });
    expect(res.status).toBe(400);
  }, 30000);

  it("returns 409 for an unknown coupon code", async () => {
    const res = await request(app)
      .post("/api/v1/promotions/coupons/DOES-NOT-EXIST/redeem")
      .send({ driverId: "driver_1", fareAmount: 500 });
    expect(res.status).toBe(409);
  }, 30000);
});
