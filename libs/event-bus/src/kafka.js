// Thin wrapper around kafkajs's client/producer/consumer setup.
// Purpose: every service creates its Kafka client the same way (same
// clientId convention, same log level) instead of each service configuring
// kafkajs from scratch. Used by services/*/src/events/publishers (via
// createProducer) and services/*/src/events/consumers (via createConsumer).
import { Kafka, logLevel } from "kafkajs";

export function createKafkaClient({ clientId, brokers }) {
  return new Kafka({ clientId, brokers, logLevel: logLevel.WARN });
}

// idempotent: true makes the broker dedupe retried produce requests (a
// producer-id + per-partition sequence number pair, assigned on connect)
// so a transient network blip that causes kafkajs to retry a send can't
// also double-append the message — without this, at-least-once delivery
// starts one layer earlier than intended (in the broker log itself, not
// just "a consumer might see a message twice"). Requires acks: -1/"all"
// on every send (the kafkajs default already — see tracePropagation.js
// and dlq.js, which set it explicitly anyway rather than relying on that
// default silently doing the right thing) and maxInFlightRequests <= 5;
// kafkajs enforces both once idempotent is set, so nothing else to tune.
export async function createProducer(kafka) {
  const producer = kafka.producer({ idempotent: true });
  await producer.connect();
  return producer;
}

export async function createConsumer(kafka, groupId) {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  return consumer;
}
