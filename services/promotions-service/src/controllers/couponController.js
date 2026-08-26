// Thin HTTP adapter over couponService — keeps request parsing/response
// shaping separate from the transaction/business logic, matching the
// layered convention the two existing monoliths already use.
import { ApiError } from "@vsb/http-errors";
import { redeemCoupon } from "../services/couponService.js";

export function redeemCouponHandler(connection) {
  return async (req, res) => {
    const { code } = req.params;
    const { driverId, fareAmount } = req.body ?? {};

    if (!driverId || typeof fareAmount !== "number") {
      throw ApiError.badRequest("driverId and numeric fareAmount are required", {
        code: "INVALID_BODY",
      });
    }

    const { coupon, event } = await redeemCoupon(connection, { code, driverId, fareAmount });

    res.status(200).json({
      couponCode: coupon.code,
      redemptionsCount: coupon.redemptionsCount,
      eventId: event.eventId,
    });
  };
}
