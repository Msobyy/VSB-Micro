// The only write path that creates a profile — there is no
// POST /passengers HTTP endpoint, deliberately, since a profile without a
// corresponding identity record in auth-service shouldn't be able to
// exist. Same shape as notification-service's consumers: schema-validate,
// then the actual work inside withIdempotency (Kafka only guarantees
// at-least-once delivery).
import { passengerRegisteredEventV1 } from "@vsb/event-schemas";
import { withIdempotency } from "@vsb/event-bus";
import { getPassengerProfileModel } from "../../models/passengerProfileModel.js";

export function passengerRegisteredConsumer({ connection, logger }) {
  const PassengerProfile = getPassengerProfileModel(connection);

  return async (envelope) => {
    const parsed = passengerRegisteredEventV1.safeParse(envelope);
    if (!parsed.success) {
      logger.error({ envelope, issues: parsed.error.issues }, "dropping malformed passenger.registered event");
      return;
    }

    const { skipped } = await withIdempotency(connection, envelope.eventId, async () => {
      const { passengerId, firstName, lastName, gender, email, city } = parsed.data.payload;
      // Same _id auth-service minted at registration — the correlation
      // key across both services, never regenerated here.
      await PassengerProfile.create({ _id: passengerId, firstName, lastName, gender, email, city });
    });

    if (skipped) {
      logger.info({ eventId: envelope.eventId }, "duplicate delivery, already processed");
    }
  };
}
