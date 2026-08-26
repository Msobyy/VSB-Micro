// Real FCM implementation of the push provider contract (see
// pushProvider.js). Uses firebase-admin v14's modular API
// (`firebase-admin/app`, `firebase-admin/messaging`) — v14 removed the
// legacy `admin.initializeApp(...)` namespace-style access that
// vsb-backend/vsb-crm-backend still use on firebase-admin v13, so this is
// not a drop-in copy of their config/firebase/firebase.js setup.
//
// Payload shape mirrors vsb-backend/services/fcmBatchHelper.js's
// buildMulticastMessage (android high-priority channel, apns alert+sound)
// so behavior stays consistent with the existing mobile app's expectations
// if this ever talks to real production tokens.
import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

const DEFAULT_ANDROID_CHANNEL = "vsisters_high_importance_v2";

function stringifyData(data = {}) {
  const out = {};
  for (const key of Object.keys(data)) {
    out[key] = typeof data[key] === "string" ? data[key] : String(data[key]);
  }
  return out;
}

export function createFirebasePushProvider({ credentials, logger }) {
  const app = getApps().length ? getApp() : initializeApp({ credential: cert(credentials) });
  const messaging = getMessaging(app);

  return {
    name: "firebase",
    async sendPush({ token, title, body, data }) {
      const message = {
        token,
        notification: { title, body },
        data: stringifyData(data),
        android: {
          priority: "high",
          notification: { channelId: DEFAULT_ANDROID_CHANNEL, priority: "high" },
        },
        apns: {
          headers: { "apns-priority": "10" },
          payload: { aps: { alert: { title, body }, sound: "notify.wav" } },
        },
      };

      try {
        const providerMessageId = await messaging.send(message);
        return { success: true, providerMessageId };
      } catch (err) {
        logger.error({ err: err?.message ?? String(err), token }, "firebase push send failed");
        return { success: false };
      }
    },
  };
}
