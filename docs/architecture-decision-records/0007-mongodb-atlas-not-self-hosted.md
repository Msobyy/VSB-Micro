# 0007: MongoDB Atlas, not a self-hosted local replica set

## Status
Accepted (2026-08-27)

## Context
Local dev originally ran Mongo as a single-node replica set in a Docker
container (`mongo` + a one-shot `mongo-init` to run `rs.initiate()`),
specifically because `@vsb/event-bus`'s outbox pattern needs transactions
and change streams, which a plain standalone `mongod` doesn't support.
That setup came with real friction: a documented `/etc/hosts` workaround
for running a service outside Docker against the dockerized Mongo (the
replica set's member is registered as `mongo:27017`, not resolvable from
the host without it), and two extra containers to maintain.

Production already runs MongoDB Atlas (per the existing infra notes) —
Atlas is always a replica set, so it satisfies the transactions/change-
streams requirement without any of the local replica-set bootstrapping.
This is the same reasoning already applied to Redis in ADR 0006: use the
same managed cloud datastore dev/test uses as production does, rather
than a self-hosted stand-in that only approximately matches it.

## Decision
`infra/docker-compose.dev.yaml` has no local Mongo container. Every
service connects to a MongoDB Atlas cluster via `MONGO_URI` (a full
`mongodb+srv://` connection string, credentials included) in the root
`.env` (gitignored) — use a dedicated test/dev cluster, not the
production one. Each service still owns its own logical database within
that cluster via its `mongoDbName` config (unchanged from before —
`vsb_promotions`, `vsb_auth`, etc.), so `database-per-service` still
holds; only the physical hosting changed.

## Consequences
- The `/etc/hosts` workaround and the `mongo-init` replica-set bootstrap
  no longer exist — one less thing to explain to a new contributor, and
  one less thing that can be out of sync between dev and prod.
- Everyone running this locally needs a real (test) `MONGO_URI` in their
  own root `.env` — same trade-off already accepted for Redis in ADR
  0006, and already true of the existing production setup.
- `libs/test-utils`'s `MongoMemoryReplSet` (used by every service's
  `pnpm test:integration`) is unaffected — that's a separate, ephemeral,
  fully in-memory replica set for automated tests, not related to this
  dev-environment datastore choice.
