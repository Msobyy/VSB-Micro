// Service-specific config layered on @vsb/config's shared infra helpers —
// same pattern as the other services. Adds authServiceUrl since this is
// the first service that makes a real synchronous call to another
// service in this repo (requireAuth.js calling auth-service's /verify).
import { loadEnv, loadSharedConfig, getConfigInt, getConfigValue } from "@vsb/config";

loadEnv();

const shared = loadSharedConfig();

export const config = {
  ...shared,
  serviceName: "passenger-service",
  port: getConfigInt("port", "PORT", 3005),
  mongoDbName: "vsb_passengers",
  kafkaGroupId: getConfigValue("kafka_group_id", "KAFKA_GROUP_ID", "passenger-service"),
  authServiceUrl: getConfigValue("auth_service_url", "AUTH_SERVICE_URL", "http://localhost:3004"),
};
