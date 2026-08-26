// Entry point. Boot order mirrors vsb-backend's server.js: connect
// datastores first, then start background workers (here: the outbox
// relay), then start accepting HTTP traffic — so nothing serves a request
// before its dependencies are actually up.
import mongoose from "mongoose";
import { createLogger } from "@vsb/logger";
import { createKafkaClient, createProducer, startOutboxRelay } from "@vsb/event-bus";
import { config } from "./config/index.js";
import { createApp } from "./app.js";

const logger = createLogger(config.serviceName);

async function main() {
  const connection = mongoose.createConnection(config.mongoUri, { dbName: config.mongoDbName });
  await connection.asPromise();
  logger.info({ db: config.mongoDbName }, "mongo connected");

  const kafka = createKafkaClient({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const producer = await createProducer(kafka);
  logger.info("kafka producer connected");

  const stopOutboxRelay = startOutboxRelay({ connection, producer, logger });

  const app = createApp({ connection, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "promotions-service listening");
  });

  async function shutdown(signal) {
    logger.info({ signal }, "shutting down");
    await stopOutboxRelay();
    await new Promise((resolve) => server.close(resolve));
    await producer.disconnect();
    await connection.close();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "promotions-service failed to start");
  process.exit(1);
});
