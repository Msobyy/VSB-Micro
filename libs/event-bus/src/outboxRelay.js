// The other half of the outbox pattern (see outbox.js): a background loop
// that actually publishes pending outbox rows to Kafka and marks them sent.
// Two mechanisms, belt-and-suspenders:
//   1. A Mongo change stream reacts to new outbox inserts within
//      milliseconds (the common case).
//   2. A periodic sweep re-queries any still-"pending" rows, in case this
//      relay was down (or crashed mid-publish) when they were inserted —
//      change streams only see events that occur *after* they start
//      watching, so without the sweep a missed insert would be lost forever.
// Started once at boot by any service that owns an outbox (e.g.
// promotions-service's server.js).
import { getOutboxModel } from "./outbox.js";
import { publishWithTracing } from "./tracePropagation.js";

async function publishPending(outboxDoc, producer, logger) {
  await publishWithTracing({
    producer,
    topic: outboxDoc.topic,
    key: outboxDoc.partitionKey,
    value: JSON.stringify(outboxDoc.envelope),
    traceContext: outboxDoc.traceContext,
  });
  outboxDoc.status = "sent";
  outboxDoc.sentAt = new Date();
  await outboxDoc.save();
  logger.info({ eventId: outboxDoc.eventId, topic: outboxDoc.topic }, "outbox event published");
}

export function startOutboxRelay({ connection, producer, logger, sweepIntervalMs = 5000 }) {
  const Outbox = getOutboxModel(connection);
  let stopped = false;

  const changeStream = Outbox.watch([{ $match: { operationType: "insert" } }]);
  changeStream.on("change", async (change) => {
    try {
      const doc = await Outbox.findById(change.documentKey._id);
      if (doc && doc.status === "pending") {
        await publishPending(doc, producer, logger);
      }
    } catch (err) {
      logger.error({ err }, "outbox change-stream publish failed; sweep will retry");
    }
  });
  changeStream.on("error", (err) => logger.error({ err }, "outbox change stream error"));

  const sweep = async () => {
    if (stopped) return;
    try {
      const pending = await Outbox.find({ status: "pending" }).limit(50);
      for (const doc of pending) {
        await publishPending(doc, producer, logger);
      }
    } catch (err) {
      logger.error({ err }, "outbox sweep failed");
    }
  };
  const sweepTimer = setInterval(sweep, sweepIntervalMs);
  sweep(); // catch up on anything pending from before this process started

  return async function stopOutboxRelay() {
    stopped = true;
    clearInterval(sweepTimer);
    await changeStream.close();
  };
}
