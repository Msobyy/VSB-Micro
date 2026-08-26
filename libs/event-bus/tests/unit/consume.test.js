// Exercises runConsumer's retry + DLQ logic with mocked kafkajs
// consumer/producer objects (no real broker needed) — this is the
// behavior that matters most to get right, so it's worth testing without
// the overhead/flakiness of a real Kafka integration test.
import { describe, it, expect, vi } from "vitest";
import { runConsumer } from "../../src/consume.js";
import { dlqTopicFor } from "../../src/dlq.js";

function mockConsumer() {
  let eachMessage;
  return {
    subscribe: vi.fn(async () => {}),
    run: vi.fn(async (config) => {
      eachMessage = config.eachMessage;
    }),
    // test helper, not part of the real kafkajs API
    deliver: (payload) => eachMessage(payload),
  };
}

function mockLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakeMessage(payload) {
  return {
    topic: "promotions.coupon.redeemed",
    partition: 0,
    message: { key: "driver_1", value: Buffer.from(JSON.stringify(payload)), headers: {} },
  };
}

describe("runConsumer", () => {
  it("calls the handler once and never touches the DLQ on success", async () => {
    const consumer = mockConsumer();
    const producer = { send: vi.fn() };
    const handler = vi.fn().mockResolvedValue(undefined);

    await runConsumer({ consumer, producer, topics: ["x"], handler, logger: mockLogger(), serviceName: "test" });
    await consumer.deliver(fakeMessage({ eventId: "evt-1" }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(producer.send).not.toHaveBeenCalled();
  });

  it("sends malformed JSON straight to the DLQ without calling the handler", async () => {
    const consumer = mockConsumer();
    const producer = { send: vi.fn() };
    const handler = vi.fn();

    await runConsumer({ consumer, producer, topics: ["x"], handler, logger: mockLogger(), serviceName: "test" });
    await consumer.deliver({
      topic: "promotions.coupon.redeemed",
      partition: 0,
      message: { key: "driver_1", value: Buffer.from("not json"), headers: {} },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(producer.send).toHaveBeenCalledTimes(1);
    expect(producer.send.mock.calls[0][0].topic).toBe(dlqTopicFor("promotions.coupon.redeemed"));
  });

  it("retries a failing handler, recovers, and never sends to the DLQ", async () => {
    const consumer = mockConsumer();
    const producer = { send: vi.fn() };
    let calls = 0;
    const handler = vi.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 2) throw new Error("transient");
    });

    await runConsumer({
      consumer,
      producer,
      topics: ["x"],
      handler,
      logger: mockLogger(),
      serviceName: "test",
      retryBackoffMs: 1,
    });
    await consumer.deliver(fakeMessage({ eventId: "evt-2" }));

    expect(handler).toHaveBeenCalledTimes(2);
    expect(producer.send).not.toHaveBeenCalled();
  });

  it("sends to the DLQ once retries are exhausted", async () => {
    const consumer = mockConsumer();
    const producer = { send: vi.fn() };
    const handler = vi.fn().mockRejectedValue(new Error("always fails"));
    const logger = mockLogger();

    await runConsumer({
      consumer,
      producer,
      topics: ["x"],
      handler,
      logger,
      serviceName: "test",
      maxAttempts: 3,
      retryBackoffMs: 1,
    });
    await consumer.deliver(fakeMessage({ eventId: "evt-3" }));

    expect(handler).toHaveBeenCalledTimes(3);
    expect(producer.send).toHaveBeenCalledTimes(1);
    const dlqEnvelope = JSON.parse(producer.send.mock.calls[0][0].messages[0].value);
    expect(dlqEnvelope.reason).toBe("handler_exhausted_retries");
    expect(dlqEnvelope.attempts).toBe(3);
    expect(logger.warn).toHaveBeenCalledTimes(2); // attempts 1 and 2 logged as retried
  });
});
