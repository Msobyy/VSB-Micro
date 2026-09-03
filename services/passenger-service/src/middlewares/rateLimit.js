// Per-IP request limiting on the profile routes — applying the lesson
// from auth-service's security audit (docs/architecture-decision-records/
// 0009) from the start this time, rather than shipping unlimited routes
// and hardening them later.
import { rateLimit } from "express-rate-limit";

export function profileRateLimiter(options = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { message: "Too many requests from this address. Try again later.", code: "RATE_LIMITED" } },
    ...options,
  });
}
