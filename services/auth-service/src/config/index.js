// Service-specific config layered on @vsb/config's shared infra helpers —
// same pattern as the other services. Adds the OTP-channel credentials
// (Jazz SMS, WhatsApp), the test-number bypass flag, and this service's
// own Redis db index — none of which exist anywhere else in this
// monorepo yet.
import { loadEnv, loadSharedConfig, getConfigInt, getConfigValue } from "@vsb/config";

loadEnv();

const shared = loadSharedConfig();

export const config = {
  ...shared,
  serviceName: "auth-service",
  port: getConfigInt("port", "PORT", 3004),
  mongoDbName: "vsb_auth",

  // Which OTP channels are active at all (before even checking whether
  // each has real credentials) — lets ops disable a channel entirely via
  // env var, no code change. See src/providers/index.js.
  enabledOtpChannels: getConfigValue("otp_channels", "OTP_CHANNELS", "sms,whatsapp").split(",").map((c) => c.trim()),
  enableTestOtpBypass: getConfigValue("enable_test_otp_bypass", "ENABLE_TEST_OTP_BYPASS", "false") === "true",

  // Every service that touches Redis owns a distinct db index on the one
  // shared dev Redis instance (see infra/docker-compose.dev.yaml) — no
  // service reads another's keys. auth-service is the first Redis
  // consumer in this monorepo, so it claims db 0; the next one to need
  // Redis should pick 1, and so on — see
  // docs/architecture-decision-records/0006-redis-cloud-per-service-ownership.md.
  redisDb: getConfigInt("redis_db", "REDIS_DB", 0),

  jazz: {
    username: getConfigValue("jazz_username", "JAZZ_USERNAME"),
    password: getConfigValue("jazz_password", "JAZZ_PASSWORD"),
    otpMask: getConfigValue("jazz_otp_mask", "JAZZ_OTP_MASK"),
  },

  whatsapp: {
    accessToken: getConfigValue("whatsapp_access_token", "WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: getConfigValue("whatsapp_number_id", "WHATSAPP_NUMBER_ID"),
    templateName: getConfigValue("whatsapp_template_name", "WHATSAPP_TEMPLATE_NAME", "vsisters_otp_template"),
    languageCode: getConfigValue("whatsapp_language_code", "WHATSAPP_LANGUAGE_CODE", "en_US"),
  },
};
