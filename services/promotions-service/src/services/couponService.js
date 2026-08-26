// Business logic for coupon redemption. Owns the one write path that
// matters for this pilot: atomically (a) claim a redemption slot on the
// coupon and (b) queue the promotions.coupon.redeemed event via the outbox
// — see @vsb/event-bus's outbox.js for why these have to be one transaction.
import { withTransaction, getOutboxModel, buildOutboxDocument, buildEventEnvelope } from "@vsb/event-bus";
import { couponRedeemedEventV1, COUPON_REDEEMED_TOPIC } from "@vsb/event-schemas";
import { ApiError } from "@vsb/http-errors";
import { getCouponModel } from "../models/couponModel.js";

export function computeRedeemedAmount(coupon, fareAmount) {
  if (coupon.type === "flat") return coupon.value;
  return Math.round((coupon.value / 100) * fareAmount * 100) / 100;
}

export async function redeemCoupon(connection, { code, driverId, fareAmount }) {
  const Coupon = getCouponModel(connection);
  const Outbox = getOutboxModel(connection);
  const now = new Date();
  const normalizedCode = code.toUpperCase().trim();

  return withTransaction(connection, async (session) => {
    // Single atomic conditional update — never read-then-write — so
    // concurrent redemptions can't push redemptionsCount past the cap.
    const coupon = await Coupon.findOneAndUpdate(
      {
        code: normalizedCode,
        active: true,
        validFrom: { $lte: now },
        validTo: { $gte: now },
        $expr: {
          $or: [
            { $eq: ["$maxRedemptionsTotal", 0] },
            { $lt: ["$redemptionsCount", "$maxRedemptionsTotal"] },
          ],
        },
      },
      { $inc: { redemptionsCount: 1 } },
      { returnDocument: "after", session },
    );

    if (!coupon) {
      throw ApiError.conflict("Coupon is invalid, expired, or fully redeemed", {
        code: "COUPON_NOT_REDEEMABLE",
      });
    }

    const amount = computeRedeemedAmount(coupon, fareAmount);
    const envelope = buildEventEnvelope({
      eventType: COUPON_REDEEMED_TOPIC,
      eventVersion: 1,
      source: "promotions-service",
      partitionKey: driverId,
      payload: {
        couponCode: coupon.code,
        driverId,
        amount,
        currency: "PKR",
        redeemedAt: now.toISOString(),
      },
    });

    const parsed = couponRedeemedEventV1.safeParse(envelope);
    if (!parsed.success) {
      // Should be unreachable — a bug in this service, not bad input —
      // surfaced loudly rather than silently publishing a malformed event.
      throw ApiError.internal("Built an event that fails its own schema", {
        code: "EVENT_SCHEMA_VIOLATION",
        details: parsed.error.issues,
      });
    }

    await Outbox.create(
      [buildOutboxDocument({ eventId: envelope.eventId, topic: COUPON_REDEEMED_TOPIC, partitionKey: driverId, envelope })],
      { session },
    );

    return { coupon, event: envelope };
  });
}
