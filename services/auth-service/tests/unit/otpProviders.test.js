import { describe, it, expect } from "vitest";
import { createOtpChannels } from "../../src/providers/index.js";

function baseConfig(overrides = {}) {
  return {
    enabledOtpChannels: ["sms", "whatsapp"],
    jazz: { username: undefined, password: undefined, otpMask: undefined },
    whatsapp: { accessToken: undefined, phoneNumberId: undefined, templateName: "t", languageCode: "en_US" },
    ...overrides,
  };
}

const logger = { info: () => {}, error: () => {} };

describe("createOtpChannels", () => {
  it("falls back to the console provider for a channel with no real credentials", () => {
    const channels = createOtpChannels(baseConfig(), logger);
    expect(channels.sms.name).toBe("console");
    expect(channels.whatsapp.name).toBe("console");
  });

  it("uses the real provider once credentials are present", () => {
    const config = baseConfig({ jazz: { username: "u", password: "p" } });
    const channels = createOtpChannels(config, logger);
    expect(channels.sms.name).toBe("jazz-sms");
  });

  it("excludes a channel entirely when it's not in enabledOtpChannels", () => {
    const config = baseConfig({ enabledOtpChannels: ["sms"] });
    const channels = createOtpChannels(config, logger);
    expect(channels.sms).toBeDefined();
    expect(channels.whatsapp).toBeUndefined();
  });
});
