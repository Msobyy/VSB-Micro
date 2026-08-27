// JWT verification, edge-of-system: this is where a real deployment
// enforces auth once, rather than every downstream service re-verifying —
// matches vsb-backend's own passenger/driver/CRM authMiddleware.js pairs
// in spirit (verify + attach req.user), just consolidated to one place.
//
// Delegates to auth-service's POST /api/v1/auth/verify rather than
// decoding the JWT locally — a local signature-only check would miss
// revocation (logout/block), since that's actually implemented as a DB
// session-token match, not JWT expiry. See auth-service's
// passengerAuthService.js for why that distinction matters.
//
// Still non-blocking: a missing/invalid token passes through rather than
// being rejected. The promotions/analytics routes behind this middleware
// don't require auth today; deciding a real enforcement policy is a
// later increment once driver/CRM domains exist too. This is a mechanism
// swap (fake local decode -> real remote verify), not a policy change.
export function attachUser(config, logger) {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return next();

    const token = header.slice("Bearer ".length);
    const deviceToken = req.headers["device-token"];

    try {
      const response = await fetch(`${config.authServiceUrl}/api/v1/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, deviceToken }),
      });
      const result = await response.json();
      if (result.valid) {
        req.user = result.passenger;
      } else {
        logger.warn("auth-service rejected the bearer token, continuing unauthenticated");
      }
    } catch (err) {
      logger.warn({ err: err.message }, "auth-service verify call failed, continuing unauthenticated");
    }

    next();
  };
}
