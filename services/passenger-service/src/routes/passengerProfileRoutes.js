import { Router } from "express";
import { getMyProfileHandler, updateMyProfileHandler } from "../controllers/passengerProfileController.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { profileRateLimiter } from "../middlewares/rateLimit.js";

// No /:id route at all — "me" is always resolved from the verified
// token (see requireAuth.js), never from a client-supplied id. This
// structurally rules out IDOR rather than relying on an ownership check
// to catch it.
export function passengerProfileRoutes(connection, config, logger, rateLimitOptions) {
  const router = Router();
  router.get("/me", profileRateLimiter(rateLimitOptions), requireAuth(config, logger), getMyProfileHandler(connection));
  router.patch("/me", profileRateLimiter(rateLimitOptions), requireAuth(config, logger), updateMyProfileHandler(connection));
  return router;
}
