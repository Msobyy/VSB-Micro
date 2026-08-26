# CLAUDE.md

Guidance for working in this service specifically. See the repo root
`docs/service-boundaries.md` and `docs/event-catalog.md` for the
cross-service picture.

## What this is

`notification-service` is one of the two **consumer** halves of the
vsb-microservices pilot slice. It has no meaningful REST surface — it's a
Kafka consumer that reacts to `promotions.coupon.redeemed` (published by
`promotions-service`) and sends the driver a push notification.

## Commands

```bash
pnpm --filter @vsb/notification-service dev
pnpm --filter @vsb/notification-service test
pnpm --filter @vsb/notification-service test:integration
```

## Architecture

- `src/providers/` implements a swappable push-provider contract (see
  `pushProvider.js`'s header comment): `firebasePushProvider.js` is the real
  FCM integration (firebase-admin v14's modular API — note this is a
  different import style than vsb-backend's v13-based
  `config/firebase/firebase.js`), `consoleLogPushProvider.js` just logs.
  `providers/index.js` picks one from config; nothing else in this service
  imports firebase-admin directly.
- Falls back to the console provider automatically when `FIREBASE_*` env
  vars aren't set, so local dev doesn't need real credentials — see
  `.env.example`.
- `src/events/consumers/couponRedeemedConsumer.js` validates the incoming
  envelope against `@vsb/event-schemas` (a producer bug could ship a
  malformed event — this is the consumer-side half of the schema contract)
  and wraps the actual send in `@vsb/event-bus`'s `withIdempotency`, since
  Kafka only guarantees at-least-once delivery.
- There's no real driver-service yet, so there's no actual FCM device-token
  lookup — see that consumer file's NOTE for what a real extraction would
  need to add.
