// Redis-backed OTP state machine, ported from
// vsb-backend/services/otpService.js + whatsappOTPService.js (which
// duplicated this same logic per-channel in the original — collapsed
// into one channel-agnostic implementation here; `channels` is the
// registry built by providers/index.js, keyed by channel name).
//
// Same tuning as the original: 5 min OTP validity, 60s resend cooldown,
// max 3 verify attempts before a 30 min block, and the attempt counter's
// own TTL deliberately outlives the OTP's TTL so someone can't reset the
// attempt count just by waiting for the OTP to expire.
//
// One deliberate change from the original: OTP digits come from
// crypto.randomInt, not Math.random — the original wasn't
// cryptographically random and there's no reason to carry that forward.
//
// A second change found in a security audit: sendOtp's cooldown check
// and verifyOtp's block-check/increment used to be separate, non-atomic
// Redis round-trips — a burst of concurrent requests for the same phone
// could all read "not blocked/not cooling" before any single one of them
// updated that state, letting an attacker extract more real guesses (or
// trigger more real SMS sends) per burst than the limits intend. Both
// now go through a short-lived mutual-exclusion lock (a `SET ... NX EX`,
// the standard Redis distributed-lock pattern) so only one request per
// phone can be inside the check-then-act sequence at a time. The lock
// self-expires (LOCK_TTL_SECONDS) so a crash between acquire and release
// can't deadlock a phone number forever.
import { randomInt, timingSafeEqual } from "node:crypto";

const OTP_EXPIRY_SECONDS = 300;
const ATTEMPT_LIMIT = 3;
const BLOCK_DURATION_SECONDS = 1800;
const RESEND_COOLDOWN_SECONDS = 60;
const ATTEMPT_TTL_SECONDS = 1800; // must be >= OTP_EXPIRY_SECONDS + RESEND_COOLDOWN_SECONDS
const LOCK_TTL_SECONDS = 5; // generous for a handful of Redis round trips

const blockKey = (phone) => `otp:block:${phone}`;
const otpKey = (phone) => `otp:${phone}`;
const resendKey = (phone) => `otp:resend:${phone}`;
const attemptsKey = (phone) => `otp:attempts:${phone}`;
const lockKey = (phone) => `otp:lock:${phone}`;

function generateOtp() {
  return String(randomInt(100000, 1000000));
}

// Plain `!==` leaks a timing signal proportional to how many leading
// characters match. Not practically exploitable given the 3-attempt
// block, but a comparison this cheap to make constant-time should be.
function safeCompareOtp(stored, input) {
  const a = Buffer.from(String(stored));
  const b = Buffer.from(String(input));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function withPhoneLock(redis, phone, fn) {
  const key = lockKey(phone);
  const acquired = await redis.set(key, "1", "EX", LOCK_TTL_SECONDS, "NX");
  if (!acquired) {
    return { success: false, message: "Please try again in a moment." };
  }
  try {
    return await fn();
  } finally {
    await redis.del(key);
  }
}

export function createOtpService({ redis, channels }) {
  return {
    async sendOtp(phone, channel = "sms") {
      const provider = channels[channel];
      if (!provider) {
        return { success: false, message: `OTP channel "${channel}" is not available.` };
      }

      return withPhoneLock(redis, phone, async () => {
        const blocked = await redis.get(blockKey(phone));
        if (blocked) {
          return { success: false, message: "Too many attempts. Try again later." };
        }

        // Atomically claim the cooldown slot before sending — this is
        // what closes the race, not the read-then-write pair the lock
        // above also happens to serialize.
        const acquiredCooldown = await redis.set(resendKey(phone), "1", "EX", RESEND_COOLDOWN_SECONDS, "NX");
        if (!acquiredCooldown) {
          return { success: false, message: "Please wait before requesting another code." };
        }

        const otp = generateOtp();
        const delivery = await provider.sendOtp({ phone, otp });
        if (!delivery.success) {
          // Free the cooldown slot so a failed send doesn't needlessly
          // block an immediate retry.
          await redis.del(resendKey(phone));
          return { success: false, message: "Failed to send verification code." };
        }

        await redis.set(otpKey(phone), otp, "EX", OTP_EXPIRY_SECONDS);
        // Refresh the attempt counter's TTL without resetting its value —
        // a resend shouldn't give someone a fresh set of 3 guesses.
        await redis.expire(attemptsKey(phone), ATTEMPT_TTL_SECONDS);

        return { success: true };
      });
    },

    async verifyOtp(phone, inputOtp) {
      return withPhoneLock(redis, phone, async () => {
        const blocked = await redis.get(blockKey(phone));
        if (blocked) {
          return { success: false, message: "Too many attempts. Try again later." };
        }

        const stored = await redis.get(otpKey(phone));
        if (!stored) {
          return { success: false, message: "OTP expired or not sent." };
        }

        if (!safeCompareOtp(stored, inputOtp)) {
          const attempts = await redis.incr(attemptsKey(phone));
          await redis.expire(attemptsKey(phone), ATTEMPT_TTL_SECONDS);
          if (attempts >= ATTEMPT_LIMIT) {
            await redis.del(otpKey(phone));
            await redis.del(attemptsKey(phone));
            await redis.set(blockKey(phone), "1", "EX", BLOCK_DURATION_SECONDS);
            return { success: false, message: "Too many incorrect attempts. Try again later." };
          }
          return { success: false, message: `Incorrect code. ${ATTEMPT_LIMIT - attempts} attempt(s) remaining.` };
        }

        await redis.del(otpKey(phone));
        await redis.del(attemptsKey(phone));
        return { success: true };
      });
    },
  };
}
