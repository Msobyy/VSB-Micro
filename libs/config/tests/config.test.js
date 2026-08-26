import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfigValue, getConfigInt, loadSharedConfig } from "../src/index.js";

describe("getConfigValue", () => {
  const ENV_VAR = "VSB_TEST_VALUE";

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it("falls back to process.env when no secret files exist", () => {
    process.env[ENV_VAR] = "from-env";
    expect(getConfigValue("does-not-exist", ENV_VAR, "default")).toBe("from-env");
  });

  it("falls back to the default when nothing else is set", () => {
    expect(getConfigValue("does-not-exist", "VSB_TEST_MISSING", "fallback")).toBe("fallback");
  });
});

describe("getConfigInt", () => {
  it("coerces the resolved value to a number", () => {
    process.env.VSB_TEST_PORT = "4000";
    expect(getConfigInt("does-not-exist", "VSB_TEST_PORT", 3000)).toBe(4000);
    delete process.env.VSB_TEST_PORT;
  });

  it("returns the default when unset", () => {
    expect(getConfigInt("does-not-exist", "VSB_TEST_PORT_MISSING", 3000)).toBe(3000);
  });
});

describe("loadSharedConfig", () => {
  it("returns a well-formed shared config object with sane defaults", () => {
    const config = loadSharedConfig();
    expect(Array.isArray(config.kafka.brokers)).toBe(true);
    expect(config.kafka.brokers.length).toBeGreaterThan(0);
    expect(typeof config.mongoUri).toBe("string");
    expect(typeof config.redis.port).toBe("number");
  });
});
