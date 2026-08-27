# 0006: Redis Cloud, per-service ownership — not self-managed, not shared

## Status
Accepted (2026-08-27)

## Context
Two separate questions came up while building `auth-service` (the first
Redis consumer in this monorepo):

**Where does Redis run?** Production already uses managed Redis Cloud for
both `vsb-backend` and `vsb-crm-backend` (per the infra notes: host,
port, username, password kept separate — never a combined connection
string). Since the microservices are meant to run the same way production
eventually will, they should talk to Redis Cloud too, not a self-hosted
container — even in dev/test, using a dedicated (non-production) Redis
Cloud instance.

**Who can read whose keys?** `vsb-crm-backend/config/sharedRedis.js`
connects directly to "vsb-backend's Redis" to read `passenger:online:*`
presence keys. That works in the monolith because it's one coordinated
codebase where every key name is visible by grepping the other repo. It
doesn't hold up for independent microservices: one service reaching
directly into another service's Redis is the same coupling problem
`database-per-service` (already applied to Mongo — every service here has
its own DB) exists to prevent, just for a different datastore. It also
means one service's Redis usage pattern (key volume, memory footprint,
eviction behavior) can degrade another service's unrelated Redis-dependent
flow.

## Decision
1. **Redis Cloud, not a self-hosted container.** There's no local `redis`
   service in `infra/docker-compose.dev.yaml` — services connect to a
   managed instance via `REDIS_HOST`/`PORT`/`USERNAME`/`PASSWORD`, read
   from a root `.env` (gitignored) that docker-compose interpolates
   directly. Use a separate, non-production Redis Cloud instance for
   dev/test — same shape as prod, not the same data.
2. **Every service owns its Redis data — no cross-service reads.** If
   service A needs something service B holds, it calls B's API or
   consumes an event B published, same as any other cross-service data
   need in this system. `auth-service` enforces this two ways on the one
   shared Redis Cloud instance: its own `db` index (`config.redisDb`,
   `auth-service` = 0 — the next service to need Redis claims 1, and so
   on) and its own `keyPrefix` (`"auth:"`) on the ioredis client, so even
   a key collision within the same db is caught.

## Consequences
- A future service that needs to react to another service's Redis-backed
  state (e.g. a location-service tracking driver presence, mirroring what
  `sharedRedis.js` does today) does so via a Kafka event or an API call
  to the owning service — never a direct Redis connection to someone
  else's db/prefix. `sharedRedis.js`'s pattern is explicitly **not**
  something to replicate here.
- Everyone running this locally needs real (test) Redis Cloud credentials
  in their own root `.env` — there's no zero-config local fallback beyond
  an unauthenticated `localhost` Redis for anyone who happens to have one
  running. Acceptable since the same is already true of Mongo Atlas/Redis
  Cloud in the existing production setup.
- Whether every service eventually gets its own separate Redis Cloud
  subscription, or all share one with Redis ACL users scoped to each
  service's own prefix, is a cost/ops decision that doesn't change the
  ownership rule above either way — revisit as its own decision once
  there's a real per-service deployment target, same reasoning as ADR
  0003's deferred orchestrator choice.
