// Identity/session record ONLY — not the full passenger. auth-service owns
// "can this phone log in, is it blocked, what's its current session";
// profile data (name, gender, city, ...) belongs to a future
// passenger-service, a different bounded context. This model used to also
// carry firstName/lastName/gender/city — that was profile data leaking
// into the identity store, the same conflation the monolith's single
// Passenger collection has, just relocated. See
// passengerAuthService.js's register() for where those fields go instead
// (into the auth.passenger.registered event payload, not persisted here).
//
// `currentToken` + `deviceToken` together are the actual session-
// revocation mechanism — a JWT that doesn't match what's stored here is
// treated as logged out even if it hasn't expired yet (see
// tokenService.js / passengerAuthService.js). Deliberately drops app-
// version/device-telemetry fields too — a different concern the original
// glued onto its auth middleware, not core to identity/auth.
import mongoose from "mongoose";

const passengerSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    role: { type: String, default: "passenger" },
    is_verified: { type: Boolean, default: false },
    is_deleted: { type: Boolean, default: false },
    blockStatus: {
      isBlocked: { type: Boolean, default: false },
      reason: { type: String, default: null },
    },
    deviceToken: { type: String, index: true },
    currentToken: { type: String, index: true },
    lastLogin: { type: Date },
  },
  { timestamps: true },
);

export function getPassengerModel(connection) {
  return connection.models.Passenger ?? connection.model("Passenger", passengerSchema);
}
