// Entry point. Boots Mongo (dedupe store) + the push provider before
// subscribing to Kafka, so the consumer never processes a message before
// its dependencies are ready — same ordering principle as
// promotions-service/src/server.js.
// OTel auto-instrumentation is loaded via NODE_OPTIONS
// (--require @opentelemetry/auto-instrumentations-node/register), not an
// in-app import — see docs/architecture-decision-records/0004-otel-preload-not-import.md
// for why an app-level "import tracing first" approach doesn't reliably
// instrument kafkajs specifically.
import mongoose from "mongoose";
import { createLogger } from "@vsb/logger";
import { createKafkaClient, createConsumer, runConsumer } from "@vsb/event-bus";
import { TOPICS } from "@vsb/event-schemas";
import { config } from "./config/index.js";
import { createApp } from "./app.js";
import { createPushProvider } from "./providers/index.js";
import { couponRedeemedConsumer } from "./events/consumers/couponRedeemedConsumer.js";

const logger = createLogger(config.serviceName);

async function main() {
  const connection = mongoose.createConnection(config.mongoUri, { dbName: config.mongoDbName });
  await connection.asPromise();
  logger.info({ db: config.mongoDbName }, "mongo connected");

  const pushProvider = createPushProvider(config, logger);
  logger.info({ provider: pushProvider.name }, "push provider selected");

  const kafka = createKafkaClient({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const consumer = await createConsumer(kafka, config.kafkaGroupId);

  const handler = couponRedeemedConsumer({ connection, pushProvider, logger });
  const consumeLoop = runConsumer({
    consumer,
    topics: [TOPICS.PROMOTIONS_COUPON_REDEEMED],
    handler,
    logger,
  });
  consumeLoop.catch((err) => {
    logger.error({ err }, "consumer loop crashed");
    process.exit(1);
  });

  const app = createApp({ connection });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "notification-service listening");
  });

  async function shutdown(signal) {
    logger.info({ signal }, "shutting down");
    await consumer.disconnect();
    await new Promise((resolve) => server.close(resolve));
    await connection.close();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "notification-service failed to start");
  process.exit(1);
});
