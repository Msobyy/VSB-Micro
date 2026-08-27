import { Router } from "express";
import {
  sendOtpHandler,
  verifyOtpHandler,
  registerHandler,
  logoutHandler,
  verifyTokenHandler,
} from "../controllers/passengerAuthController.js";
import { requireAuth } from "../middlewares/requireAuth.js";

export function passengerAuthRoutes(service) {
  const router = Router();
  router.post("/send-otp", sendOtpHandler(service));
  router.post("/verify-otp", verifyOtpHandler(service));
  router.post("/register", registerHandler(service));
  router.post("/logout", requireAuth(service), logoutHandler(service));
  router.post("/verify", verifyTokenHandler(service));
  return router;
}
