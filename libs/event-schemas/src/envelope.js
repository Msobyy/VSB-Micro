import { z } from "zod";

/**
 * Every event on the bus is wrapped in this envelope. `payload` is
 * event-specific — narrowed per event type via `buildEnvelopeSchema`.
 */
export const eventEnvelopeSchema = z.object({
  eventId: z.string(),
  eventType: z.string(),
  eventVersion: z.number().int().positive(),
  occurredAt: z.string(),
  source: z.string(),
  partitionKey: z.string(),
  payload: z.unknown(),
});

export function buildEnvelopeSchema(payloadSchema) {
  return eventEnvelopeSchema.extend({ payload: payloadSchema });
}
