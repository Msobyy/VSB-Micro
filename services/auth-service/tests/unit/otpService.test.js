import { describe, it, expect, vi } from "vitest";
import { createOtpService } from "../../src/services/otpService.js";
import { createFakeRedis } from "./fakeRedis.js";

function fakeProvider(success = true) {
  return { name: "fake", sendOtp: vi.fn().mockResolvedValue({ success }) };
}

describe("otpService", () => {
  it("sends and stores an OTP that verifyOtp then accepts", async () => {
    const redis = createFakeRedis();
    const sms = fakeProvider();
    const service = createOtpService({ redis, channels: { sms } });

    const sendResult = await service.sendOtp("+923001234567");
    expect(sendResult.success).toBe(true);

    const sentOtp = sms.sendOtp.mock.calls[0][0].otp;
    expect(sentOtp).toMatch(/^\d{6}$/);

    const verifyResult = await service.verifyOtp("+923001234567", sentOtp);
    expect(verifyResult.success).toBe(true);
  });

  it("routes to the requested channel, not always the default", async () => {
    const redis = createFakeRedis();
    const sms = fakeProvider();
    const whatsapp = fakeProvider();
    const service = createOtpService({ redis, channels: { sms, whatsapp } });

    await service.sendOtp("+923001234567", "whatsapp");

    expect(whatsapp.sendOtp).toHaveBeenCalledTimes(1);
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it("fails cleanly for a channel that isn't in the registry", async () => {
    const redis = createFakeRedis();
    const service = createOtpService({ redis, channels: { sms: fakeProvider() } });

    const result = await service.sendOtp("+923001234567", "email");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not available/);
  });

  it("fails to send when the provider reports failure", async () => {
    const redis = createFakeRedis();
    const sms = fakeProvider(false);
    const service = createOtpService({ redis, channels: { sms } });

    const result = await service.sendOtp("+923001234567");
    expect(result.success).toBe(false);
  });

  it("rejects a resend within the cooldown window", async () => {
    const redis = createFakeRedis();
    const service = createOtpService({ redis, channels: { sms: fakeProvider() } });

    await service.sendOtp("+923001234567");
    const second = await service.sendOtp("+923001234567");

    expect(second.success).toBe(false);
  });

  it("rejects an incorrect OTP and reports remaining attempts", async () => {
    const redis = createFakeRedis();
    const service = createOtpService({ redis, channels: { sms: fakeProvider() } });
    await service.sendOtp("+923001234567");

    const result = await service.verifyOtp("+923001234567", "000000");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/2 attempt/);
  });

  it("blocks the phone after 3 incorrect attempts", async () => {
    const redis = createFakeRedis();
    const service = createOtpService({ redis, channels: { sms: fakeProvider() } });
    await service.sendOtp("+923001234567");

    await service.verifyOtp("+923001234567", "000000");
    await service.verifyOtp("+923001234567", "000000");
    const third = await service.verifyOtp("+923001234567", "000000");
    expect(third.message).toMatch(/Too many incorrect attempts/);

    // Blocked now, even with the (never revealed) correct code — but we
    // don't know it since we never captured it; any code should be
    // rejected by the block, not by the (now-deleted) OTP mismatch path.
    const fourth = await service.verifyOtp("+923001234567", "999999");
    expect(fourth.success).toBe(false);
    expect(fourth.message).toMatch(/Too many attempts/);
  });

  it("rejects verification when no OTP was ever sent", async () => {
    const redis = createFakeRedis();
    const service = createOtpService({ redis, channels: { sms: fakeProvider() } });

    const result = await service.verifyOtp("+923009999999", "123456");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/expired or not sent/);
  });

  // A security audit found the block-check/compare/increment sequence
  // was three separate non-atomic Redis round-trips, letting a burst of
  // concurrent guesses race past the 3-attempt cap before the block took
  // effect. `latencyMs` on the fake makes these calls genuinely
  // interleave through the event loop (see fakeRedis.js's header
  // comment) instead of resolving synchronously, so this test actually
  // exercises the race rather than trivially passing regardless of
  // whether the fix is present.
  it("only lets one concurrent request per phone actually reach the compare/increment logic", async () => {
    const redis = createFakeRedis({ latencyMs: 5 });
    const service = createOtpService({ redis, channels: { sms: fakeProvider() } });
    await service.sendOtp("+923001234567");

    const results = await Promise.all([
      service.verifyOtp("+923001234567", "000000"),
      service.verifyOtp("+923001234567", "000000"),
      service.verifyOtp("+923001234567", "000000"),
      service.verifyOtp("+923001234567", "000000"),
      service.verifyOtp("+923001234567", "000000"),
    ]);

    const lockBusy = results.filter((r) => r.message === "Please try again in a moment.");
    const processed = results.filter((r) => r.message !== "Please try again in a moment.");

    // The lock fails fast rather than queueing — only whichever request
    // wins the lock actually reaches the block-check/compare/increment
    // sequence; the rest are rejected outright rather than being allowed
    // to race it. That's what closes the vulnerability: not "everyone
    // eventually gets a turn," just "nobody can sneak a guess in during
    // another request's turn." If the old (unpatched) three-separate-
    // round-trips version were still in place, all 5 would reach
    // "processed" instead of 4 being rejected here.
    expect(processed).toHaveLength(1);
    expect(lockBusy).toHaveLength(4);
    expect(processed[0].success).toBe(false);
    expect(processed[0].message).toMatch(/attempt/i);
  });
});
