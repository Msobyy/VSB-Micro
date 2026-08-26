// JWT verification, edge-of-system: this is where a real deployment would
// enforce auth once, rather than every downstream service re-verifying —
// matches vsb-backend's own passenger/driver/CRM authMiddleware.js pairs in
// spirit (verify + attach req.user), just consolidated to one place instead
// of three separate JWT domains.
//
// STUBBED for this pilot: there's no auth-service yet minting real tokens,
// so this decodes-if-present and attaches req.user, but does not reject
// requests with no/invalid token — routes stay open so the pilot's curl
// walkthrough (docs/event-catalog.md) works without a token. Flip
// `attachUser` to a hard-reject once auth-service exists and real clients
// send tokens.
import jwt from "jsonwebtoken";

export function verifyToken(token, secret) {
  return jwt.verify(token, secret);
}

export function attachUser(config, logger) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return next();

    try {
      req.user = verifyToken(header.slice("Bearer ".length), config.jwtSecret);
    } catch (err) {
      logger.warn({ err: err.message }, "rejected invalid bearer token, continuing unauthenticated");
    }
    next();
  };
}
