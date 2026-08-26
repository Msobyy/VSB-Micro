import { describe, it, expect, vi } from "vitest";
import { createConsoleLogPushProvider } from "../../src/providers/consoleLogPushProvider.js";

describe("consoleLogPushProvider", () => {
  it("reports success without ever throwing", async () => {
    const logger = { info: vi.fn() };
    const provider = createConsoleLogPushProvider({ logger });

    const result = await provider.sendPush({ token: "t1", title: "Hi", body: "there", data: { a: 1 } });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toMatch(/^console-/);
    expect(logger.info).toHaveBeenCalled();
  });
});
