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
  `config.enableTestOtpBypass` **and** `config.nodeEnv !== "production"` —
  off by default, unlike the original where it was unconditionally
  active, and now with a second independent guard so one accidentally-set
  env var can't open it in a real deployment.

## Hardening (see docs/architecture-decision-records/0009)

A security audit run before this service gained any dependents found two
critical, PoC-verified bypasses — both fixed, both with regression tests:

- **`register()` required no proof an OTP was ever verified.** Fixed:
  `verifyOtpAndLogin()` now issues a short-lived (10 min), phone-bound
  `registrationTicket` (see `tokenService.js`'s `signRegistrationTicket`/
  `verifyRegistrationTicket`) only after a real OTP check succeeds;
  `register()` requires and validates one before creating an account.
  Tagged with a distinct `purpose` claim so it can never be reused as (or
  confused with) a real session token.
- **NoSQL operator injection via `deviceToken`.** A JSON body can send
  `deviceToken: {"$ne": null}` where a string is expected, and neither
  Express nor Mongoose reject that on their own — it would flow straight
  into `verifyToken()`'s Mongo filter and match any document, bypassing
  device-session binding entirely for anyone holding a leaked bearer
  token. Fixed: every controller validates `deviceToken`/`token`/phone
  fields/`gender` as plain strings of a sane shape
  (`passengerAuthController.js`'s `requireString`/`requirePhoneFields`/
  `requireDeviceToken`) before anything reaches a query or the DB.

Also added: per-IP rate limiting (`src/middlewares/rateLimit.js` — the
per-phone cooldown in `otpService.js` alone doesn't stop one IP hitting
`/send-otp` for many distinct numbers, each a real billed SMS/WhatsApp
send), a startup check that refuses to run in production with a missing/
default/short `JWT_SECRET` (`src/config/index.js`), a fix for a genuine
TOCTOU race in `otpService.js`'s block-check/compare/increment sequence
(now serialized per-phone via a short-lived Redis lock — see that file's
header comment), a constant-time OTP comparison, and the shared
`errorHandler` (`libs/http-errors`) no longer leaking `message`/`details`
for any 500-class response, including a deliberate `ApiError.internal(...)`.
