import { z } from "zod";
import { buildEnvelopeSchema } from "../envelope.js";
import { TOPICS } from "../topics.js";

export const PASSENGER_REGISTERED_TOPIC = TOPICS.AUTH_PASSENGER_REGISTERED;

// Carries the full profile snapshot collected at registration — not just
// what auth-service itself needs (auth-service only persists identity
// fields, see its passengerModel.js). This is the vehicle for a future
// passenger-service to build its own profile record from, and for any
// other reactive consumer (e.g. a welcome push) that needs a point-in-time
// name/contact snapshot without querying another service for it.
export const passengerRegisteredPayloadV1 = z.object({
  passengerId: z.string(),
  phone: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  gender: z.enum(["Male", "Female", "Other"]),
  email: z.string().optional(),
  city: z.string().optional(),
});

export const passengerRegisteredEventV1 = buildEnvelopeSchema(passengerRegisteredPayloadV1);
