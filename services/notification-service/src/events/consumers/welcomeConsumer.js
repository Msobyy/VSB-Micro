// Reacts to auth.passenger.registered with a "Welcome" push — the second
// event topic this service consumes, proving the pilot's pattern
// generalizes past its original one-topic demo (see
// docs/event-catalog.md). Same shape as couponRedeemedConsumer.js:
// schema-validate, then idempotent send via the injected push provider.
//
// NOTE: same placeholder-token caveat as couponRedeemedConsumer.js — no
// real device-token lookup exists yet, `token` is built from passengerId.
import { passengerRegisteredEventV1 } from "@vsb/event-schemas";
import { withIdempotency } from "@vsb/event-bus";

export function welcomeConsumer({ connection, pushProvider, logger }) {
  return async (envelope) => {
    const parsed = passengerRegisteredEventV1.safeParse(envelope);
    if (!parsed.success) {
      logger.error({ envelope, issues: parsed.error.issues }, "dropping malformed passenger.registered event");
      return;
    }

    const { skipped } = await withIdempotency(connection, envelope.eventId, async () => {
      const { passengerId, firstName } = parsed.data.payload;
      await pushProvider.sendPush({
        token: `passenger:${passengerId}`,
        title: "Welcome to VSisters",
        body: `Hi ${firstName}, your account is ready. Book your first ride!`,
        data: { passengerId },
      });
    });

    if (skipped) {
      logger.info({ eventId: envelope.eventId }, "duplicate delivery, already processed");
    }
  };
}
