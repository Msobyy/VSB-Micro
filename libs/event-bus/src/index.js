// Public surface of @vsb/event-bus. Services import from here rather than
// reaching into individual files, so the internal module layout can change
// without breaking every service's imports.
export { createKafkaClient, createProducer, createConsumer } from "./kafka.js";
export { buildEventEnvelope } from "./envelope.js";
export { getOutboxModel, withTransaction, buildOutboxDocument } from "./outbox.js";
export { startOutboxRelay } from "./outboxRelay.js";
export { getProcessedEventModel, withIdempotency } from "./idempotency.js";
export { runConsumer } from "./consume.js";
