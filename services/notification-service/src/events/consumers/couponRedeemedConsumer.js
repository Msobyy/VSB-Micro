// Reacts to promotions.coupon.redeemed by sending the driver a push. This
// is the "pure consumer" leg of the pilot loop described in the plan: it
// never calls promotions-service back, it only reacts to what already
// happened. `pushProvider` is injected (see providers/index.js) so this
// file never knows whether it's really Firebase or the console fallback.
//
// NOTE: there's no real driver-service yet in this pilot, so there's no
// actual FCM device-token lookup — `token` below is a placeholder built
// from driverId. A real extraction would resolve this via driver-service
// (or a token cache this service maintains from a driver.device_registered
// event) before calling sendPush.
import { couponRedeemedEventV1 } from "@vsb/event-schemas";
import { withIdempotency } from "@vsb/event-bus";

export function couponRedeemedConsumer({ connection, pushProvider, logger }) {
  return async (envelope) => {
    const parsed = couponRedeemedEventV1.safeParse(envelope);
    if (!parsed.success) {
      logger.error({ envelope, issues: parsed.error.issues }, "dropping malformed coupon.redeemed event");
      return;
    }

    const { skipped } = await withIdempotency(connection, envelope.eventId, async () => {
      const { driverId, couponCode, amount, currency } = parsed.data.payload;
      await pushProvider.sendPush({
        token: `driver:${driverId}`,
        title: "Coupon redeemed",
        body: `${couponCode} redeemed for ${amount} ${currency}`,
        data: { couponCode, driverId },
      });
    });

    if (skipped) {
      logger.info({ eventId: envelope.eventId }, "duplicate delivery, already processed");
    }
  };
}
