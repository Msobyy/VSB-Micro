// Builds the map of active OTP channels from config — the one place that
// decides which channels exist and which are real vs. console-fallback.
// Adding a new channel later: write a module satisfying otpProvider.js's
// contract, import it, add it to ALL_PROVIDERS. Nothing else changes —
// otpService.js and everything above it only ever deal with a channel
// name string.
import * as smsProvider from "./jazzSmsOtpProvider.js";
import * as whatsappProvider from "./whatsappOtpProvider.js";
import { createConsoleLogOtpProvider } from "./consoleLogOtpProvider.js";

const ALL_PROVIDERS = [smsProvider, whatsappProvider];

export function createOtpChannels(config, logger) {
  const channels = {};

  for (const providerModule of ALL_PROVIDERS) {
    if (!config.enabledOtpChannels.includes(providerModule.channel)) {
      continue; // disabled entirely via OTP_CHANNELS — not even a console fallback
    }
    channels[providerModule.channel] = providerModule.isConfigured(config)
      ? providerModule.create(config, logger)
      : createConsoleLogOtpProvider({ logger, channel: providerModule.channel });
  }

  return channels;
}
