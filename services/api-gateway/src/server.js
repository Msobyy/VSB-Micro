// Entry point. Unlike the other pilot services, the gateway has no
// datastore or Kafka connection of its own — it's pure routing — so
// there's nothing to connect before listening.
// OTel auto-instrumentation is loaded via NODE_OPTIONS
// (--require @opentelemetry/auto-instrumentations-node/register), not an
// in-app import — see docs/architecture-decision-records/0004-otel-preload-not-import.md
// for why an app-level "import tracing first" approach doesn't reliably
// instrument kafkajs specifically.
import { createLogger } from "@vsb/logger";
import { config } from "./config/index.js";
import { createApp } from "./app.js";

const logger = createLogger(config.serviceName);

const app = createApp({ config, logger });
const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "api-gateway listening");
});

function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
