// Express app wiring, separated from server.js — tests build an app
// against an in-memory Mongo connection + a fake `fetch` standing in for
// the auth-service call, without booting Kafka. Routes at
// /api/v1/passengers/*, matching the full path api-gateway forwards
// unchanged.
import express from "express";
import { errorHandler, notFoundHandler } from "@vsb/http-errors";
import { passengerProfileRoutes } from "./routes/passengerProfileRoutes.js";

export function createApp({ connection, config, logger, rateLimitOptions }) {
  const app = express();
  // Requests normally arrive via api-gateway, one hop of reverse proxy —
  // see auth-service/src/app.js's identical comment for why this matters
  // for express-rate-limit's per-client keying.
  app.set("trust proxy", 1);
  app.use(express.json());

  app.get("/health", (req, res) => {
    const mongoUp = connection.readyState === 1;
    res.status(mongoUp ? 200 : 503).json({ status: mongoUp ? "ok" : "degraded", mongo: mongoUp });
  });

  app.use("/api/v1/passengers", passengerProfileRoutes(connection, config, logger, rateLimitOptions));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
