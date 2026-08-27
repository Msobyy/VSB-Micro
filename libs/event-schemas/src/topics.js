/**
 * Single source of truth for Kafka topic names. Naming convention:
 * `<domain>.<entity>.<event>` — see docs/event-catalog.md for the full list
 * with payload schemas, partition keys, and producer/consumer mapping.
 */
export const TOPICS = Object.freeze({
  PROMOTIONS_COUPON_REDEEMED: "promotions.coupon.redeemed",
  AUTH_PASSENGER_REGISTERED: "auth.passenger.registered",
});
