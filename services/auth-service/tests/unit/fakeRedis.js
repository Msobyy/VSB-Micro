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
//
// `latencyMs` is injectable too (defaults to 0) for concurrency tests
// specifically — with 0 latency every method resolves on the current
// microtask with no real interleaving, which made an earlier version of
// this fake unable to reproduce a genuine race between two "concurrent"
// calls (a security audit called this out directly: a race in
// otpService.js wasn't, and couldn't have been, caught by tests against
// this fake as it stood). A non-zero latency schedules each call's real
// work via setTimeout, so two calls started before either resolves
// actually race each other through the event loop the way two real
// network round-trips would, and whichever's timer fires first wins any
// check-then-act sequence — see otpService.test.js's concurrency test.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFakeRedis({ now = Date.now, latencyMs = 0 } = {}) {
  const store = new Map();

  function isExpired(entry) {
    return entry.expiresAt !== null && now() > entry.expiresAt;
  }

  return {
    async get(key) {
      if (latencyMs > 0) await sleep(latencyMs);
      const entry = store.get(key);
      if (!entry || isExpired(entry)) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    // `flag` mirrors ioredis's variadic SET options — only "NX" (set only
    // if the key doesn't already exist) is implemented, since it's the
    // only one otpService.js actually uses (for its atomic lock/cooldown
    // claims). Real Redis's SET NX returns null on failure, "OK" on
    // success — matched here exactly since otpService.js branches on it.
    async set(key, value, mode, ttlSeconds, flag) {
      if (latencyMs > 0) await sleep(latencyMs);
      if (flag === "NX") {
        const existing = store.get(key);
        if (existing && !isExpired(existing)) return null;
      }
      const expiresAt = mode === "EX" ? now() + ttlSeconds * 1000 : null;
      store.set(key, { value, expiresAt });
      return "OK";
    },
    async del(key) {
      if (latencyMs > 0) await sleep(latencyMs);
      return store.delete(key) ? 1 : 0;
    },
    async incr(key) {
      if (latencyMs > 0) await sleep(latencyMs);
      const entry = store.get(key);
      const current = entry && !isExpired(entry) ? Number(entry.value) : 0;
      const next = current + 1;
      store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    },
    async expire(key, ttlSeconds) {
      if (latencyMs > 0) await sleep(latencyMs);
      const entry = store.get(key);
      if (!entry) return 0;
      entry.expiresAt = now() + ttlSeconds * 1000;
      return 1;
    },
  };
}
