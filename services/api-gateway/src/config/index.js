// Service-specific config layered on @vsb/config's shared infra helpers.
// promotionsServiceUrl/analyticsServiceUrl are only meaningful here — the
// gateway is the one thing in the system that needs to know where every
// other service lives.
import { loadEnv, loadSharedConfig, getConfigInt, getConfigValue } from "@vsb/config";

loadEnv();

const shared = loadSharedConfig();

export const config = {
  ...shared,
  serviceName: "api-gateway",
  port: getConfigInt("port", "PORT", 3000),
  promotionsServiceUrl: getConfigValue("promotions_service_url", "PROMOTIONS_SERVICE_URL", "http://localhost:3001"),
  analyticsServiceUrl: getConfigValue("analytics_service_url", "ANALYTICS_SERVICE_URL", "http://localhost:3003"),
  authServiceUrl: getConfigValue("auth_service_url", "AUTH_SERVICE_URL", "http://localhost:3004"),
};
