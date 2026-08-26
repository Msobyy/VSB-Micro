# CLAUDE.md

Guidance for working in this service specifically. See the repo root
`docs/service-boundaries.md` and `docs/event-catalog.md` for the
cross-service picture.

## What this is

`analytics-service` is the other **consumer** half of the pilot slice, and
the one that proves the CQRS read-model pattern: it builds
`src/models/redemptionReadModel.js` purely by consuming
`promotions.coupon.redeemed` events, and exposes a read-only
`GET /api/v1/analytics/redemptions` query over it. It never calls
promotions-service directly.

## Commands

```bash
pnpm --filter @vsb/analytics-service dev
pnpm --filter @vsb/analytics-service test
pnpm --filter @vsb/analytics-service test:integration
```

## Architecture

- The read model is fully rebuildable from the topic — if `redemptions` were
  dropped, replaying `promotions.coupon.redeemed` from the beginning would
  reconstruct it. That disposability is the point of a CQRS read model, so
  don't add any write path to this collection other than the consumer.
- Uses `@vsb/event-bus`'s `withIdempotency` the same way
  notification-service does, but against its own `processed_events`
  collection — the two services' dedupe state is independent, matching
  Kafka's per-consumer-group delivery tracking.
- Routes live at `/api/v1/analytics/*`, matching the full path
  `api-gateway` forwards unmodified.
- `server.js` creates a second Kafka producer (`dlqProducer`) purely for
  `runConsumer`'s DLQ fallback — see `docs/event-catalog.md`'s Conventions
  section. Any service consuming via `runConsumer` needs one, since
  `@vsb/event-bus` never creates connections on a service's behalf.
