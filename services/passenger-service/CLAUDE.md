# CLAUDE.md

Guidance for working in this service specifically. See the repo root
`docs/service-boundaries.md` and `docs/event-catalog.md` for the
cross-service picture.

## What this is

`passenger-service` owns passenger **profile** data (firstName, lastName,
gender, email, city) — the bounded-context split `auth-service`'s own
model was slimmed down to set up. It's a port of the profile-relevant
subset of `vsb-backend`'s `GET /get_passenger` / `PATCH /profile`
(`controllers/passenger/passengerController.js`). Ride-derived fields
(rating, completedRides, cancelledRides), the coupon-redemption ledger,
and location/telemetry are deliberately **not** ported — see
`src/models/passengerProfileModel.js`'s header comment for why.

## Commands

```bash
pnpm --filter @vsb/passenger-service dev
pnpm --filter @vsb/passenger-service test
pnpm --filter @vsb/passenger-service test:integration
```

## Architecture

- **No `POST /passengers` endpoint.** The only way a profile gets
  created is `src/events/consumers/passengerRegisteredConsumer.js`
  reacting to `auth.passenger.registered` — a profile without a
  corresponding identity record in auth-service shouldn't be able to
  exist. This is the first service in the repo whose primary record is
  created by *reacting to an event*, not an HTTP call — proving the CQRS
  pattern generalizes past `analytics-service`'s read-only version.
- The profile document's `_id` is the **same ObjectId** auth-service
  minted at registration, never regenerated — the correlation key across
  both services' databases. No foreign-key translation, no lookup table.
- **`src/middlewares/requireAuth.js` is the first real synchronous
  inter-service REST call in this repo** — it POSTs to auth-service's
  `/api/v1/auth/verify` (plain `fetch`, same choice api-gateway's
  `attachUser` made) to resolve who's calling. Unlike `attachUser`, this
  is **not** soft — every route behind it serves or mutates one specific
  person's PII, so a missing/invalid token or an unreachable
  auth-service both reject the request (401 / 503) rather than letting
  it through.
- **No `/:id` route.** `GET`/`PATCH /me` always resolve the caller from
  the verified token (`req.passengerId`), never from a client-supplied
  id — this rules out IDOR by construction rather than relying on an
  ownership check to catch it. Applying `auth-service`'s audit lesson
  (`docs/architecture-decision-records/0009`) from the start: strict
  per-field validation and rate limiting are in place from day one here,
  not added after an incident.
- `GET`/`PATCH /me` can legitimately 503 with `PROFILE_NOT_READY`
  immediately after a fresh registration — the event hasn't been
  consumed yet. Real eventual-consistency lag, not a bug; a client
  should retry briefly, not treat it as a hard failure.
