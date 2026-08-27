// Minimal in-memory stand-in for the subset of ioredis's API otpService.js
// actually uses (get/set/del/incr/expire, with real TTL semantics) — lets
// the OTP state machine be unit-tested without a real Redis, matching how
// event-bus's tests use plain mock objects instead of a real broker.
//
// `now` is injectable (defaults to Date.now) so a test can simulate time
// passing (e.g. the 60s resend cooldown) without either a real 60s wait
// or fighting vitest's fake timers against an in-flight async HTTP
// request — see passengerAuth.test.js's "logs in an existing passenger"
// test for the reason this exists.
export function createFakeRedis({ now = Date.now } = {}) {
  const store = new Map();

  function isExpired(entry) {
    return entry.expiresAt !== null && now() > entry.expiresAt;
  }

  return {
    async get(key) {
      const entry = store.get(key);
      if (!entry || isExpired(entry)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, mode, ttlSeconds) {
      const expiresAt = mode === "EX" ? now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
      return "OK";
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async incr(key) {
      const entry = store.get(key);
      const current = entry && !isExpired(entry) ? Number(entry.value) : 0;
      const next = current + 1;
      store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    async expire(key, ttlSeconds) {
      const entry = store.get(key);
      if (!entry) return 0;
      entry.expiresAt = now() + ttlSeconds * 1000;
      return 1;
    },
  };
}
