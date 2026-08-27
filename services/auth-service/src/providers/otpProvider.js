// The swappable, extensible contract every OTP delivery channel
// implements — same shape/purpose as notification-service's
// pushProvider.js contract, but registry-based rather than a fixed pair,
// so adding a new channel (email, a different SMS vendor, ...) later is
// "write one new file, add it to providers/index.js's ALL_PROVIDERS
// array" and nothing else in this service needs to change.
//
// Each provider module exports:
//   channel: string                                — e.g. "sms", "whatsapp"
//   isConfigured(config): boolean                    — real credentials present?
//   create(config, logger): { name, sendOtp(...) }   — the actual provider instance
//
// The provider instance itself follows:
//   sendOtp({ phone, otp }) => Promise<{ success: boolean }>
// A provider must never throw for a normal delivery failure (bad number,
// vendor outage) — it reports { success: false } instead, so the caller's
// error handling stays provider-agnostic. Throwing is reserved for
// programmer error (missing required args).
export const OTP_PROVIDER_CONTRACT = Object.freeze({
  requiredExports: ["channel", "isConfigured", "create"],
  requiredInstanceMethod: "sendOtp",
});
