# Event catalog

## Conventions

- **Topic naming**: `<domain>.<entity>.<event>`.
- **Partition key**: the relevant entity id (preserves per-entity ordering).
- **Envelope**: every message is `{ eventId, eventType, eventVersion,
  occurredAt, source, partitionKey, payload }` — see
  `libs/event-schemas/src/envelope.js`.
- **Schema**: zod, versioned by filename (e.g. `couponRedeemedV1.js`).
  Consumers validate on read and drop (log + skip, not crash) on mismatch.
- **Delivery**: at-least-once. Every consumer must be idempotent — see
  `libs/event-bus/src/idempotency.js`.
- **Reliability**: transactional outbox on the producer side — see
  `libs/event-bus/src/outbox.js` + `outboxRelay.js`.

## Topics

### `promotions.coupon.redeemed`

| | |
|---|---|
| Producer | `promotions-service` (`src/services/couponService.js`) |
| Consumers | `notification-service`, `analytics-service` |
| Partition key | `driverId` |
| Schema | `libs/event-schemas/src/events/couponRedeemedV1.js` |

Payload:
```json
{
  "couponCode": "TEST10",
  "driverId": "driver_123",
  "amount": 99.9,
  "currency": "PKR",
  "redeemedAt": "2026-08-26T10:00:00.000Z"
}
```

## Manual end-to-end check

With `docker compose -f infra/docker-compose.dev.yaml up` running, seed a
coupon first (no create-coupon endpoint exists in this pilot):

```bash
docker exec -w /repo/services/promotions-service vsb-promotions-service \
  node scripts/seedCoupon.js TEST10 flat 150
```

Then redeem it:

```bash
curl -X POST http://localhost:3000/api/v1/promotions/coupons/TEST10/redeem \
  -H 'Content-Type: application/json' \
  -d '{"driverId": "driver_123", "fareAmount": 1000}'
```

Then:
- Open http://localhost:8080 (Redpanda Console) → Topics →
  `promotions.coupon.redeemed` → confirm the message landed.
- Check `notification-service` container logs for a "simulated push send"
  (or a real FCM log line if `FIREBASE_*` env vars are set) entry.
- `curl http://localhost:3000/api/v1/analytics/redemptions` → confirm the
  redemption shows up in the read model.
