// Express app wiring, separated from server.js (which owns the actual
// listen/connect/shutdown lifecycle) so tests can build an app instance
// against an in-memory Mongo connection without booting a real server.
//
// Routes live at /api/v1/promotions/* — the full path api-gateway forwards
// unchanged (see services/api-gateway/src/app.js for why: it proxies without
// stripping the prefix, so each service owns its own full path namespace,
// same convention vsb-backend/vsb-crm-backend already use).
import express from "express";
import { errorHandler, notFoundHandler } from "@vsb/http-errors";
import { couponRoutes } from "./routes/couponRoutes.js";

export function createApp({ connection, logger }) {
  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    const mongoUp = connection.readyState === 1;
    res.status(mongoUp ? 200 : 503).json({ status: mongoUp ? "ok" : "degraded", mongo: mongoUp });
  });

  app.use("/api/v1/promotions/coupons", couponRoutes(connection));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
