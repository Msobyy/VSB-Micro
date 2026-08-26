// Exercises the outbox + idempotency logic against a real (in-memory)
// replica-set Mongo, since both features depend on transaction/unique-index
// behavior that's easy to get subtly wrong and not worth mocking.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { startInMemoryReplicaSet, connectMongoose } from "@vsb/test-utils";
import { getOutboxModel, withTransaction } from "../../src/outbox.js";
import { withIdempotency } from "../../src/idempotency.js";

describe("outbox + idempotency", () => {
  let replSet;
  let connection;

  beforeAll(async () => {
    replSet = await startInMemoryReplicaSet();
    connection = await connectMongoose(replSet.uri, "outbox-test");
  }, 60000);

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  it("commits the domain write and the outbox row atomically", async () => {
    const Widget = connection.models.Widget ?? connection.model("Widget", new mongoose.Schema({ name: String }));
    const Outbox = getOutboxModel(connection);

    await withTransaction(connection, async (session) => {
      await Widget.create([{ name: "test-widget" }], { session });
      await Outbox.create(
        [{ eventId: "evt-1", topic: "widget.created", partitionKey: "w1", envelope: { hello: "world" } }],
        { session },
      );
    });

    expect(await Widget.countDocuments({ name: "test-widget" })).toBe(1);
    expect(await Outbox.countDocuments({ eventId: "evt-1" })).toBe(1);
  }, 30000);

  it("rolls back both writes if the transaction fails", async () => {
    const Widget = connection.models.Widget;
    const Outbox = getOutboxModel(connection);

    await expect(
      withTransaction(connection, async (session) => {
        await Widget.create([{ name: "rolled-back-widget" }], { session });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await Widget.countDocuments({ name: "rolled-back-widget" })).toBe(0);
    expect(await Outbox.countDocuments({ topic: "boom" })).toBe(0);
  }, 30000);

  it("runs the handler once per eventId and skips redelivered duplicates", async () => {
    let callCount = 0;
    const handler = async () => {
      callCount += 1;
    };

    const first = await withIdempotency(connection, "evt-dup-1", handler);
    const second = await withIdempotency(connection, "evt-dup-1", handler);

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(callCount).toBe(1);
  }, 30000);
});
