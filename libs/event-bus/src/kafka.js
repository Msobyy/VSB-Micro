// Thin wrapper around kafkajs's client/producer/consumer setup.
// Purpose: every service creates its Kafka client the same way (same
// clientId convention, same log level) instead of each service configuring
// kafkajs from scratch. Used by services/*/src/events/publishers (via
// createProducer) and services/*/src/events/consumers (via createConsumer).
import { Kafka, logLevel } from "kafkajs";

export function createKafkaClient({ clientId, brokers }) {
  return new Kafka({ clientId, brokers, logLevel: logLevel.WARN });
}

export async function createProducer(kafka) {
  const producer = kafka.producer();
  await producer.connect();
  return producer;
}

export async function createConsumer(kafka, groupId) {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  return consumer;
}
