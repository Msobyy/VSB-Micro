# 0008: Mono-to-micro cutover — maintenance-window migration

## Status
Accepted (2026-08-27) — **methodology only, not yet executed.** This is
the plan to follow once a service extraction is actually ready for a real
production cutover (the first candidate is `auth-service` +
`passenger-service`, once the latter exists). Nothing in this ADR has
happened yet; `vsb-backend` is untouched.

## Context
`vsb-backend` is live, but current user volume is low enough to tolerate
a scheduled maintenance window (a few hours overnight) rather than
requiring zero-downtime migration. That's a real constraint worth
designing around deliberately — it eliminates the hardest part of this
class of migration (keeping two systems consistent while both are
accepting writes, via Change Streams/CDC or dual-writes) in exchange for
a bounded period of planned unavailability. This decision should be
revisited if/when user volume grows enough that a multi-hour night
window stops being acceptable — at that point, the live-sync approach
described as the alternative below becomes the right one instead.

The specific fear driving this: microservices split what was one Mongo
document (`vsb-backend`'s `Passenger`) across multiple databases (auth-
service's identity record, passenger-service's profile record, and
whatever else follows). A sloppy split risks silent data loss, broken
`passengerId` references in still-unmigrated collections (rides, wallet
transactions, bonuses, ...), or duplicated/inconsistent records. The
methodology below exists specifically to make that not happen.

## Decision

### Before migration night (rehearsal — done days/weeks ahead, mono still live)
1. **Write the field-mapping spec first, as a literal document**, one row
   per source field → destination service.field, for every collection
   being split (not just `Passenger` — this repeats for `Driver` when
   `driver-service` is extracted, etc.). No ambiguity about where a field
   goes should exist by migration night.
2. **Migration scripts must be idempotent** — upsert by `_id`, never a
   blind insert. Running a script twice (a rehearsal run, then the real
   run, or a retry after a partial failure) must be safe and produce the
   same end state, not duplicates.
3. **Rehearse against a real copy of production data**, not synthetic
   fixtures — restore a MongoDB Atlas snapshot to a separate staging
   cluster and run the actual migration scripts against it. Never run an
   unrehearsed script against production data for the first time on the
   real migration night.
4. **Write the reconciliation suite alongside the migration scripts, not
   after** — for every source record, assert both derived target records
   exist, every mapped field matches, and record counts agree across
   source and all destinations. This is what actually proves the
   migration worked, not "the script exited 0."
5. `passengerId` (the Mongo `_id`) **must be preserved exactly** across
   every derived record in every destination service. This is the single
   detail that, if wrong, breaks referential integrity everywhere else in
   the system that hasn't migrated yet.

### Migration night
1. Put `vsb-backend` into maintenance mode — block writes (a maintenance
   response on the API, not just a frontend banner) and stop the
   application servers, but keep the database reachable for the
   migration scripts.
2. Take one more explicit backup/snapshot of the source database,
   on top of whatever regular backup schedule already exists — belt and
   suspenders for the one irreversible night.
3. Run the (already-rehearsed, idempotent) migration scripts against the
   real source data.
4. Run the reconciliation suite. **Do not proceed past a failed
   reconciliation** — abort and stay on the monolith rather than cut over
   on an unverified migration.
5. Only after reconciliation passes clean: point traffic at the new
   services (api-gateway config / mobile app API base — whatever the
   real routing mechanism is by then) and smoke-test the critical flows
   for real (login, a full signup, one real transaction end to end)
   before declaring the window closed.
6. If anything looks wrong at any point: abort, point traffic back at
   the untouched monolith, investigate offline, retry on a later night.
   The source database is never mutated or deleted during this process,
   so "revert" is always available and cheap.

### Sessions do not migrate
Tokens issued by `vsb-backend` are signed with its own secret and can't
be made valid against `auth-service`'s `/verify`. Nobody's session
survives the cutover — every user re-authenticates via send-otp/verify-
otp once, the same flow they already know from normal session expiry.
This is expected, not a bug to work around.

### After migration night
- Keep `vsb-backend`'s old passenger-auth code path and database intact
  (not deleted) for a burn-in window — rollback stays cheap for as long
  as it's kept around, mirroring `vsb-backend`'s own
  `ROLLBACK-PLAN-2026-05-02.md` pattern.
- Monitor closely for the following days.
- Only remove the old code path / archive the old data once the new
  services have been stable through that burn-in period.

## Consequences
- This is the general playbook for every future extraction that needs a
  real cutover (driver-service, and later CRM), not a one-off for
  passenger/auth — the pre-migration rehearsal + maintenance-window
  fan-out + reconciliation + gradual smoke-test + rollback-safety shape
  repeats each time, with a new field-mapping spec per entity.
- Trades a bounded window of real downtime for a much simpler, lower-risk
  migration than a live dual-write approach would require. Revisit this
  trade specifically (not the rest of the methodology) if user volume
  grows enough that any full-stop window becomes unacceptable.
