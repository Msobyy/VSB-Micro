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

    if (!token || !deviceToken) {
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
