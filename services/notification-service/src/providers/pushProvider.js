// The swappable contract every push provider implements. Nothing else in
// this service (pushNotificationService.js, the coupon-redeemed consumer)
// talks to firebase-admin or any other SDK directly — they only call
// `provider.sendPush(...)`. That's the whole point: swapping FCM for
// OneSignal/APNs/whatever later means writing one new file that satisfies
// this shape and flipping the PUSH_PROVIDER env var, not touching business
// logic.
//
// Contract (documented, not enforced by the language — this is plain JS):
//   sendPush({ token, title, body, data }) => Promise<{
//     success: boolean,
//     providerMessageId?: string,   // present when success is true
//   }>
// A provider must never throw for a normal delivery failure (bad/expired
// token, provider outage) — it reports { success: false } instead, so the
// caller's retry/idempotency handling stays provider-agnostic. Throwing is
// reserved for programmer error (e.g. missing required args).
export const PUSH_PROVIDER_CONTRACT = Object.freeze({
  requiredMethod: "sendPush",
});
