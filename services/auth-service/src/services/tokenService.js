// Signs and verifies the passenger JWT. Same shape as
// vsb-backend/controllers/passenger/authController.js (`{id, role}`,
// 30-day expiry) so a future real cutover isn't also a mobile-client-
// breaking token-format change.
//
// HS256 shared secret, not RS256/JWKS — nothing in this repo needs to
// verify a passenger token except this service and api-gateway's
// verify-relay. See docs/architecture-decision-records/0005 for the
// revisit condition.
import jwt from "jsonwebtoken";

const TOKEN_EXPIRY = "30d";

export function signToken({ id, role }, secret) {
  return jwt.sign({ id, role }, secret, { expiresIn: TOKEN_EXPIRY });
}

/** Returns the decoded payload, or null if the token is malformed/expired/
 * signed with a different secret. Never throws — callers treat null as
 * "not authenticated" rather than handling a JWT-library exception type. */
export function decodeToken(token, secret) {
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}
