# 0009: auth-service security hardening

## Status
Accepted (2026-08-27)

## Context
Before extending `auth-service` (starting `passenger-service` next) or
letting more services depend on it, an independent security/correctness
audit was run against the whole service — not a rubber-stamp review, a
genuine hunt with working proof-of-concept exploits against the running
code. It found two **critical** bugs, both confirmed live (not just
theorized) before being fixed:

1. **`POST /register` never verified an OTP was ever checked.** The
   intended flow (send-otp → verify-otp → register) was a client-side UX
   convention only — nothing server-side enforced it. A raw
   `POST /register` for any never-registered phone number returned 201
   with a fully valid 30-day session token, `is_verified: true`, and
   fired `auth.passenger.registered` with attacker-chosen profile data
   tied to a real phone number. Confirmed with a live exploit: an
   `otpService` wired to throw if ever called still let registration
   succeed.
2. **NoSQL operator injection via `deviceToken` in `POST /verify`.** A
   JSON body can carry `deviceToken: {"$ne": null}` where a string was
   expected; neither Express nor Mongoose reject that on their own, and
   it flowed straight into `verifyToken()`'s Mongo filter, matching any
   document and bypassing device-session binding — the mechanism this
   service's own header comments describe as what actually implements
   logout/block, not JWT expiry. Confirmed live over a real HTTP request:
   `{"token": "<any leaked bearer JWT>", "deviceToken": {"$ne": null}}`
   returned `valid: true` regardless of the token's real bound device.

Several further real (if lower-severity) gaps were also found: no rate
limiting anywhere (per-phone cooldown in `otpService.js` doesn't stop one
IP hitting `/send-otp` for many distinct numbers, each a real billed
SMS/WhatsApp send), a JWT secret that silently falls back to a hardcoded
default with no startup check, a genuine TOCTOU race in the OTP
attempt-counting sequence, missing phone-number format validation, a
gender-enum mismatch surfacing as a 500 that leaked Zod's internal
schema details, and the shared `errorHandler` exposing `message`/
`details` for any `ApiError` including deliberate 500-class ones.

## Decision
Fix all of it before moving on to `passenger-service`, not defer any of
it as "known gaps" the way some earlier, deliberate scope decisions in
this repo are (e.g. email uniqueness, RS256/JWKS). These are correctness
bugs in already-shipped code, not scope boundaries.

- **Registration ticket**: `verifyOtpAndLogin()` issues a short-lived
  (10 min), phone-bound, purpose-tagged JWT
  (`tokenService.js`'s `signRegistrationTicket`/`verifyRegistrationTicket`)
  only after a real OTP check succeeds. `register()` requires and
  validates one, matching it against the phone being registered, before
  ever touching the database. This preserves the original two-request
  UX (send-otp → verify-otp → a signup form → register) rather than
  collapsing them into one call — the client just has to carry the
  ticket between the two.
- **Strict input validation at the controller boundary**: every field
  that reaches a Mongo query filter or gets persisted is validated as a
  plain string of a bounded, sane shape
  (`passengerAuthController.js`'s `requireString`/`requirePhoneFields`/
  `requireDeviceToken`) before the service layer ever sees it. This is
  the actual fix for the injection — not a Mongoose-level sanitizer
  library, since the type-check has to happen before the value is even
  assigned to anything Mongoose will touch.
- **Per-IP rate limiting** (`src/middlewares/rateLimit.js`,
  `express-rate-limit`): a stricter limit on `/send-otp` specifically
  (it's the one with a real per-call provider cost) and a looser general
  floor on the rest. Configurable per-call so integration tests can
  override the production thresholds instead of tripping them
  incidentally, with rate-limit *behavior itself* getting its own
  dedicated test using a deliberately tiny limit.
- **JWT secret startup check** (`src/config/index.js`): refuses to start
  in production if `JWT_SECRET` is missing, still the hardcoded default,
  or under 32 characters.
- **Atomic OTP state transitions** (`otpService.js`): the block-check,
  compare, and attempt-increment sequence (and `sendOtp`'s cooldown
  claim) now goes through a short-lived per-phone Redis lock
  (`SET ... NX EX`, self-expiring so a crash can't deadlock a phone
  number) instead of separate, racy round-trips. Verified with a
  concurrency test against a fake Redis client with injected latency —
  the previous fake resolved every call on the same microtask with no
  real interleaving, which is *why* the race existed in shipped code
  without a failing test catching it; the fake now supports simulated
  network latency specifically so this class of bug gets real coverage
  going forward.
- **Constant-time OTP comparison** (`node:crypto`'s `timingSafeEqual`).
- **`errorHandler` (`libs/http-errors`) now masks `message`/`details` for
  any 500-class response**, including a deliberate `ApiError.internal(...)`
  — a 500 means "the caller shouldn't see internals," full stop; that
  didn't previously distinguish between a genuinely unexpected exception
  and a deliberately-thrown one. This is a shared-library fix, so it
  applies to every service, not just auth-service.
- **Second independent guard on the QA/app-store-reviewer OTP bypass**:
  now requires `config.nodeEnv !== "production"` in addition to the
  existing `enableTestOtpBypass` flag, so one misconfigured env var can't
  open a zero-rate-limit login backdoor for two fixed phone numbers in a
  real deployment.

## Consequences
- `register()`'s request/response contract changed: it now requires a
  `registrationTicket` field, sourced from `verify-otp`'s response when
  `isNewUser` is true. Nothing outside this pilot depends on the old
  contract yet, so this is a clean break, not a migration.
- `deviceToken` now has a minimum length (8 characters) enforced
  everywhere it's accepted — a real client's push token will always
  clear this easily; only a trivially short placeholder value would be
  rejected.
- This audit-then-harden pass is worth repeating as a matter of course
  before any future service (`passenger-service`, `driver-service`, ...)
  takes on real dependents, not just as a one-off for auth-service.
