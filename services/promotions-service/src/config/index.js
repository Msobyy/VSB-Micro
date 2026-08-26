// Service-specific config, layered on top of @vsb/config's shared infra
// helpers (secret-file / env-var fallback chain). Anything promotions-service
// needs beyond the shared basics (its own Mongo db name, HTTP port, Kafka
// consumer-group id if it ever needs one) gets added here rather than read
// from process.env directly elsewhere in this service.
import { loadEnv, loadSharedConfig, getConfigInt } from "@vsb/config";

loadEnv();

const shared = loadSharedConfig();

export const config = {
  ...shared,
  serviceName: "promotions-service",
  port: getConfigInt("port", "PORT", 3001),
  mongoDbName: "vsb_promotions",
};
