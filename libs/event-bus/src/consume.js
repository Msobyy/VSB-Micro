// Standard eachMessage loop every consumer service wires up: parse the
// envelope, retry the caller's handler a few times in-process (the handler
// is expected to be idempotent — see idempotency.js — so a retry after a
// transient failure, e.g. a dropped Mongo connection, is always safe), and
// if it still fails, hand off to the DLQ (dlq.js) rather than either of the
// two worse defaults: kafkajs crash-looping the consumer forever on the
// same message once ITS OWN retry budget is exhausted, or silently
// blocking every later message on that partition behind a poison one.
import { consumeWithTracing } from "./tracePropagation.js";
import { sendToDlq } from "./dlq.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runWithRetries(fn, { attempts, backoffMs, onAttemptFailed }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === attempts) throw err;
      onAttemptFailed(err, attempt);
      await sleep(backoffMs * attempt); // linear backoff: 1x, 2x, 3x...
    }
  }
}

export async function runConsumer({
  consumer,
  producer,
  topics,
  handler,
  logger,
  serviceName,
  maxAttempts = 3,
  retryBackoffMs = 500,
}) {
  await consumer.subscribe({ topics, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      let envelope;
      try {
        envelope = JSON.parse(message.value.toString());
      } catch (err) {
        // Not retryable — malformed payload will never parse differently
        // on a later attempt — so this skips straight to the DLQ.
        await sendToDlq({ producer, topic, message, reason: "invalid_json", error: err, attempts: 0, serviceName, logger });
        return;
      }

      try {
        await runWithRetries(
          () =>
            consumeWithTracing({
              topic,
              headers: message.headers,
              handler: () => handler(envelope, { topic, partition }),
            }),
          {
            attempts: maxAttempts,
            backoffMs: retryBackoffMs,
            onAttemptFailed: (err, attempt) =>
              logger.warn({ err: err.message, topic, eventId: envelope.eventId, attempt, maxAttempts }, "handler attempt failed, retrying"),
          },
        );
      } catch (err) {
        await sendToDlq({
          producer,
          topic,
          message,
          reason: "handler_exhausted_retries",
          error: err,
          attempts: maxAttempts,
          serviceName,
          logger,
        });
      }
    },
  });
}
