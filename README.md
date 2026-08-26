# vsb-microservices

Event-driven microservices rebuild of the VSisters/VSB platform, staged
alongside the existing `vsb-backend` / `vsb-crm-backend` / `vsb-crm-frontend`
monoliths (which this repo does not touch). See `docs/service-boundaries.md`
for the target architecture and `docs/architecture-decision-records/` for
why it's built this way.

## Status

Pilot slice only — proves the event-driven pattern end-to-end with the
lowest-risk real domain (coupon redemption) before extracting anything
higher-stakes. See `docs/service-boundaries.md` for what's built vs. planned.

## Quick start

```bash
pnpm install
docker compose -f infra/docker-compose.dev.yaml up --build
```

- API gateway: http://localhost:3000
- Redpanda Console (topic inspector): http://localhost:8080

There's no create-coupon endpoint in this pilot (redemption only — see
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
