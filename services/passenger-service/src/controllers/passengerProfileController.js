// Thin HTTP adapter over the profile model — same layering convention as
// the other services. Express 5 forwards a rejected promise from an
// async handler to errorHandler automatically, so these can just `throw`.
import { ApiError } from "@vsb/http-errors";
import { getPassengerProfileModel, CITIES, GENDERS } from "../models/passengerProfileModel.js";

// Every mutable field is validated as a plain string of a bounded shape
// before touching Mongo — the same requireString discipline
// auth-service's audit established (docs/architecture-decision-records/
// 0009), applied here from the start rather than after an incident.
function requireString(value, fieldName, { maxLength = 100 } = {}) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw ApiError.badRequest(`${fieldName} must be a string between 1 and ${maxLength} characters`, {
      code: "INVALID_BODY",
    });
  }
  return value;
}

// Pure — no IO — so it's unit-testable directly, matching this repo's
// convention (e.g. promotions-service's computeRedeemedAmount,
// analytics-service's buildRedemptionQuery) of pulling validation/shaping
// logic out of the handler for that reason.
export function buildProfileUpdate(body) {
  const updates = {};

  if (body?.firstName !== undefined) updates.firstName = requireString(body.firstName, "firstName");
  if (body?.lastName !== undefined) updates.lastName = requireString(body.lastName, "lastName");
  if (body?.gender !== undefined) {
    const gender = requireString(body.gender, "gender", { maxLength: 10 });
    if (!GENDERS.includes(gender)) {
      throw ApiError.badRequest(`gender must be one of: ${GENDERS.join(", ")}`, { code: "INVALID_BODY" });
    }
    updates.gender = gender;
  }
  if (body?.city !== undefined) {
    const city = requireString(body.city, "city", { maxLength: 50 });
    if (!CITIES.includes(city)) {
      throw ApiError.badRequest(`city must be one of: ${CITIES.join(", ")}`, { code: "INVALID_BODY" });
    }
    updates.city = city;
  }
  if (body?.email !== undefined) {
    updates.email = requireString(body.email, "email", { maxLength: 254 }).toLowerCase();
  }

  if (Object.keys(updates).length === 0) {
    throw ApiError.badRequest("No valid fields provided to update", { code: "INVALID_BODY" });
  }

  return updates;
}

export function getMyProfileHandler(connection) {
  return async (req, res) => {
    const PassengerProfile = getPassengerProfileModel(connection);
    const profile = await PassengerProfile.findById(req.passengerId).lean();
    if (!profile) {
      // A valid session but no profile yet — the auth.passenger.registered
      // event hasn't been consumed (or the outbox relay hasn't published
      // it) fast enough. Real, expected under normal eventual-consistency
      // delay right after registration, not a client error.
      throw ApiError.serviceUnavailable("Profile not ready yet, try again shortly", { code: "PROFILE_NOT_READY" });
    }
    res.status(200).json({ profile });
  };
}

export function updateMyProfileHandler(connection) {
  return async (req, res) => {
    const PassengerProfile = getPassengerProfileModel(connection);
    const updates = buildProfileUpdate(req.body);

    let profile;
    try {
      profile = await PassengerProfile.findByIdAndUpdate(req.passengerId, { $set: updates }, { returnDocument: "after", runValidators: true }).lean();
    } catch (err) {
      if (err.code === 11000) {
        throw ApiError.conflict("Email is already in use", { code: "EMAIL_IN_USE" });
      }
      throw err;
    }

    if (!profile) {
      throw ApiError.serviceUnavailable("Profile not ready yet, try again shortly", { code: "PROFILE_NOT_READY" });
    }

    res.status(200).json({ profile });
  };
}
