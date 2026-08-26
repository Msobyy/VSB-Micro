import { describe, it, expect } from "vitest";
import { createLogger } from "../src/index.js";

describe("createLogger", () => {
  it("stamps the service name onto every log line", () => {
    const logger = createLogger("test-service");
    expect(logger.bindings().service).toBe("test-service");
  });

  it("respects an explicit level override", () => {
    const logger = createLogger("test-service", { level: "debug" });
    expect(logger.level).toBe("debug");
  });
});
