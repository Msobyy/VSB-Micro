// Service-specific config layered on @vsb/config's shared infra helpers —
// same pattern as the other pilot services.
import { loadEnv, loadSharedConfig, getConfigInt, getConfigValue } from "@vsb/config";

loadEnv();

const shared = loadSharedConfig();

export const config = {
  ...shared,
  serviceName: "analytics-service",
  port: getConfigInt("port", "PORT", 3003),
  mongoDbName: "vsb_analytics",
  kafkaGroupId: getConfigValue("kafka_group_id", "KAFKA_GROUP_ID", "analytics-service"),
};
