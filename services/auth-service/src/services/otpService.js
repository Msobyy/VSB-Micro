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
import { randomInt } from "node:crypto";

const OTP_EXPIRY_SECONDS = 300;
const ATTEMPT_LIMIT = 3;
const BLOCK_DURATION_SECONDS = 1800;
const RESEND_COOLDOWN_SECONDS = 60;
const ATTEMPT_TTL_SECONDS = 1800; // must be >= OTP_EXPIRY_SECONDS + RESEND_COOLDOWN_SECONDS

const blockKey = (phone) => `otp:block:${phone}`;
const otpKey = (phone) => `otp:${phone}`;
const resendKey = (phone) => `otp:resend:${phone}`;
const attemptsKey = (phone) => `otp:attempts:${phone}`;

function generateOtp() {
  return String(randomInt(100000, 1000000));
}

export function createOtpService({ redis, channels }) {
  return {
    async sendOtp(phone, channel = "sms") {
      const provider = channels[channel];
      if (!provider) {
        return { success: false, message: `OTP channel "${channel}" is not available.` };
      }

      const blocked = await redis.get(blockKey(phone));
      if (blocked) {
        return { success: false, message: "Too many attempts. Try again later." };
      }

      const cooling = await redis.get(resendKey(phone));
      if (cooling) {
        return { success: false, message: "Please wait before requesting another code." };
      }

      const otp = generateOtp();
      const delivery = await provider.sendOtp({ phone, otp });
      if (!delivery.success) {
        return { success: false, message: "Failed to send verification code." };
      }

      await redis.set(otpKey(phone), otp, "EX", OTP_EXPIRY_SECONDS);
      await redis.set(resendKey(phone), "1", "EX", RESEND_COOLDOWN_SECONDS);
      // Refresh the attempt counter's TTL without resetting its value —
      // a resend shouldn't give someone a fresh set of 3 guesses.
      await redis.expire(attemptsKey(phone), ATTEMPT_TTL_SECONDS);

      return { success: true };
    },

    async verifyOtp(phone, inputOtp) {
      const blocked = await redis.get(blockKey(phone));
      if (blocked) {
        return { success: false, message: "Too many attempts. Try again later." };
      }

      const stored = await redis.get(otpKey(phone));
      if (!stored) {
        return { success: false, message: "OTP expired or not sent." };
      }

      if (stored !== inputOtp) {
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
    },
  };
}
