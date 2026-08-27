import { Router } from "express";
import {
  sendOtpHandler,
  verifyOtpHandler,
  registerHandler,
  logoutHandler,
  verifyTokenHandler,
} from "../controllers/passengerAuthController.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { sendOtpRateLimiter, generalAuthRateLimiter } from "../middlewares/rateLimit.js";

// rateLimitOptions lets tests override the production-sane defaults
// (see rateLimit.js) with much higher limits so a normal functional test
// run doesn't trip them — real rate-limit *behavior* (a 429 after N
// requests) gets its own dedicated test with a deliberately tiny limit
// instead. Production/dev callers just omit this.
export function passengerAuthRoutes(service, rateLimitOptions = {}) {
  const router = Router();
  router.post("/send-otp", sendOtpRateLimiter(rateLimitOptions.sendOtp), sendOtpHandler(service));
  router.post("/verify-otp", generalAuthRateLimiter(rateLimitOptions.general), verifyOtpHandler(service));
  router.post("/register", generalAuthRateLimiter(rateLimitOptions.general), registerHandler(service));
  router.post("/logout", generalAuthRateLimiter(rateLimitOptions.general), requireAuth(service), logoutHandler(service));
  router.post("/verify", generalAuthRateLimiter(rateLimitOptions.general), verifyTokenHandler(service));
  return router;
}
