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
