// Mounted under /coupons in app.js. Express 5 forwards a rejected promise
// from an async handler to errorHandler automatically, so redeemCouponHandler
// can just `throw` ApiError instead of needing a try/catch or wrapper here.
import { Router } from "express";
import { redeemCouponHandler } from "../controllers/couponController.js";

export function couponRoutes(connection) {
  const router = Router();
  router.post("/:code/redeem", redeemCouponHandler(connection));
  return router;
}
