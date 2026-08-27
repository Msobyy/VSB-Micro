import { z } from "zod";
import { buildEnvelopeSchema } from "../envelope.js";
import { TOPICS } from "../topics.js";

export const PASSENGER_REGISTERED_TOPIC = TOPICS.AUTH_PASSENGER_REGISTERED;

export const passengerRegisteredPayloadV1 = z.object({
  passengerId: z.string(),
  firstName: z.string(),
  phone: z.string(),
});

export const passengerRegisteredEventV1 = buildEnvelopeSchema(passengerRegisteredPayloadV1);
