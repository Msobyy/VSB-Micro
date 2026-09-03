// Builds the read model (redemptionReadModel.js) from
// promotions.coupon.redeemed events. Same shape as
// notification-service's consumer of the same topic — schema-validate,
// then run the side effect inside withIdempotency — because each consumer
// group tracks its own delivery progress independently; this is a
// separate, unrelated dedupe store from notification-service's.
import { couponRedeemedEventV1 } from "@vsb/event-schemas";
import { withIdempotency } from "@vsb/event-bus";
import { getRedemptionModel } from "../../models/redemptionReadModel.js";

export function couponRedeemedConsumer({ connection, logger }) {
  const Redemption = getRedemptionModel(connection);

  return async (envelope) => {
    const parsed = couponRedeemedEventV1.safeParse(envelope);
    if (!parsed.success) {
      logger.error({ envelope, issues: parsed.error.issues }, "dropping malformed coupon.redeemed event");
      return;
    }

    const { skipped } = await withIdempotency(connection, envelope.eventId, async (session) => {
      const { couponCode, driverId, amount, currency, redeemedAt } = parsed.data.payload;
      // Same transaction as withIdempotency's own processed-event marker
      // (session comes from there) — see that file's header comment.
      await Redemption.create(
        [{ eventId: envelope.eventId, couponCode, driverId, amount, currency, redeemedAt: new Date(redeemedAt) }],
        { session },
      );
    });

    if (skipped) {
      logger.info({ eventId: envelope.eventId }, "duplicate delivery, already processed");
    }
  };
}
