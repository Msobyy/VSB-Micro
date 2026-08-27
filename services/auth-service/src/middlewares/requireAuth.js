// Gates auth-service's own routes that need an authenticated caller
// (currently just /logout) — reuses the same verifyToken the /verify
// endpoint exposes to other services, so there's one source of truth for
// "is this token still good" rather than a second copy of the check.
import { ApiError } from "@vsb/http-errors";

export function requireAuth(service) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
    const deviceToken = req.headers["device-token"];

    // A repeated header arrives as an array, not a string — reject that
    // explicitly rather than letting a non-string value reach the Mongo
    // query filter inside verifyToken(). Headers can't carry a JSON
    // object the way a request body can, so this isn't the same
    // NoSQL-injection class as the /verify endpoint's body field, but
    // it's the same principle: only a plain string belongs in that filter.
    if (!token || typeof deviceToken !== "string" || deviceToken.length === 0) {
      throw ApiError.badRequest("Missing Authorization or device-token header", { code: "MISSING_AUTH" });
    }

    const result = await service.verifyToken({ token, deviceToken });
    if (!result.valid) {
      throw ApiError.unauthorized("Session expired or invalid", { code: "SESSION_INVALID" });
    }

    req.user = result.passenger;
    next();
  };
}
