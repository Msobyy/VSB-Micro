import pino from "pino";

/**
 * One consistent log shape across every service — every service stamps
 * `service` on the root logger so aggregated logs (Loki/CloudWatch/etc)
 * can be filtered by origin without per-service log parsing rules.
 */
export function createLogger(serviceName, { level } = {}) {
  return pino({
    name: serviceName,
    level: level ?? process.env.LOG_LEVEL ?? "info",
    base: { service: serviceName },
    timestamp: pino.stdTimeFunctions.isoTime,
    transport:
      process.env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
  });
}
