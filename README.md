# vsb-microservices

Event-driven microservices rebuild of the VSisters/VSB platform, staged
alongside the existing `vsb-backend` / `vsb-crm-backend` / `vsb-crm-frontend`
monoliths (which this repo does not touch). See `docs/service-boundaries.md`
for the target architecture and `docs/architecture-decision-records/` for
why it's built this way.

## Status

Five services built so far: `api-gateway`, `promotions-service`,
`notification-service`, `analytics-service`, `auth-service` (passenger
auth only). See `docs/service-boundaries.md` for the full target map and
what's built vs. planned.

## Quick start

```bash
pnpm install
cp .env.example .env   # then set MONGO_URI (Atlas) and REDIS_HOST/PORT/
                        # USERNAME/PASSWORD (Redis Cloud) — real (test)
                        # cloud credentials, see .env.example and ADRs
                        # 0006 / 0007
docker compose --env-file .env -f infra/docker-compose.dev.yaml up --build
```

`--env-file .env` is required, not optional — Docker Compose's automatic
`.env` lookup only checks next to the compose file (`infra/`), not the
repo root where this one lives, so without the flag `MONGO_URI`/`REDIS_*`
silently resolve to empty strings and every service fails to connect.

- API gateway: http://localhost:3000
- Redpanda Console (topic inspector): http://localhost:8080
- Jaeger UI (distributed traces): http://localhost:16686

There's no create-coupon endpoint (redemption only — see
`services/promotions-service/CLAUDE.md`), so seed one first:

```bash
docker exec -w /repo/services/promotions-service vsb-promotions-service \
  node scripts/seedCoupon.js TEST10 flat 150
```

Then follow the manual walkthrough in `docs/event-catalog.md` to see an
event flow through the whole system.

## Development

```bash
pnpm turbo run test                              # unit tests, every package
pnpm -r --if-present run test:integration        # integration tests (spin up in-memory Mongo replica sets)
pnpm --filter @vsb/promotions-service dev         # run one service standalone
```

Each `services/*` and `libs/*` package has its own `CLAUDE.md` with
service-specific notes.
