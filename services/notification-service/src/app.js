// This service has no real REST surface in the pilot — it's a pure Kafka
// consumer — so the only route is /health, kept as an actual HTTP server
// (rather than nothing) so it fits the same container/orchestrator health
// probe convention as every other service.
import express from "express";

export function createApp({ connection }) {
  const app = express();

  app.get("/health", (req, res) => {
    const mongoUp = connection.readyState === 1;
    res.status(mongoUp ? 200 : 503).json({ status: mongoUp ? "ok" : "degraded", mongo: mongoUp });
  });

  return app;
}
