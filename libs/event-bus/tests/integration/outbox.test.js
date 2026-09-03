// Exercises the outbox + idempotency logic against a real (in-memory)
// replica-set Mongo, since both features depend on transaction/unique-index
// behavior that's easy to get subtly wrong and not worth mocking.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { startInMemoryReplicaSet, connectMongoose } from "@vsb/test-utils";
import { getOutboxModel, withTransaction } from "../../src/outbox.js";
import { withIdempotency, getProcessedEventModel } from "../../src/idempotency.js";

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

  it("runs the handler's durable effect exactly once per eventId and skips redelivered duplicates", async () => {
    // A plain in-memory counter isn't the right thing to assert on here:
    // withIdempotency legitimately retries its whole attempt (marker +
    // handler) on a transient transaction error (a WriteConflict at
    // commit, say), and since that retry only ever happens when nothing
    // from the failed attempt was durably applied, the handler's Mongo
    // writes converge to exactly once even if the function body ran more
    // than once internally. What must hold is the durable state: exactly
    // one row written, and a redelivered duplicate is skipped outright.
    const Marker = connection.models.IdemMarker ?? connection.model("IdemMarker", new mongoose.Schema({ note: String }));
    const handler = async (session) => {
      await Marker.create([{ note: "handled" }], { session });
    };

    const first = await withIdempotency(connection, "evt-dup-1", handler);
    const second = await withIdempotency(connection, "evt-dup-1", handler);

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(await Marker.countDocuments({})).toBe(1);
  }, 30000);

  it("does not mark eventId processed if the handler fails, and genuinely retries it", async () => {
    // Regression test for the actual bug found: a prior version of
    // withIdempotency inserted the ProcessedEvent row BEFORE running the
    // handler, so a failed handler still left the eventId marked done —
    // a subsequent redelivery silently no-op'd as "already processed"
    // instead of retrying, and the failure vanished with no DLQ, no
    // record it never happened. Marking and handling must succeed or
    // fail together.
    let attempts = 0;

    await expect(
      withIdempotency(connection, "evt-fail-1", async () => {
        attempts += 1;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(attempts).toBe(1);
    expect(await getProcessedEventModel(connection).countDocuments({ eventId: "evt-fail-1" })).toBe(0);

    const retried = await withIdempotency(connection, "evt-fail-1", async () => {
      attempts += 1;
      return "ok";
    });

    expect(retried).toEqual({ skipped: false, result: "ok" });
    expect(attempts).toBe(2);
  }, 30000);
});
