// Kafka only guarantees at-least-once delivery, so every consumer must be
// idempotent. This tracks which eventIds a given service has already
// processed (its own Mongo collection — dedupe state is per-consumer, not
// shared) and skips the handler on redelivery. Used by consumer-side
// services (e.g. notification-service, analytics-service).
import mongoose from "mongoose";

const processedEventSchema = new mongoose.Schema(
  { eventId: { type: String, required: true, unique: true } },
  { timestamps: true, collection: "processed_events" },
);

export function getProcessedEventModel(connection) {
  return connection.models.ProcessedEvent ?? connection.model("ProcessedEvent", processedEventSchema);
}

/**
 * Runs `handler()` only if `eventId` hasn't been processed before by this
 * service. Relies on the unique index on `eventId` to make the check safe
 * under concurrent delivery, rather than a separate exists-check-then-insert
 * (which would race).
 */
export async function withIdempotency(connection, eventId, handler) {
  const ProcessedEvent = getProcessedEventModel(connection);
  try {
    await ProcessedEvent.create({ eventId });
  } catch (err) {
    if (err.code === 11000) {
      return { skipped: true }; // already processed this eventId
    }
    throw err;
  }
  const result = await handler();
  return { skipped: false, result };
}
