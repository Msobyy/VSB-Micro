import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/**
 * Loads .env for local/dev runs only. In production, config is expected to
 * arrive via real env vars / mounted secrets — never a .env file.
 * Call once, as early as possible, from each service's entrypoint.
 */
export function loadEnv() {
  if (process.env.NODE_ENV === "production") return;
  dotenv.config();
  // also pick up the repo-root .env.example-derived .env when running
  // services individually (outside docker-compose) from a service dir.
  const rootEnv = path.resolve(process.cwd(), "../../.env");
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv, override: false });
  }
}

function readSecretFile(dir, name) {
  const filePath = path.join(dir, name);
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return undefined;
  }
}

/**
 * Resolves a config value through, in order:
 *   1. /run/secrets/<name>   (Docker secret)
 *   2. /etc/config/<name>    (Kubernetes ConfigMap/Secret volume mount)
 *   3. process.env[envVar]
 *   4. defaultValue
 *
 * Every service should route config through this instead of reading
 * process.env directly, so the same code works unmodified whether it's
 * run via docker-compose, Docker secrets, or a future Kubernetes/ECS
 * deployment — only the injection mechanism changes.
 */
export function getConfigValue(name, envVar, defaultValue) {
  return (
    readSecretFile("/run/secrets", name) ??
    readSecretFile("/etc/config", name) ??
    process.env[envVar] ??
    defaultValue
  );
}

export function getConfigInt(name, envVar, defaultValue) {
  const raw = getConfigValue(name, envVar, undefined);
  return raw === undefined ? defaultValue : Number(raw);
}

/** Shared infra config every service needs. Service-specific config should
 * live in that service's own src/config, built on top of these helpers. */
export function loadSharedConfig() {
  return {
    nodeEnv: getConfigValue("node_env", "NODE_ENV", "development"),
    kafka: {
      brokers: getConfigValue("kafka_brokers", "KAFKA_BROKERS", "localhost:19092").split(","),
      clientId: getConfigValue("kafka_client_id", "KAFKA_CLIENT_ID", "vsb-microservices"),
    },
    mongoUri: getConfigValue("mongo_uri", "MONGO_URI", "mongodb://localhost:27017"),
    redis: {
      host: getConfigValue("redis_host", "REDIS_HOST", "localhost"),
      port: getConfigInt("redis_port", "REDIS_PORT", 6379),
    },
    jwtSecret: getConfigValue("jwt_secret", "JWT_SECRET", "dev-secret-change-me"),
  };
}
