import { z } from "zod";
import { buildEnvelopeSchema } from "../envelope.js";
import { TOPICS } from "../topics.js";

export const COUPON_REDEEMED_TOPIC = TOPICS.PROMOTIONS_COUPON_REDEEMED;

export const couponRedeemedPayloadV1 = z.object({
  couponCode: z.string(),
  driverId: z.string(),
  amount: z.number().nonnegative(),
  currency: z.literal("PKR"),
  redeemedAt: z.string(),
});

export const couponRedeemedEventV1 = buildEnvelopeSchema(couponRedeemedPayloadV1);
