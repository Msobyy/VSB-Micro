// Factory that picks the active push provider from config. This is the one
// place that decides Firebase vs. console-log vs. (later) anything else —
// callers everywhere else just use whatever `sendPush` they're handed.
import { createFirebasePushProvider } from "./firebasePushProvider.js";
import { createConsoleLogPushProvider } from "./consoleLogPushProvider.js";

export function createPushProvider(config, logger) {
  if (config.pushProvider === "firebase") {
    return createFirebasePushProvider({ credentials: config.firebase, logger });
  }
  return createConsoleLogPushProvider({ logger });
}
