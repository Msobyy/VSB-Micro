# CLAUDE.md

Guidance for working in this service specifically. See the repo root
`docs/service-boundaries.md` and `docs/event-catalog.md` for the
cross-service picture.

## What this is

`promotions-service` is the **producer** half of the vsb-microservices pilot
slice (see `docs/architecture-decision-records/`). It owns coupon
redemption — a deliberately simplified pilot port of
`vsb-backend/models/couponModel.js` (see `src/models/couponModel.js` header
comment for exactly what was dropped and why).

## Commands

```bash
pnpm --filter @vsb/promotions-service dev        # node --watch
pnpm --filter @vsb/promotions-service test        # unit tests, no IO
pnpm --filter @vsb/promotions-service test:integration  # spins up in-memory Mongo replica set
node scripts/seedCoupon.js TEST10 flat 150       # seed a coupon — no create endpoint exists yet
```

## Architecture

- `src/services/couponService.js` is the one path that matters: it claims a
  redemption slot on the coupon and queues the `promotions.coupon.redeemed`
  event in the **same Mongo transaction**, via `@vsb/event-bus`'s outbox
  helpers. It does not talk to Kafka directly — `src/server.js` starts
  `startOutboxRelay(...)` at boot, which is the only thing that publishes.
- Redemption count changes are always an atomic conditional `$inc`
  (`Coupon.findOneAndUpdate` with a filter precondition), never
  read-modify-write — this is the one invariant carried over from the
  original model verbatim, since it's what prevents concurrent redemptions
  from exceeding `maxRedemptionsTotal`.
- Routes live at `/api/v1/promotions/*`, matching the full path
  `api-gateway` forwards unmodified (see that service's `src/app.js`).

## Requires

A replica-set-backed Mongo (transactions + change streams) — MongoDB
Atlas, per the root `.env.example` (see ADR 0007). Atlas is always a
replica set, so no local bootstrapping is needed.
