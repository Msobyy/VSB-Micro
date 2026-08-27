// Full HTTP flow against a real (in-memory) replica-set Mongo and a fake
// Redis/OTP-provider pair (Redis itself isn't the thing under test here —
// the real value is exercising the Express app + the Mongo transaction +
// outbox insertion on register, same as promotions-service's equivalent
// test).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { startInMemoryReplicaSet, connectMongoose } from "@vsb/test-utils";
import { getOutboxModel } from "@vsb/event-bus";
import { createLogger } from "@vsb/logger";
import { createApp } from "../../src/app.js";
import { getPassengerModel } from "../../src/models/passengerModel.js";
import { createOtpService } from "../../src/services/otpService.js";
import { createPassengerAuthService } from "../../src/services/passengerAuthService.js";
import { createFakeRedis } from "../unit/fakeRedis.js";

describe("passenger auth flow", () => {
  let replSet;
  let connection;
  let app;
  let provider;
  let clock;

  beforeAll(async () => {
    replSet = await startInMemoryReplicaSet();
    connection = await connectMongoose(replSet.uri, "auth-test");

    provider = { name: "fake", sendOtp: vi.fn().mockResolvedValue({ success: true }) };
    clock = { now: Date.now() };
    const otpService = createOtpService({ redis: createFakeRedis({ now: () => clock.now }), channels: { sms: provider } });
    const service = createPassengerAuthService({
      connection,
      otpService,
      config: { jwtSecret: "test-secret", enableTestOtpBypass: false },
    });
    app = createApp({ connection, service, logger: createLogger("auth-service-test") });
  }, 60000);

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    await getPassengerModel(connection).deleteMany({});
    await getOutboxModel(connection).deleteMany({});
    provider.sendOtp.mockClear();
  });

  async function sendAndCaptureOtp(phoneNumber) {
    await request(app).post("/api/v1/auth/send-otp").send({ countryCode: "+92", phoneNumber });
    return provider.sendOtp.mock.calls.at(-1)[0].otp;
  }

  it("signals isNewUser for an unregistered phone, then registers and logs in", async () => {
    const phoneNumber = "3001111111";
    const otp = await sendAndCaptureOtp(phoneNumber);

    const verifyRes = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ countryCode: "+92", phoneNumber, otp, deviceToken: "device-1" });
    expect(verifyRes.body).toEqual({ isNewUser: true });

    const registerRes = await request(app).post("/api/v1/auth/register").send({
      countryCode: "+92",
      phoneNumber,
      firstName: "Amina",
      lastName: "Khan",
      gender: "Female",
      deviceToken: "device-1",
    });
    expect(registerRes.status).toBe(201);
    expect(registerRes.body.token).toBeTypeOf("string");

    const outboxRow = await getOutboxModel(connection).findOne({ topic: "auth.passenger.registered" });
    expect(outboxRow).not.toBeNull();
    expect(outboxRow.envelope.payload.firstName).toBe("Amina");

    // The response still carries the profile (echoed from the request)...
    expect(registerRes.body.passenger).toMatchObject({ firstName: "Amina", lastName: "Khan", gender: "Female" });
    // ...but auth-service's own DB row must NOT persist it — that's
    // passenger-service's data, auth-service only owns identity/session.
    const stored = await getPassengerModel(connection).findById(registerRes.body.passenger.id).lean();
    expect(stored.firstName).toBeUndefined();
    expect(stored.lastName).toBeUndefined();
    expect(stored.phone).toBe(`+92${phoneNumber}`);
  }, 30000);

  it("logs in an existing passenger on verify-otp", async () => {
    const phoneNumber = "3002222222";
    const firstOtp = await sendAndCaptureOtp(phoneNumber);
    await request(app).post("/api/v1/auth/verify-otp").send({ countryCode: "+92", phoneNumber, otp: firstOtp, deviceToken: "device-1" });
    await request(app).post("/api/v1/auth/register").send({
      countryCode: "+92", phoneNumber, firstName: "Bilal", lastName: "Ahmed", gender: "Male", deviceToken: "device-1",
    });

    // A real return login would naturally happen well after the 60s resend
    // cooldown; advance the injected clock instead of actually waiting or
    // fighting vitest's fake timers against the in-flight async HTTP call.
    clock.now += 61_000;

    const secondOtp = await sendAndCaptureOtp(phoneNumber);
    const loginRes = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ countryCode: "+92", phoneNumber, otp: secondOtp, deviceToken: "device-2" });

    expect(loginRes.body.isNewUser).toBe(false);
    expect(loginRes.body.token).toBeTypeOf("string");
  }, 30000);

  it("logout invalidates the session, verify reflects it", async () => {
    const phoneNumber = "3003333333";
    const otp = await sendAndCaptureOtp(phoneNumber);
    await request(app).post("/api/v1/auth/verify-otp").send({ countryCode: "+92", phoneNumber, otp, deviceToken: "device-1" });
    const registerRes = await request(app).post("/api/v1/auth/register").send({
      countryCode: "+92", phoneNumber, firstName: "Sara", lastName: "Malik", gender: "Female", deviceToken: "device-1",
    });
    const { token } = registerRes.body;

    const beforeLogout = await request(app).post("/api/v1/auth/verify").send({ token, deviceToken: "device-1" });
    expect(beforeLogout.body.valid).toBe(true);

    await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .set("device-token", "device-1");

    const afterLogout = await request(app).post("/api/v1/auth/verify").send({ token, deviceToken: "device-1" });
    expect(afterLogout.body.valid).toBe(false);
  }, 30000);
});
