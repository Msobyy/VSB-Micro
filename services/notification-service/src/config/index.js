// Service-specific config layered on @vsb/config's shared infra helpers —
// same pattern as promotions-service/src/config/index.js. The firebase
// block mirrors vsb-backend/config/index.js's shape (same env var names)
// so this service can reuse the same GitHub Actions secrets / Docker
// secrets when it's actually deployed, without renaming anything.
import { loadEnv, loadSharedConfig, getConfigInt, getConfigValue } from "@vsb/config";

loadEnv();

const shared = loadSharedConfig();

const firebase = {
  projectId: getConfigValue("firebase_project_id", "FIREBASE_PROJECT_ID"),
  privateKeyId: getConfigValue("firebase_private_key_id", "FIREBASE_PRIVATE_KEY_ID"),
  privateKey: getConfigValue("firebase_private_key", "FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
  clientEmail: getConfigValue("firebase_client_email", "FIREBASE_CLIENT_EMAIL"),
};

// Auto-fallback to the console provider when Firebase isn't configured
// (e.g. local dev without secrets) rather than crashing on boot — but let
// PUSH_PROVIDER force either choice explicitly (e.g. to fail loudly in an
// environment that's supposed to have real credentials).
const firebaseConfigured = Boolean(firebase.projectId && firebase.privateKey && firebase.clientEmail);
const defaultProvider = firebaseConfigured ? "firebase" : "console";

export const config = {
  ...shared,
  serviceName: "notification-service",
  port: getConfigInt("port", "PORT", 3002),
  mongoDbName: "vsb_notifications",
  kafkaGroupId: getConfigValue("kafka_group_id", "KAFKA_GROUP_ID", "notification-service"),
  pushProvider: getConfigValue("push_provider", "PUSH_PROVIDER", defaultProvider),
  firebase: {
    projectId: firebase.projectId,
    privateKeyId: firebase.privateKeyId,
    privateKey: firebase.privateKey,
    clientEmail: firebase.clientEmail,
  },
};
