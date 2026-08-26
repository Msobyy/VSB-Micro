// The CQRS read model this service exists to prove out: a denormalized,
// query-optimized view built purely by consuming
// promotions.coupon.redeemed events — analytics-service never calls
// promotions-service to read this data, and never writes to
// promotions-service's own database. If this collection were lost, it's
// fully rebuildable by replaying the topic from the beginning.
import mongoose from "mongoose";

const redemptionSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    couponCode: { type: String, required: true, index: true },
    driverId: { type: String, required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, required: true },
    redeemedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "redemptions" },
);

export function getRedemptionModel(connection) {
  return connection.models.Redemption ?? connection.model("Redemption", redemptionSchema);
}
