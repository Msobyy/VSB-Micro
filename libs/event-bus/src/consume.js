// Standard eachMessage loop every consumer service wires up: parse the
// envelope, hand it to the caller's handler, and let unhandled errors
// propagate so kafkajs's own retry/backoff re-delivers the message (the
// handler itself is expected to be idempotent — see idempotency.js).
export async function runConsumer({ consumer, topics, handler, logger }) {
  await consumer.subscribe({ topics, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      let envelope;
      try {
        envelope = JSON.parse(message.value.toString());
      } catch (err) {
        logger.error({ err, topic, partition }, "dropping message with invalid JSON");
        return; // not retryable — malformed payload will never parse
      }
      try {
        await handler(envelope, { topic, partition });
      } catch (err) {
        logger.error({ err, topic, eventId: envelope.eventId }, "event handler failed, will be retried");
        throw err;
      }
    },
  });
}
