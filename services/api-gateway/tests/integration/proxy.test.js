// Proves the routing decision documented in src/app.js's header comment:
// full-path passthrough (no prefix stripping) works correctly, including
// for requests with query strings — the exact case a naive
// app.use('/prefix', proxy) setup breaks under http-proxy-middleware v3+.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createLogger } from "@vsb/logger";

describe("api-gateway proxy routing", () => {
  let fakePromotionsService;
  let fakePromotionsUrl;
  let receivedRequests;
  let app;

  beforeAll(async () => {
    receivedRequests = [];
    const upstream = express();
    upstream.use((req, res) => {
      receivedRequests.push({ path: req.path, query: req.query, method: req.method });
      res.status(200).json({ echoedPath: req.path, echoedQuery: req.query });
    });

    await new Promise((resolve) => {
      fakePromotionsService = upstream.listen(0, resolve);
    });
    const { port } = fakePromotionsService.address();
    fakePromotionsUrl = `http://127.0.0.1:${port}`;

    const config = {
      jwtSecret: "test-secret",
      promotionsServiceUrl: fakePromotionsUrl,
      analyticsServiceUrl: "http://127.0.0.1:1", // unused in these tests
    };
    app = createApp({ config, logger: createLogger("api-gateway-test") });
  });

  afterAll(() => new Promise((resolve) => fakePromotionsService.close(resolve)));

  it("forwards the full path to the target service unmodified", async () => {
    const res = await request(app).post("/api/v1/promotions/coupons/TEST10/redeem").send({ driverId: "d1" });

    expect(res.status).toBe(200);
    expect(res.body.echoedPath).toBe("/api/v1/promotions/coupons/TEST10/redeem");
  });

  it("preserves query params without the known v3 extra-slash bug", async () => {
    const res = await request(app).get("/api/v1/promotions/coupons?code=TEST10&active=true");

    expect(res.status).toBe(200);
    expect(res.body.echoedPath).toBe("/api/v1/promotions/coupons");
    expect(res.body.echoedQuery).toEqual({ code: "TEST10", active: "true" });
  });

  it("returns 404 for a path with no matching service", async () => {
    const res = await request(app).get("/api/v1/nonexistent/thing");
    expect(res.status).toBe(404);
  });
});
