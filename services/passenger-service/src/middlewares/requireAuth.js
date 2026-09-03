// Calls out to auth-service's POST /api/v1/auth/verify — the first real
// synchronous inter-service REST call in this repo (everything else so
// far is either Kafka events or api-gateway proxying a client's own
// request through). Plain fetch, no client library, same choice
// api-gateway's attachUser already made.
//
// Unlike api-gateway's attachUser (which is deliberately soft/non-
// blocking — see that file's header comment), this HARD-REJECTS: every
// route behind it serves or mutates one specific person's PII, so a
// missing/invalid token (401) or an unreachable auth-service (503) both
// stop the request rather than letting it through unauthenticated. Sets
// req.passengerId, not a full user object — this service only ever
// needs to know *whose* profile it's looking at, resolved from the
// verified token, never from a client-supplied id (no /:id route exists
// at all — see passengerProfileRoutes.js).
import { ApiError } from "@vsb/http-errors";

export function requireAuth(config, logger) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    const deviceToken = req.headers["device-token"];

    if (!token || typeof deviceToken !== "string" || deviceToken.length === 0) {
      throw ApiError.unauthorized("Missing Authorization or device-token header", { code: "MISSING_AUTH" });
    }

    let result;
    try {
      const response = await fetch(`${config.authServiceUrl}/api/v1/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, deviceToken }),
      });
      result = await response.json();
    } catch (err) {
      logger.error({ err: err.message }, "auth-service verify call failed");
      throw ApiError.serviceUnavailable("Could not verify session right now", { code: "AUTH_SERVICE_UNAVAILABLE" });
    }

    if (!result?.valid) {
      throw ApiError.unauthorized("Session expired or invalid", { code: "SESSION_INVALID" });
    }

    req.passengerId = result.passenger.id;
    next();
  };
}
