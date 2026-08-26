// Bridges trace context across the outbox's async gap.
//
// Auto-instrumentation (via @opentelemetry/auto-instrumentations-node)
// covers HTTP/Express/Mongo automatically, but NOT kafkajs when it's
// required from an ESM file (as libs/event-bus is) — require-in-the-middle,
// which auto-instrumentation depends on, hooks CommonJS's Module._load;
// an ESM `import` of a CJS package like kafkajs bypasses that hook
// entirely, while a CJS package (e.g. mongoose) requiring another CJS
// package (mongodb) internally still goes through it fine. That's a
// documented Node/OTel limitation, not a bug in this setup — see
// docs/architecture-decision-records/0004-otel-preload-not-import.md.
//
// So the Kafka producer/consumer boundary is spanned manually here instead.
// This also solves a second problem auto-instrumentation couldn't have
// solved anyway: the outbox relay publishes asynchronously (via a Mongo
// change stream or a periodic sweep), not inline with the original HTTP
// request, so there's no "active span" to auto-attach to at publish time.
// The fix is to capture the trace context at outbox-write time (still
// inside the original request) and carry it as data on the outbox row
// itself, so the relay can resume that trace whenever it actually
// publishes — seconds later, or after a service restart.
import { context, propagation, trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";

/** Call while the original request's span is still active (e.g. in the
 * same function that builds the outbox document) to snapshot it for later. */
export function captureTraceContext() {
  const carrier = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

const tracer = trace.getTracer("@vsb/event-bus");

/** Wraps a Kafka producer.send() in a PRODUCER span, resumed from the
 * outbox row's captured trace context, and injects the resulting span's
 * context into the outgoing message headers so the consumer can link back. */
export async function publishWithTracing({ producer, topic, key, value, traceContext }) {
  const parentContext = propagation.extract(context.active(), traceContext ?? {});
  return context.with(parentContext, () =>
    tracer.startActiveSpan(
      `${topic} publish`,
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          "messaging.system": "kafka",
          "messaging.destination.name": topic,
          "messaging.kafka.message.key": key,
        },
      },
      async (span) => {
        try {
          const headers = {};
          propagation.inject(context.active(), headers);
          await producer.send({ topic, messages: [{ key, value, headers }] });
        } catch (err) {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          throw err;
        } finally {
          span.end();
        }
      },
    ),
  );
}

/** Wraps a consumer's per-message handler in a CONSUMER span, resumed from
 * whatever trace context the producer injected into the message headers. */
export async function consumeWithTracing({ topic, headers, handler }) {
  const carrier = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    carrier[k] = v?.toString();
  }
  const parentContext = propagation.extract(context.active(), carrier);
  return context.with(parentContext, () =>
    tracer.startActiveSpan(
      `${topic} process`,
      { kind: SpanKind.CONSUMER, attributes: { "messaging.system": "kafka", "messaging.destination.name": topic } },
      async (span) => {
        try {
          await handler();
        } catch (err) {
          span.recordException(err);
          span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
          throw err;
        } finally {
          span.end();
        }
      },
    ),
  );
}
