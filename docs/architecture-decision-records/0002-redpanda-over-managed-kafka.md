# 0002: Redpanda (self-hosted) over managed Kafka

## Status
Accepted (2026-08-26)

## Context
Kafka is a firm requirement for the event backbone. The choice is how to
run it: self-hosted vs. a managed service (AWS MSK, Confluent Cloud).

## Decision
Self-hosted Redpanda via Docker for local dev now. Redpanda is Kafka-API
wire-compatible, so `kafkajs` (the client used throughout `libs/event-bus`)
works against it unmodified — nothing in application code is
Redpanda-specific.

## Consequences
- Zero extra cloud cost while the pattern is being proven out.
- Swapping to AWS MSK or Confluent Cloud later means changing
  `KAFKA_BROKERS` (and adding auth config) — no application code changes,
  since everything goes through `libs/event-bus`'s `createKafkaClient`.
- Trade-off accepted: self-hosting means someone eventually owns
  operating a production Kafka-compatible cluster (upgrades, disk,
  monitoring) — revisit this decision specifically when moving the event
  bus itself to production, not necessarily when the first real service
  extraction happens.
