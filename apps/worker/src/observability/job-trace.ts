/**
 * Span « producteur » d'un événement publié par le relais (ADR-009) : enfant du span HTTP d'origine (colonne
 * `kernel.domain_events.traceparent`), il fournit le `traceparent` déposé dans les données du job BullMQ.
 *
 * Traçage inactif : aucun span, les données du job restent `{ event }` (forme historique, octet pour octet).
 */
import type { DomainEvent } from "@ecoledigitale/kernel";
import { context, trace } from "@opentelemetry/api";
import {
  SpanKind,
  contextFromTraceparent,
  currentTraceparent,
  identityAttributes,
  isTracingEnabled,
  recordSafeException,
  tracer,
} from "../../../api/src/platform/observability/core/tracing";
import type { JobTrace } from "./index";

export interface PublishTrace {
  /** Données du job BullMQ. */
  data: { event: DomainEvent; trace?: JobTrace };
  /** Termine le span (avec l'erreur éventuelle). */
  end(error?: unknown): void;
}

export function startPublishTrace(event: DomainEvent): PublishTrace {
  if (!isTracingEnabled()) return { data: { event }, end: () => undefined };
  const parent = contextFromTraceparent(event.traceparent, context.active());
  const span = tracer().startSpan(
    `outbox publish ${event.type}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: {
        "messaging.system": "bullmq",
        "messaging.destination.name": "domain-events",
        "messaging.message.id": event.id,
        "messaging.operation.type": "publish",
        "ed.event.type": event.type,
        ...identityAttributes({ tenantId: event.tenantId, requestId: event.requestId }),
      },
    },
    parent,
  );
  const traceparent = currentTraceparent(trace.setSpan(parent, span));
  return {
    data: { event, ...(traceparent ? { trace: { traceparent } } : {}) },
    end(error) {
      if (error !== undefined) recordSafeException(span, error);
      span.end();
    },
  };
}
