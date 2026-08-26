// Builds the concrete envelope object a producer sends on the wire.
// Purpose: keeps eventId generation, timestamping, and the envelope shape in
// one place so every producer (e.g. promotions-service's coupon publisher)
// constructs events identically; validate the result against the matching
// zod schema from "@vsb/event-schemas" before publishing.
import { randomUUID } from "node:crypto";

export function buildEventEnvelope({ eventType, eventVersion, source, partitionKey, payload }) {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion,
    occurredAt: new Date().toISOString(),
    source,
    partitionKey,
    payload,
  };
}
