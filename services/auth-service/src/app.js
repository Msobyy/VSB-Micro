// Express app wiring, separated from server.js — same rationale as
// promotions-service/src/app.js (tests build an app against an in-memory
// Mongo connection + a fake OTP provider without booting Redis/Kafka).
// Routes at /api/v1/auth/*, matching the full path api-gateway forwards
// unchanged.
import express from "express";
import { errorHandler, notFoundHandler } from "@vsb/http-errors";
import { passengerAuthRoutes } from "./routes/passengerAuthRoutes.js";

export function createApp({ connection, service, logger, rateLimitOptions }) {
  const app = express();
  // Requests normally arrive via api-gateway, one hop of reverse proxy —
  // without this, express-rate-limit (routes/passengerAuthRoutes.js)
  // would key every request off the gateway's container IP instead of
  // the real caller, collapsing per-client limiting into one shared
  // bucket for all traffic. `1` = trust exactly one hop's
  // X-Forwarded-For entry, not an arbitrary chain of proxies.
  app.set("trust proxy", 1);
  app.use(express.json());

  app.get("/health", (req, res) => {
    const mongoUp = connection.readyState === 1;
    res.status(mongoUp ? 200 : 503).json({ status: mongoUp ? "ok" : "degraded", mongo: mongoUp });
  });

  app.use("/api/v1/auth", passengerAuthRoutes(service, rateLimitOptions));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
