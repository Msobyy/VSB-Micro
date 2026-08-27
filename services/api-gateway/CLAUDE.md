# CLAUDE.md

Guidance for working in this service specifically. See the repo root
`docs/service-boundaries.md` for the cross-service picture.

## What this is

`api-gateway` is the single entry point for the system so far — routes
REST calls to `promotions-service`, `analytics-service`, and
`auth-service`, and is where auth verification happens at the edge
(`src/middlewares/authMiddleware.js`).

## Commands

```bash
pnpm --filter @vsb/api-gateway dev
pnpm --filter @vsb/api-gateway test
```

## Architecture

- Adding a new routed service = one more `createProxyMiddleware({ pathFilter, target })` call in `src/app.js`, plus that URL added to `src/config/index.js`. Read that file's header comment before changing the proxy setup — the root-mount + `pathFilter` + bare-host-target combination is deliberate, not arbitrary; see the comment for the http-proxy-middleware v3+ issue it avoids.
- `attachUser` calls `auth-service`'s `POST /api/v1/auth/verify` (via plain `fetch`, no client library) rather than decoding the JWT locally — a local signature check alone would miss revocation, since that's implemented as a DB session-token match in auth-service, not JWT expiry. Still **non-blocking**: a missing/invalid token passes through rather than being rejected, since the promotions/analytics routes behind this middleware don't require auth yet. Enforcing a real auth policy is a later increment once driver/CRM domains exist too — see that file's header comment.
