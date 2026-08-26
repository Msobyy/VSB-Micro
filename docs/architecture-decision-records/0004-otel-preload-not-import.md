# 0004: OTel via NODE_OPTIONS preload, plus manual spans for the Kafka boundary

## Status
Accepted (2026-08-26)

## Context
The first tracing implementation had every service `import "./tracing.js"`
as the literal first line of `server.js` (mirroring `vsb-backend`'s
`instrument.mjs`-first pattern for Sentry). This correctly instrumented
HTTP, Express, and MongoDB — real spans showed up in Jaeger for a
request's full path through `api-gateway` and a service's Mongo
transaction. It did **not** instrument kafkajs: no producer or consumer
spans ever appeared, with no error either.

Root cause, confirmed by checking `OTEL_LOG_LEVEL=debug` output package by
package: auto-instrumentation depends on `require-in-the-middle`, which
hooks CommonJS's `Module._load`. An ESM file's `import` of a CJS package
goes through Node's ESM loader, not `Module._load` — that hook never
fires. But when a CJS package (`mongoose`) internally `require()`s another
CJS package (`mongodb`), *that* nested call is pure CJS-to-CJS and the hook
fires normally. `libs/event-bus/src/kafka.js` is `"type": "module"` and
does `import { Kafka } from "kafkajs"` directly — the one place in this
codebase where a target package is ESM-imported rather than reached via
another CJS package's internal `require()` chain. That's the entire
difference between "mongodb got instrumented" and "kafkajs didn't".

Node ships an experimental ESM loader hook
(`@opentelemetry/instrumentation/hook.mjs`, via `--experimental-loader`)
specifically for this case. Tried it — Node 26 exits silently (code 1, no
stack trace) with that flag combined with the CJS `--require` preload,
so it isn't a viable option against the Node version this project targets.

## Decision
Two changes:

1. Replaced the per-service `src/tracing.js` + `import` pattern with the
   standard Node preload: `NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"`,
   set in `infra/docker-compose.dev.yaml` per service, alongside
   `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT` (base URL — the
   exporter appends `/v1/traces` itself). This is the officially
   documented pattern and is what actually fixed HTTP/Express/Mongo
   reliably. Each Dockerfile's runner stage now sets
   `WORKDIR /repo/services/<name>` before `CMD` — the bare specifier
   `@opentelemetry/auto-instrumentations-node/register` resolves relative
   to CWD, and the package only exists in that service's own
   `node_modules`, not hoisted to the workspace root.
2. Added manual spans around the one boundary auto-instrumentation
   structurally can't cover here: `libs/event-bus/src/tracePropagation.js`
   wraps the outbox relay's `producer.send()` in a PRODUCER span and each
   consumer's message handler in a CONSUMER span, using
   `@opentelemetry/api` directly (not auto-instrumentation at all).

   This also solves a second, unrelated problem: the outbox relay
   publishes *asynchronously* (a Mongo change-stream reaction or a
   periodic sweep), never inline with the original HTTP request, so
   there's no "active span" for a producer-side auto-instrumentation to
   attach to even if it worked. The fix is to capture the trace context
   at outbox-write time — still inside the original request — and store
   it as a `traceContext` field on the outbox row itself
   (`outbox.js`'s `buildOutboxDocument`). The relay resumes that captured
   context whenever it actually publishes, and injects the resulting
   span's context into the Kafka message headers so the consumer can
   extract it and continue the same trace.

## Consequences
- A coupon redemption now traces as one connected story end to end:
  `api-gateway` → `promotions-service` (HTTP + Mongo transaction, via
  auto-instrumentation) → `promotions.coupon.redeemed publish` (manual
  PRODUCER span, parented under the original request even though it
  fires later) → `promotions.coupon.redeemed process` (manual CONSUMER
  span in `notification-service` and `analytics-service`).
- Any future service that publishes or consumes Kafka events through
  `@vsb/event-bus` gets this for free — `buildOutboxDocument`,
  `startOutboxRelay`, and `runConsumer` all already call into
  `tracePropagation.js` internally. Nobody writing a new producer/consumer
  needs to know any of the above; they just use the existing helpers.
- If a future service imports a CJS package directly from an ESM file
  outside of `@vsb/event-bus` and expects auto-instrumentation to cover
  it, it likely won't, for the same underlying reason. Check
  `OTEL_LOG_LEVEL=debug` output for an "Applying instrumentation patch"
  line naming that package before assuming it's covered.
