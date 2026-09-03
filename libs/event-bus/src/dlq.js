// A message a consumer couldn't process after retrying lands here instead
// of two worse outcomes: kafkajs crash-looping the whole consumer forever
// on the same poison message once its own retry budget is exhausted, or —
// if retries were disabled — silently blocking every message queued behind
// it on that partition. Whoever owns the service can inspect <topic>.dlq
// later (Redpanda Console, or a small replay script) and decide what to do
// with it. Used internally by runConsumer (consume.js) — not meant to be
// called directly by service code.
export function dlqTopicFor(topic) {
  return `${topic}.dlq`;
}

export async function sendToDlq({ producer, topic, message, reason, error, attempts, serviceName, logger }) {
  const dlqTopic = dlqTopicFor(topic);
  const dlqEnvelope = {
    originalTopic: topic,
    originalKey: message.key?.toString() ?? null,
    originalValue: message.value?.toString() ?? null,
    reason,
    error: { message: error?.message ?? String(error), stack: error?.stack },
    attempts,
    consumerGroup: serviceName,
    failedAt: new Date().toISOString(),
  };

  // acks: -1 ("all") — a DLQ write that gets lost is a poison message
  // vanishing with no record anywhere, which is worse than the crash-loop
  // this whole mechanism exists to avoid.
  await producer.send({
    topic: dlqTopic,
    messages: [{ key: message.key, value: JSON.stringify(dlqEnvelope) }],
    acks: -1,
  });

  logger.error({ dlqTopic, reason, attempts, eventId: dlqEnvelope.originalKey }, "message sent to DLQ after exhausting retries");
}
