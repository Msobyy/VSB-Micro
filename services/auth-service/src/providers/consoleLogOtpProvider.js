// Fallback provider satisfying the same contract as jazzSmsOtpProvider.js
// and whatsappOtpProvider.js — used automatically for any channel that
// doesn't have real credentials configured (local dev), and directly
// usable in tests without touching a real gateway.
export function createConsoleLogOtpProvider({ logger, channel }) {
  return {
    name: "console",
    async sendOtp({ phone, otp }) {
      logger.info({ phone, otp, channel }, "OTP (console provider — no real delivery)");
      return { success: true };
    },
  };
}
