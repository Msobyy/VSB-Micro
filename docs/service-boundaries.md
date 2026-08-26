# Service boundaries

Target reference architecture for the eventual full migration. Only
`api-gateway`, `promotions-service`, `notification-service`, and
`analytics-service` are actually built so far (the pilot slice — see
`architecture-decision-records/`); everything else below is the target map
this pilot is meant to prove out, not yet-built code.

Derived from `vsb-backend`'s and `vsb-crm-backend`'s existing `models/`,
`controllers/`, `services/`, and `routes/` directories.

| Service | Owns (from current monolith code) | Status |
|---|---|---|
| `api-gateway` | Routes REST calls to services, JWT verification at the edge | Built (pilot) |
| `promotions-service` | `bonusModel`, `bonusRuleService`, `boostService`, `couponModel` | Built (pilot, coupons only) |
| `notification-service` | FCM push (`fcmBatchHelper`), WhatsApp/SMS delivery | Built (pilot, push only) |
| `analytics-service` | CQRS read-model: driver performance, audit logs, telemetry, demand aggregation | Built (pilot, coupon redemptions only) |
| `auth-service` | 3 JWT domains (passenger/driver/CRM), OTP, RBAC/permissions | Not built |
| `driver-service` | `driverModel`, `vehicleModel`, shift lifecycle, document/selfie uploads (S3/Rekognition) | Not built |
| `passenger-service` | `passengerModel` and passenger profile concerns | Not built |
| `location-service` | Redis geo, `nearbyDriversV2/*`, h3-js bucketing, demand heatmap, surge forecast | Not built |
| `dispatch-service` | Matching engine: wave dispatch, ride offer fanout/accept races | Not built — highest risk |
| `ride-service` | Ride aggregate + lifecycle history, SOS | Not built |
| `realtime-gateway` | Owns Socket.IO connections (`/driver`, `/passenger`), no business logic | Not built |
| `payment-service` | JazzCash, EasyPaisa (+ status-inquiry jobs), wallet | Not built |
| `admin-bff` | Serves `vsb-crm-frontend`; aggregates across services | Not built |

**Deliberately folded into a neighbor rather than separate services:** SOS →
`ride-service`, media/document upload → `driver-service`.

## Inter-service communication

- **Kafka (async, default)** — domain facts (`ride.completed`,
  `payment.captured`, `bonus.awarded`, ...). Anything that only *reacts* to
  something should consume, not call synchronously.
- **REST (sync, when the caller needs an immediate answer)** — e.g. a future
  `realtime-gateway` → `dispatch-service` call for an offer-accept that
  needs a sub-second ack back to a socket.
- **gRPC — not adopted.** Business logic lives in plain service-layer
  functions (not embedded in Express handlers), so a gRPC transport could be
  added later on a specific hot path without a rewrite, if REST proves to be
  a bottleneck. Nothing today needs that.

## Realtime/Socket.IO (future — not built)

A future `realtime-gateway` should stay intentionally "dumb": authenticate
sockets, translate socket events into REST/Kafka calls, and separately
consume a `realtime.push.*` topic to push events back down to connected
clients. This keeps `dispatch-service` stateless and horizontally scalable
independent of WebSocket connection count.

## Migration approach (strangler fig)

Extract low-risk, high-value domains first; leave `dispatch-service` /
`ride-service` / `realtime-gateway` for last, since they're the highest-risk
and most latency-sensitive (the "core domain logic" per
`vsb-backend/CLAUDE.md`). `vsb-backend` and `vsb-crm-backend` are untouched
by this pilot — they keep running exactly as they do today until a specific
domain is deliberately cut over.
