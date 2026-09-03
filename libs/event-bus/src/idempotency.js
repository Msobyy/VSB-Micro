// Kafka only guarantees at-least-once delivery, so every consumer must be
// idempotent. This tracks which eventIds a given service has already
// processed (its own Mongo collection — dedupe state is per-consumer, not
// shared) and skips the handler on redelivery. Used by consumer-side
// services (e.g. notification-service, analytics-service).
import mongoose from "mongoose";

const processedEventSchema = new mongoose.Schema(
  { eventId: { type: String, required: true, unique: true } },
  { timestamps: true, collection: "processed_events" },
);

export function getProcessedEventModel(connection) {
  return connection.models.ProcessedEvent ?? connection.model("ProcessedEvent", processedEventSchema);
}

/**
 * Runs `handler(session)` only if `eventId` hasn't been processed before by
 * this service, marking it processed IN THE SAME Mongo transaction as
 * whatever `handler` writes — not before `handler` runs. An earlier version
 * inserted the ProcessedEvent row first and ran `handler` after; if
 * `handler` then threw, the eventId was already marked done, so
 * runConsumer's retries (attempts 2/3) hit the duplicate-key branch below,
 * returned `{skipped: true}` without ever calling `handler` again, and the
 * failure silently vanished — no retry, no DLQ, no record the write never
 * happened. Wrapping both writes in one transaction fixes that: if
 * `handler` throws, the whole transaction (including the ProcessedEvent
 * insert) aborts, so a subsequent delivery attempt sees the eventId as
 * NOT yet processed and genuinely retries.
 *
 * The unique index on `eventId` still makes concurrent redelivery safe
 * (e.g. two overlapping deliveries during a consumer-group rebalance):
 * whichever transaction's insert loses the race gets a duplicate-key
 * abort, not a committed double effect — this is the same
 * exists-check-then-insert-would-race problem the original comment here
 * called out, just now decided inside the transaction instead of before it.
 *
 * `handler` receives the same Mongo session so its own write(s) join this
 * transaction — e.g. `Model.create([{...}], { session })` (Mongoose's
 * transaction form, matching passengerAuthService.js's register()). A
 * handler with no Mongo write of its own (a push-only consumer, say) can
 * just ignore the argument.
 *
 * Retries here are bounded (MAX_ATTEMPTS) and only kick in for an error
 * labeled `TransientTransactionError` — MongoDB's own signal that NOTHING
 * in the transaction was durably applied (transactions are all-or-nothing,
 * so a `WriteConflict` at commit means the ProcessedEvent insert and
 * `handler`'s Mongo writes were both rolled back, not partially applied)
 * and it's safe to retry the whole attempt from scratch. This is the
 * standard, MongoDB-documented retry pattern for transactions — this
 * function just makes it explicit and bounded rather than reaching for
 * the driver's own built-in `session.withTransaction()` retry (which
 * retries on the same signal but with an opaque, unbounded ~120s internal
 * deadline instead of a fixed attempt count, a worse fit for a consumer
 * hot path). A genuine duplicate (`E11000`, a different eventId already
 * fully committed by a prior run) is NOT transient and returns
 * `{skipped: true}` immediately, no retry.
 *
 * The one accepted trade-off: if `handler` performs irreversible non-Mongo
 * I/O (e.g. a push-notification consumer's `provider.sendPush` call) and
 * a `TransientTransactionError` then hits on commit, retrying re-invokes
 * `handler` and that I/O fires again. This is narrow — it needs a real
 * write conflict to land specifically between the external call
 * succeeding and commit completing — and it's the same at-least-once
 * contract this whole file already documents at the top (Kafka can
 * redeliver the same message for the same reason); it does not introduce
 * a new failure mode, just a second low-probability source of the one
 * that already exists. The bug this function exists to fix — a handler
 * failure being permanently and silently swallowed as "already
 * processed" — is fully closed: any non-transient error aborts once and
 * propagates to the caller (runConsumer's own retry+backoff+DLQ loop in
 * consume.js) without marking `eventId` processed.
 */
const MAX_ATTEMPTS = 3;

function isTransientTransactionError(err) {
  return typeof err?.hasErrorLabel === "function" && err.hasErrorLabel("TransientTransactionError");
}

export async function withIdempotency(connection, eventId, handler) {
  const ProcessedEvent = getProcessedEventModel(connection);
  // Mongoose builds a freshly-declared model's indexes in the background
  // and does NOT wait for that before allowing writes — a `.create()`
  // issued right after `getProcessedEventModel()` can land before the
  // unique index on `eventId` actually exists server-side, so two calls
  // for the same eventId can both insert successfully (no E11000 from
  // either) instead of the second one being correctly rejected as a
  // duplicate. `.init()` resolves once index creation has actually
  // finished (and is a cheap no-op on every call after the first — Mongoose
  // caches the resolved promise), so this makes sure the uniqueness
  // guarantee this whole function depends on is actually active first.
  await ProcessedEvent.init();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const session = await connection.startSession();
    try {
      session.startTransaction();
      let result;
      let commitAttempted = false;
      try {
        await ProcessedEvent.create([{ eventId }], { session });
        result = await handler(session);
        commitAttempted = true;
        await session.commitTransaction();
      } catch (err) {
        // Once commitTransaction() has been called — whether it succeeded
        // or threw — the driver has already ended the transaction one way
        // or another; calling abortTransaction() after that throws
        // ("Cannot call abortTransaction after calling commitTransaction"),
        // so only abort if commit itself was never attempted.
        if (!commitAttempted) {
          await session.abortTransaction().catch(() => {});
        }
        if (err.code === 11000) {
          return { skipped: true }; // already processed this eventId
        }
        if (isTransientTransactionError(err) && attempt < MAX_ATTEMPTS) {
          continue; // nothing was durably applied — safe to retry from scratch
        }
        throw err;
      }
      return { skipped: false, result };
    } finally {
      await session.endSession();
    }
  }
}
