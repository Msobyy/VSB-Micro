// Full HTTP flow against a real (in-memory) replica-set Mongo, with a
// fake `fetch` standing in for the real auth-service /verify call (same
// mocking approach api-gateway's attachUser tests already use).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import { startInMemoryReplicaSet, connectMongoose } from "@vsb/test-utils";
import { createLogger } from "@vsb/logger";
import { createApp } from "../../src/app.js";
import { getPassengerProfileModel } from "../../src/models/passengerProfileModel.js";

const NO_PRACTICAL_LIMIT = { limit: 1000 };
const PASSENGER_ID = "6a0000000000000000000002";

function mockVerify({ valid = true, passengerId = PASSENGER_ID } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => (valid ? { valid: true, passenger: { id: passengerId, role: "passenger" } } : { valid: false }),
    }),
  );
}

describe("passenger profile routes", () => {
  let replSet;
  let connection;
  let app;

  beforeAll(async () => {
    replSet = await startInMemoryReplicaSet();
    connection = await connectMongoose(replSet.uri, "passenger-service-routes-test");
    app = createApp({
      connection,
      config: { authServiceUrl: "http://auth-service.test" },
      logger: createLogger("passenger-service-test"),
      rateLimitOptions: NO_PRACTICAL_LIMIT,
    });
  }, 60000);

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    await getPassengerProfileModel(connection).deleteMany({});
    vi.unstubAllGlobals();
  });

  it("rejects a request with no Authorization/device-token headers, never calling auth-service", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app).get("/api/v1/passengers/me");
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the caller's own profile for a valid session", async () => {
    await getPassengerProfileModel(connection).create({
      _id: PASSENGER_ID, firstName: "Amina", lastName: "Khan", gender: "Female", city: "Lahore",
    });
    mockVerify();

    const res = await request(app)
      .get("/api/v1/passengers/me")
      .set("Authorization", "Bearer real-token")
      .set("device-token", "real-device-1");

    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ firstName: "Amina", city: "Lahore" });
  });

  it("returns 503 PROFILE_NOT_READY for a valid session with no profile document yet", async () => {
    mockVerify();

    const res = await request(app)
      .get("/api/v1/passengers/me")
      .set("Authorization", "Bearer real-token")
      .set("device-token", "real-device-1");

    expect(res.status).toBe(503);
    // libs/http-errors masks `message`/`details` for any 5xx (see its
    // ADR 0009 note), but `code` always survives — this is what a client
    // actually branches on to know "retry shortly" vs. a real failure.
    expect(res.body.error.code).toBe("PROFILE_NOT_READY");
    expect(res.body.error.message).toBe("Internal server error");
  });

  it("rejects when auth-service reports the session invalid", async () => {
    mockVerify({ valid: false });

    const res = await request(app)
      .get("/api/v1/passengers/me")
      .set("Authorization", "Bearer bad-token")
      .set("device-token", "real-device-1");

    expect(res.status).toBe(401);
  });

  it("returns 503 when auth-service itself is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const res = await request(app)
      .get("/api/v1/passengers/me")
      .set("Authorization", "Bearer real-token")
      .set("device-token", "real-device-1");

    expect(res.status).toBe(503);
  });

  it("updates allowed fields and rejects an invalid one", async () => {
    await getPassengerProfileModel(connection).create({
      _id: PASSENGER_ID, firstName: "Amina", lastName: "Khan", gender: "Female",
    });
    mockVerify();

    const goodUpdate = await request(app)
      .patch("/api/v1/passengers/me")
      .set("Authorization", "Bearer real-token")
      .set("device-token", "real-device-1")
      .send({ city: "Karachi" });
    expect(goodUpdate.status).toBe(200);
    expect(goodUpdate.body.profile.city).toBe("Karachi");

    const badUpdate = await request(app)
      .patch("/api/v1/passengers/me")
      .set("Authorization", "Bearer real-token")
      .set("device-token", "real-device-1")
      .send({ city: "Atlantis" });
    expect(badUpdate.status).toBe(400);
  });

  it("returns 409 when updating to an email another passenger already has", async () => {
    await getPassengerProfileModel(connection).create({
      _id: "6a0000000000000000000099", firstName: "Other", lastName: "Person", gender: "Male", email: "taken@example.com",
    });
    await getPassengerProfileModel(connection).create({
      _id: PASSENGER_ID, firstName: "Amina", lastName: "Khan", gender: "Female",
    });
    mockVerify();

    const res = await request(app)
      .patch("/api/v1/passengers/me")
      .set("Authorization", "Bearer real-token")
      .set("device-token", "real-device-1")
      .send({ email: "taken@example.com" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_IN_USE");
  });

  it("never lets a client update someone else's profile — there is no /:id route at all", async () => {
    // Proven structurally rather than by a specific test: passengerProfileRoutes.js
    // only registers /me, resolved from the verified token. Confirm the
    // obvious IDOR-shaped URL simply doesn't exist as a route.
    mockVerify();
    const res = await request(app)
      .get(`/api/v1/passengers/${PASSENGER_ID}`)
      .set("Authorization", "Bearer real-token")
      .set("device-token", "real-device-1");
    expect(res.status).toBe(404);
  });
});
