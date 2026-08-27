// Full HTTP flow against a real (in-memory) replica-set Mongo and a fake
// Redis/OTP-provider pair (Redis itself isn't the thing under test here —
// the real value is exercising the Express app + the Mongo transaction +
// outbox insertion on register, same as promotions-service's equivalent
// test). Several of these tests exist specifically because a security
// audit found real, exploitable bugs in this flow before it had any
// dependents — see the "hardening" describe block below.
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

// High enough that normal functional test traffic never trips it — real
// rate-limit *behavior* gets its own dedicated app instance with a tiny
// limit below, rather than fighting the shared limiter's window here.
const NO_PRACTICAL_LIMIT = { sendOtp: { limit: 1000 }, general: { limit: 1000 } };

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
      config: { jwtSecret: "test-secret", enableTestOtpBypass: false, nodeEnv: "test" },
    });
    app = createApp({ connection, service, logger: createLogger("auth-service-test"), rateLimitOptions: NO_PRACTICAL_LIMIT });
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

  // send-otp -> verify-otp -> register, capturing the registrationTicket
  // verify-otp issues — register() now requires it (see the hardening
  // block below for why).
  async function registerNewPassenger(phoneNumber, overrides = {}) {
    const otp = await sendAndCaptureOtp(phoneNumber);
    const verifyRes = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ countryCode: "+92", phoneNumber, otp, deviceToken: "device-1" });
    return request(app)
      .post("/api/v1/auth/register")
      .send({
        countryCode: "+92",
        phoneNumber,
        firstName: "Amina",
        lastName: "Khan",
        gender: "Female",
        deviceToken: "device-1",
        registrationTicket: verifyRes.body.registrationTicket,
        ...overrides,
      });
  }

  it("signals isNewUser (with a registration ticket) for an unregistered phone, then registers and logs in", async () => {
    const phoneNumber = "3001111111";
    const otp = await sendAndCaptureOtp(phoneNumber);

    const verifyRes = await request(app)
      .post("/api/v1/auth/verify-otp")
      .send({ countryCode: "+92", phoneNumber, otp, deviceToken: "device-1" });
    expect(verifyRes.body.isNewUser).toBe(true);
    expect(verifyRes.body.registrationTicket).toBeTypeOf("string");

    const registerRes = await request(app).post("/api/v1/auth/register").send({
      countryCode: "+92",
      phoneNumber,
      firstName: "Amina",
      lastName: "Khan",
      gender: "Female",
      deviceToken: "device-1",
      registrationTicket: verifyRes.body.registrationTicket,
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
    await registerNewPassenger(phoneNumber);

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
    const registerRes = await registerNewPassenger(phoneNumber);
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

  // Regression coverage for a security audit's findings — each of these
  // failed before the corresponding fix.
  describe("hardening", () => {
    it("rejects register() with no registration ticket at all — closes the OTP-bypass registration hole", async () => {
      const phoneNumber = "3004444444";
      // No send-otp/verify-otp call at all — straight to register.
      const res = await request(app).post("/api/v1/auth/register").send({
        countryCode: "+92", phoneNumber, firstName: "Eve", lastName: "Attacker", gender: "Female", deviceToken: "device-1",
        registrationTicket: "not-a-real-ticket",
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("OTP_NOT_VERIFIED");

      const stored = await getPassengerModel(connection).findOne({ phone: `+92${phoneNumber}` });
      expect(stored).toBeNull();
    }, 30000);

    it("rejects a registration ticket issued for a different phone number", async () => {
      const otp = await sendAndCaptureOtp("3005555555");
      const verifyRes = await request(app)
        .post("/api/v1/auth/verify-otp")
        .send({ countryCode: "+92", phoneNumber: "3005555555", otp, deviceToken: "device-1" });

      // Ticket was issued for 3005555555; try to register a different number with it.
      const res = await request(app).post("/api/v1/auth/register").send({
        countryCode: "+92", phoneNumber: "3009999999", firstName: "Eve", lastName: "Attacker", gender: "Female",
        deviceToken: "device-1", registrationTicket: verifyRes.body.registrationTicket,
      });
      expect(res.status).toBe(401);
    }, 30000);

    it("rejects a NoSQL-operator object in place of a string deviceToken on /verify", async () => {
      const phoneNumber = "3006666666";
      const registerRes = await registerNewPassenger(phoneNumber);
      const { token } = registerRes.body;

      // The exact injection an audit found bypassing device-session
      // binding: {"$ne": null} matches any document's deviceToken field
      // in a naive Mongo query.
      const res = await request(app)
        .post("/api/v1/auth/verify")
        .set("Content-Type", "application/json")
        .send(`{"token":"${token}","deviceToken":{"$ne":null}}`);

      expect(res.status).toBe(400);
    }, 30000);

    it("rejects a NoSQL-operator object for deviceToken on register/verify-otp too", async () => {
      const res = await request(app)
        .post("/api/v1/auth/verify-otp")
        .set("Content-Type", "application/json")
        .send('{"countryCode":"+92","phoneNumber":"3007777777","otp":"123456","deviceToken":{"$gt":""}}');
      expect(res.status).toBe(400);
    }, 30000);

    it("rejects malformed phone number components", async () => {
      const res = await request(app)
        .post("/api/v1/auth/send-otp")
        .send({ countryCode: "92", phoneNumber: "not-a-number" }); // missing "+", non-numeric
      expect(res.status).toBe(400);
    });

    it("rejects a gender outside the enum with a clean 400, not a 500", async () => {
      const otp = await sendAndCaptureOtp("3008888888");
      const verifyRes = await request(app)
        .post("/api/v1/auth/verify-otp")
        .send({ countryCode: "+92", phoneNumber: "3008888888", otp, deviceToken: "device-1" });

      const res = await request(app).post("/api/v1/auth/register").send({
        countryCode: "+92", phoneNumber: "3008888888", firstName: "A", lastName: "B", gender: "female",
        deviceToken: "device-1", registrationTicket: verifyRes.body.registrationTicket,
      });
      expect(res.status).toBe(400);
    }, 30000);

    it("rejects a deviceToken shorter than the minimum length", async () => {
      const res = await request(app)
        .post("/api/v1/auth/verify-otp")
        .send({ countryCode: "+92", phoneNumber: "3009111111", otp: "123456", deviceToken: "short" });
      expect(res.status).toBe(400);
    });
  });
});

describe("passenger auth rate limiting", () => {
  let replSet;
  let connection;

  beforeAll(async () => {
    replSet = await startInMemoryReplicaSet();
    connection = await connectMongoose(replSet.uri, "auth-ratelimit-test");
  }, 60000);

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  it("returns 429 once the send-otp limit is exceeded", async () => {
    const provider = { name: "fake", sendOtp: vi.fn().mockResolvedValue({ success: true }) };
    const otpService = createOtpService({ redis: createFakeRedis(), channels: { sms: provider } });
    const service = createPassengerAuthService({
      connection,
      otpService,
      config: { jwtSecret: "test-secret", enableTestOtpBypass: false, nodeEnv: "test" },
    });
    const app = createApp({
      connection,
      service,
      logger: createLogger("auth-service-ratelimit-test"),
      rateLimitOptions: { sendOtp: { limit: 2 }, general: { limit: 1000 } },
    });

    // Distinct phone numbers so otpService's own per-phone cooldown never
    // fires — isolating this test to the rate limiter's behavior only.
    const first = await request(app).post("/api/v1/auth/send-otp").send({ countryCode: "+92", phoneNumber: "3100000001" });
    const second = await request(app).post("/api/v1/auth/send-otp").send({ countryCode: "+92", phoneNumber: "3100000002" });
    const third = await request(app).post("/api/v1/auth/send-otp").send({ countryCode: "+92", phoneNumber: "3100000003" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  }, 30000);
});
