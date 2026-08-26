// Express app wiring, separated from server.js — same rationale as
// promotions-service/src/app.js (tests build an app against an in-memory
// Mongo connection without booting the Kafka consumer side).
// Routes at /api/v1/analytics/*, matching the full path api-gateway
// forwards unchanged (see services/api-gateway/src/app.js).
import express from "express";
import { errorHandler, notFoundHandler } from "@vsb/http-errors";
import { redemptionsRoutes } from "./routes/redemptionsRoutes.js";

export function createApp({ connection, logger }) {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    const mongoUp = connection.readyState === 1;
    res.status(mongoUp ? 200 : 503).json({ status: mongoUp ? "ok" : "degraded", mongo: mongoUp });
  });

  app.use("/api/v1/analytics/redemptions", redemptionsRoutes(connection));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
