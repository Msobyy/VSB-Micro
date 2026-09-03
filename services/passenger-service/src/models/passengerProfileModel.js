// Profile — not identity. The `_id` is the same ObjectId auth-service
// minted for this passenger at registration (never regenerated here —
// see passengerRegisteredConsumer.js), the correlation key across both
// services' databases. No phone, no session fields, no blockStatus —
// those are auth-service's job; this is the bounded context split
// auth-service's own model comment describes, completed on this side.
//
// Deliberately excludes several fields the monolith's single Passenger
// document carries: rating/completedRides/cancelledRides (ride-derived,
// no ride-service exists yet to be their source of truth),
// couponRedemptions (a promotions-service-domain ledger, not profile),
// location/appVersion (dispatch/telemetry, same reasoning auth-service
// already applied to its own model).
import mongoose from "mongoose";

const CITIES = ["Lahore", "Rawalpindi", "Islamabad", "Faisalabad", "Karachi", "Multan", "Quetta", "Peshawar"];
const GENDERS = ["Male", "Female", "Other"];

// No explicit `_id` field/option here — Mongoose's default ObjectId `_id`
// path is exactly what's wanted, it just needs to be *provided* (the
// passengerId from the event) rather than auto-generated at creation
// time, which Mongoose already respects without any schema change.
const passengerProfileSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    gender: { type: String, enum: GENDERS, required: true },
    email: { type: String, unique: true, sparse: true },
    city: { type: String, enum: CITIES },
    // Nullable until a future photo-upload endpoint exists — not built
    // this pass, same as driver-service's document upload being deferred.
    profileImage: { type: String, default: null },
  },
  { timestamps: true },
);

export function getPassengerProfileModel(connection) {
  return connection.models.PassengerProfile ?? connection.model("PassengerProfile", passengerProfileSchema);
}

export { CITIES, GENDERS };
