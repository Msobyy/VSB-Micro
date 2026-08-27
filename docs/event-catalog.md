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
- **Poison messages**: `runConsumer` (`libs/event-bus/src/consume.js`)
  retries a failing handler up to 3 times in-process, then publishes to
  `<topic>.dlq` (`dlq.js`) and moves on, rather than crash-looping the
  whole consumer on the same message forever or blocking everything queued
  behind it on that partition. A DLQ message carries the original
  envelope, the error + stack trace, attempt count, and which service's
  consumer group gave up on it.

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

### `auth.passenger.registered`

| | |
|---|---|
| Producer | `auth-service` (`src/services/passengerAuthService.js`) |
| Consumers | `notification-service` (welcome push) |
| Partition key | `passengerId` |
| Schema | `libs/event-schemas/src/events/passengerRegisteredV1.js` |

Payload:
```json
{
  "passengerId": "68a...",
  "phone": "+923001234567",
  "firstName": "Amina",
  "lastName": "Khan",
  "gender": "Female",
  "email": "amina@example.com",
  "city": "Lahore"
}
```

Carries the full profile snapshot, not just what auth-service itself
needs — auth-service only persists identity fields (see
`services/auth-service/CLAUDE.md`); this event is how a future
passenger-service would build its own profile record.

## Manual end-to-end check

With `docker compose --env-file .env -f infra/docker-compose.dev.yaml up`
running (see README for why `--env-file .env` is required), seed a
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
- Open http://localhost:16686 (Jaeger UI) → pick `api-gateway` from the
  service dropdown → Find Traces → the redemption should show as one
  connected trace spanning all four services (the request through
  `api-gateway`/`promotions-service`, then the async Kafka publish/process
  spans in `notification-service` and `analytics-service`) — see
  `docs/architecture-decision-records/0004-otel-preload-not-import.md` for
  how the Kafka boundary specifically is traced.

### Passenger auth walkthrough

With the stack up and `auth-service`'s Redis Cloud credentials set in the
root `.env` (see `.env.example`):

```bash
curl -X POST http://localhost:3000/api/v1/auth/send-otp \
  -H 'Content-Type: application/json' \
  -d '{"countryCode": "+92", "phoneNumber": "3001234567"}'
```

Check `auth-service`'s container logs for the OTP (console provider, no
real credentials configured by default). Then:

```bash
curl -X POST http://localhost:3000/api/v1/auth/verify-otp \
  -H 'Content-Type: application/json' \
  -d '{"countryCode": "+92", "phoneNumber": "3001234567", "otp": "<code from logs>", "deviceToken": "device-1"}'
# {"isNewUser": true} — no account yet, register one:

curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"countryCode": "+92", "phoneNumber": "3001234567", "firstName": "Amina", "lastName": "Khan", "gender": "Female", "deviceToken": "device-1"}'
```

Then:
- Check `notification-service` logs for a "Welcome to VSisters" push.
- Open Redpanda Console → `auth.passenger.registered` → confirm the message.
- `curl -X POST http://localhost:3000/api/v1/auth/verify -d '{"token": "<token from register>", "deviceToken": "device-1"}'`
  → `{"valid": true, ...}`. Log out (`POST /api/v1/auth/logout` with the
  token as a Bearer header and the same `device-token` header), then
  repeat the same `/verify` call — it should now return `{"valid": false}`,
  proving the session-revocation check actually works (not just JWT
  expiry — see `auth-service/CLAUDE.md`).
