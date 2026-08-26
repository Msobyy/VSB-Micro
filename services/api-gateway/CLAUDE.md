# CLAUDE.md

Guidance for working in this service specifically. See the repo root
`docs/service-boundaries.md` for the cross-service picture.

## What this is

`api-gateway` is the single entry point for the pilot slice — routes REST
calls to `promotions-service` and `analytics-service`, and is where JWT
verification happens at the edge (`src/middlewares/authMiddleware.js`).

## Commands

```bash
pnpm --filter @vsb/api-gateway dev
pnpm --filter @vsb/api-gateway test
```

## Architecture

- Adding a new routed service = one more `createProxyMiddleware({ pathFilter, target })` call in `src/app.js`, plus that URL added to `src/config/index.js`. Read that file's header comment before changing the proxy setup — the root-mount + `pathFilter` + bare-host-target combination is deliberate, not arbitrary; see the comment for the http-proxy-middleware v3+ issue it avoids.
- Auth is currently a stub (see `authMiddleware.js`'s header comment) — it decodes-if-present, doesn't reject. There's no auth-service yet in this pilot to mint real tokens against.
