// Express app wiring, separated from server.js — same rationale as
// promotions-service/src/app.js (tests build an app against an in-memory
// Mongo connection + a fake OTP provider without booting Redis/Kafka).
// Routes at /api/v1/auth/*, matching the full path api-gateway forwards
// unchanged.
import express from "express";
import { errorHandler, notFoundHandler } from "@vsb/http-errors";
import { passengerAuthRoutes } from "./routes/passengerAuthRoutes.js";

export function createApp({ connection, service, logger }) {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    const mongoUp = connection.readyState === 1;
    res.status(mongoUp ? 200 : 503).json({ status: mongoUp ? "ok" : "degraded", mongo: mongoUp });
  });

  app.use("/api/v1/auth", passengerAuthRoutes(service));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
