# CLAUDE.md

Guidance for working in this service specifically. See the repo root
`docs/service-boundaries.md` and `docs/event-catalog.md` for the
cross-service picture.

## What this is

`auth-service` owns **passenger** identity and session auth — a port of
`vsb-backend`'s passenger OTP login/register flow
(`controllers/passenger/authController.js`,
`middlewares/passenger/authMiddleware.js`, `services/otpService.js` +
`whatsappOTPService.js`). Driver auth and CRM/admin auth are deliberately
**not** built yet — they're structurally different (driver adds document
upload + manual verification; CRM is password+RBAC, not OTP) and are
planned as later, separate increments. `vsb-backend` itself is untouched;
this is a standalone new service, not a cutover.

## Commands

```bash
pnpm --filter @vsb/auth-service dev
pnpm --filter @vsb/auth-service test
pnpm --filter @vsb/auth-service test:integration
```

## Architecture

- **Identity only, not profile.** `src/models/passengerModel.js` holds
  phone/role/session/block-status fields only — no firstName/lastName/
  gender/city. Those are profile data, a different bounded context that
  belongs to a future `passenger-service`. `register()` accepts them
  (the client collects them at signup) but only ever puts them in the
  `auth.passenger.registered` event payload and the HTTP response —
  never persists them here. See `passengerAuthService.js`'s `register()`
  comment for the reasoning and the known gap this creates (email
  uniqueness isn't enforced by anyone yet, since auth-service doesn't
  store email and passenger-service doesn't exist).
- `src/providers/` is a swappable OTP-delivery contract (see
  `otpProvider.js`'s header comment) — same pattern as
  `notification-service`'s push providers. `jazzSmsOtpProvider.js` and
  `whatsappOtpProvider.js` are real integrations ported from the
  monolith; `consoleLogOtpProvider.js` is the local-dev fallback,
  auto-selected when no real credentials are configured.
- `src/services/otpService.js` is the Redis-backed OTP state machine
  (5 min expiry, 3 attempts, 30 min block, 60s resend cooldown — same
  tuning as the original). Takes its Redis client as a constructor arg
  so it's unit-testable with a fake in-memory client, no real Redis
  needed for `pnpm test`.
- `src/services/passengerAuthService.js` is the one file that matters:
  send-otp / verify-otp-and-login-or-signal-new-user / register / logout
  / **verifyToken**. `verifyToken` is the actual point of this service —
  it checks the JWT signature *and* that it still matches
  `passenger.currentToken`/`deviceToken` in Mongo, because that DB match
  is what actually implements logout/block in the original's security
  model, not JWT expiry alone. A signature-only check would be a real
  regression, not just a simplification.
- `register()` publishes `auth.passenger.registered` via the same
  transactional-outbox pattern `promotions-service` uses
  (`buildOutboxDocument`/`startOutboxRelay`) — `notification-service`
  consumes it for a welcome push. This is the second event topic in the
  system; see `docs/event-catalog.md`.
- HS256 JWT (shared secret), not RS256/JWKS — see
  `docs/architecture-decision-records/0005-hs256-not-rs256-yet.md` for
  why, and the condition under which to revisit it.
- The QA/app-store-reviewer OTP bypass (`TEST_PHONE_NUMBERS`/fixed OTP,
  in `passengerAuthService.js`) is gated behind
  `config.enableTestOtpBypass` (`ENABLE_TEST_OTP_BYPASS`) — off by
  default, unlike the original where it was unconditionally active.
