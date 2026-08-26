// Transactional outbox: solves the "dual write" problem where a service
// writes to its own DB and then separately publishes to Kafka, and a crash
// between the two loses the event (or publishes an event for a write that
// never committed). Instead, the domain write and an "outbox" row land in
// one Mongo transaction; outboxRelay.js tails that collection and is the
// only thing that actually talks to Kafka. Used by producer-side services
// (e.g. promotions-service's coupon redemption flow).
import mongoose from "mongoose";
import { captureTraceContext } from "./tracePropagation.js";

const outboxSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    topic: { type: String, required: true },
    partitionKey: { type: String, required: true },
    envelope: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ["pending", "sent"], default: "pending", index: true },
    sentAt: { type: Date },
    // W3C traceparent (etc), captured at write time so the relay can resume
    // the originating request's trace whenever it actually publishes —
    // see tracePropagation.js's header comment.
    traceContext: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "outbox" },
);

export function getOutboxModel(connection) {
  return connection.models.Outbox ?? connection.model("Outbox", outboxSchema);
}

/** Builds an outbox row ready to `.create([...], { session })` — callers
 * should never construct the plain object by hand, so traceContext capture
 * isn't something every producer has to remember to do itself. */
export function buildOutboxDocument({ eventId, topic, partitionKey, envelope }) {
  return {
    eventId,
    topic,
    partitionKey,
    envelope,
    status: "pending",
    traceContext: captureTraceContext(),
  };
}

/**
 * Runs `fn(session)` inside a Mongo transaction. `fn` is expected to perform
 * the domain write(s) and, in the same transaction, insert an outbox row via
 * `getOutboxModel(connection).create([{...}], { session })`.
 *
 * Requires `connection` to point at a replica-set-backed Mongo (MongoDB
 * Atlas already is one in production; local dev's docker-compose runs a
 * single-node replica set for the same reason — a standalone `mongod`
 * cannot run transactions or change streams).
 */
export async function withTransaction(connection, fn) {
  const session = await connection.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
