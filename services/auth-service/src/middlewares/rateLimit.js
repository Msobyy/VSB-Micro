// Per-IP request limiting — found missing entirely in a security audit.
// otp-service.js's Redis-backed cooldown/block is keyed per PHONE
// NUMBER, which does nothing to stop one IP from hitting /send-otp for
// thousands of distinct (even garbage) phone numbers, each triggering a
// real, billed SMS/WhatsApp send. This is a separate, complementary
// layer: per-IP, in front of the per-phone logic in otpService.js.
import { rateLimit } from "express-rate-limit";

const WINDOW_MS = 15 * 60 * 1000;

function rateLimitedResponse(message) {
  return { error: { message, code: "RATE_LIMITED" } };
}

// Stricter — this is the endpoint that costs real money per request.
export function sendOtpRateLimiter(options = {}) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: rateLimitedResponse("Too many verification code requests from this address. Try again later."),
    ...options,
  });
}

// Looser, general floor across the rest of the auth routes (verify-otp,
// register, logout, verify) — mainly a backstop against scripted abuse,
// not tuned as tightly as send-otp's since these don't carry a per-call
// provider cost the way send-otp does.
export function generalAuthRateLimiter(options = {}) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: rateLimitedResponse("Too many requests from this address. Try again later."),
    ...options,
  });
}
