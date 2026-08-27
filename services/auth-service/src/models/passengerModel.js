// Pilot-scoped port of the auth-relevant subset of
// vsb-backend/models/passengerModel.js. `currentToken` + `deviceToken`
// together are the actual session-revocation mechanism — a JWT that
// doesn't match what's stored here is treated as logged out even if it
// hasn't expired yet (see tokenService.js / passengerAuthService.js).
// Deliberately drops app-version/device-telemetry fields — that's a
// different concern the original glued onto its auth middleware, not
// core to identity/auth.
import mongoose from "mongoose";

const passengerSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    gender: { type: String, enum: ["Male", "Female", "Other"], required: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, unique: true, sparse: true },
    city: { type: String, default: "Lahore" },
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
