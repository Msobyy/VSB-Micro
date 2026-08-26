// Pilot-scoped port of vsb-backend/models/couponModel.js. Keeps the money
// invariant that made the original worth copying — redemption counts only
// ever move via an atomic conditional $inc, never read-modify-write, so
// concurrent redemptions can't blow past `maxRedemptionsTotal`. Deliberately
// drops the ride-specific fields (minFare, capPerRide, eligibility-by-ride-
// count, allowedUserIds) since there's no ride domain in this pilot; a real
// extraction of promotions-service would carry those over.
import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    type: { type: String, required: true, enum: ["percent", "flat"] },
    // 0-100 for percent, PKR amount for flat.
    value: { type: Number, required: true, min: 0 },
    // 0 = unlimited.
    maxRedemptionsTotal: { type: Number, default: 0, min: 0 },
    redemptionsCount: { type: Number, default: 0 },
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

couponSchema.index({ active: 1, validFrom: 1, validTo: 1 });

export function getCouponModel(connection) {
  return connection.models.Coupon ?? connection.model("Coupon", couponSchema);
}
