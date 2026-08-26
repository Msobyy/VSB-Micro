// Fallback provider satisfying the same contract as firebasePushProvider.js
// (see pushProvider.js) — used automatically when no Firebase service
// account is configured (e.g. local dev without secrets), and directly
// usable in tests without touching a real FCM project. Swapping providers
// is just picking a different file here, per createPushProvider's factory
// in index.js.
export function createConsoleLogPushProvider({ logger }) {
  return {
    name: "console",
    async sendPush({ token, title, body, data }) {
      logger.info({ token, title, body, data }, "push notification (console provider — no real delivery)");
      return { success: true, providerMessageId: `console-${Date.now()}` };
    },
  };
}
