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
const REGISTRATION_TICKET_EXPIRY = "10m";
const REGISTRATION_TICKET_PURPOSE = "registration";

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

// Proof that verify-otp actually succeeded for this exact phone, short-
// lived (10 minutes — enough to fill in a signup form, not enough to be
// useful for anything else) and tagged with a distinct `purpose` claim
// so it can never be confused with (or reused as) a real session token.
// register() requires and validates one of these before creating an
// account — see passengerAuthService.js's register() for why: without
// this, register() had no way to know an OTP was ever checked at all.
export function signRegistrationTicket({ phone }, secret) {
  return jwt.sign({ phone, purpose: REGISTRATION_TICKET_PURPOSE }, secret, { expiresIn: REGISTRATION_TICKET_EXPIRY });
}

/** Returns the decoded ticket only if it's valid, unexpired, actually a
 * registration ticket (not a session token or anything else), and bound
 * to the exact phone being registered. Null otherwise — never throws. */
export function verifyRegistrationTicket(ticket, phone, secret) {
  const decoded = decodeToken(ticket, secret);
  if (!decoded) return null;
  if (decoded.purpose !== REGISTRATION_TICKET_PURPOSE) return null;
  if (decoded.phone !== phone) return null;
  return decoded;
}
