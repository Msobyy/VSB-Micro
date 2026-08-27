// Entry point. Boot order: datastores (Mongo, Redis) first, then the
// outbox relay (register() publishes auth.passenger.registered), then
// HTTP — same ordering principle as promotions-service/src/server.js.
// OTel auto-instrumentation is loaded via NODE_OPTIONS
// (--require @opentelemetry/auto-instrumentations-node/register), not an
// in-app import — see docs/architecture-decision-records/0004-otel-preload-not-import.md.
import mongoose from "mongoose";
import Redis from "ioredis";
import { createLogger } from "@vsb/logger";
import { createKafkaClient, createProducer, startOutboxRelay } from "@vsb/event-bus";
import { config } from "./config/index.js";
import { createApp } from "./app.js";
import { createOtpChannels } from "./providers/index.js";
import { createOtpService } from "./services/otpService.js";
import { createPassengerAuthService } from "./services/passengerAuthService.js";

const logger = createLogger(config.serviceName);

async function main() {
  const connection = mongoose.createConnection(config.mongoUri, { dbName: config.mongoDbName });
  await connection.asPromise();
  logger.info({ db: config.mongoDbName }, "mongo connected");

  // db + keyPrefix: this service's isolation on the shared Redis Cloud
  // instance — see config/index.js's redisDb comment and
  // docs/architecture-decision-records/0006-redis-cloud-per-service-ownership.md.
  // No other service should ever read auth:*-prefixed or db-0 keys.
  // username/password are conditional so an unauthenticated local Redis
  // (no creds set) doesn't get rejected with "Client sent AUTH, but no
  // password is set" — same guard vsb-crm-backend's sharedRedis.js uses.
  const redisOptions = { host: config.redis.host, port: config.redis.port, db: config.redisDb, keyPrefix: "auth:" };
  if (config.redis.username) redisOptions.username = config.redis.username;
  if (config.redis.password) redisOptions.password = config.redis.password;
  const redis = new Redis(redisOptions);
  await new Promise((resolve, reject) => {
    redis.once("ready", resolve);
    redis.once("error", reject);
  });
  logger.info({ db: config.redisDb }, "redis connected");

  const otpChannels = createOtpChannels(config, logger);
  logger.info({ channels: Object.keys(otpChannels) }, "otp channels ready");
  const otpService = createOtpService({ redis, channels: otpChannels });

  const kafka = createKafkaClient({ clientId: config.kafka.clientId, brokers: config.kafka.brokers });
  const producer = await createProducer(kafka);
  logger.info("kafka producer connected");

  const stopOutboxRelay = startOutboxRelay({ connection, producer, logger });

  const service = createPassengerAuthService({ connection, otpService, config });

  const app = createApp({ connection, service, logger });
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "auth-service listening");
  });

  async function shutdown(signal) {
    logger.info({ signal }, "shutting down");
    await stopOutboxRelay();
    await new Promise((resolve) => server.close(resolve));
    await producer.disconnect();
    await redis.quit();
    await connection.close();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "auth-service failed to start");
  process.exit(1);
});
