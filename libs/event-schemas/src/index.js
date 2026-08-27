// Barrel file: every service imports event contracts from "@vsb/event-schemas"
// rather than reaching into individual event files, so adding a new event type
// only requires touching this package, not every consumer's import paths.
export { TOPICS } from "./topics.js";
export { eventEnvelopeSchema, buildEnvelopeSchema } from "./envelope.js";
export {
  COUPON_REDEEMED_TOPIC,
  couponRedeemedPayloadV1,
  couponRedeemedEventV1,
} from "./events/couponRedeemedV1.js";
export {
  PASSENGER_REGISTERED_TOPIC,
  passengerRegisteredPayloadV1,
  passengerRegisteredEventV1,
} from "./events/passengerRegisteredV1.js";
