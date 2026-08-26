import { describe, it, expect, vi } from "vitest";
import { dlqTopicFor, sendToDlq } from "../../src/dlq.js";

describe("dlqTopicFor", () => {
  it("appends .dlq to the original topic name", () => {
    expect(dlqTopicFor("promotions.coupon.redeemed")).toBe("promotions.coupon.redeemed.dlq");
  });
});

describe("sendToDlq", () => {
  it("publishes an envelope carrying the original message, error, and attempt count", async () => {
    const producer = { send: vi.fn() };
    const logger = { error: vi.fn() };
    const message = { key: Buffer.from("driver_1"), value: Buffer.from('{"couponCode":"X"}') };

    await sendToDlq({
      producer,
      topic: "promotions.coupon.redeemed",
      message,
      reason: "handler_exhausted_retries",
      error: new Error("boom"),
      attempts: 3,
      serviceName: "notification-service",
      logger,
    });

    expect(producer.send).toHaveBeenCalledTimes(1);
    const call = producer.send.mock.calls[0][0];
    expect(call.topic).toBe("promotions.coupon.redeemed.dlq");
    const envelope = JSON.parse(call.messages[0].value);
    expect(envelope).toMatchObject({
      originalTopic: "promotions.coupon.redeemed",
      originalKey: "driver_1",
      originalValue: '{"couponCode":"X"}',
      reason: "handler_exhausted_retries",
      attempts: 3,
      consumerGroup: "notification-service",
    });
    expect(envelope.error.message).toBe("boom");
    expect(logger.error).toHaveBeenCalled();
  });
});
