// Routes an incoming message to the right per-topic consumer.
// @vsb/event-bus's runConsumer takes one handler for however many topics
// it's subscribed to (see consume.js) — this is that one handler,
// dispatching by topic rather than each service having to duplicate the
// subscribe/retry/DLQ wiring per event type it cares about.
import { TOPICS } from "@vsb/event-schemas";
import { couponRedeemedConsumer } from "./couponRedeemedConsumer.js";
import { welcomeConsumer } from "./welcomeConsumer.js";

export function createEventRouter({ connection, pushProvider, logger }) {
  const handlers = {
    [TOPICS.PROMOTIONS_COUPON_REDEEMED]: couponRedeemedConsumer({ connection, pushProvider, logger }),
    [TOPICS.AUTH_PASSENGER_REGISTERED]: welcomeConsumer({ connection, pushProvider, logger }),
  };

  return async (envelope, { topic }) => {
    const handler = handlers[topic];
    if (!handler) {
      logger.warn({ topic }, "no consumer registered for this topic");
      return;
    }
    return handler(envelope);
  };
}
