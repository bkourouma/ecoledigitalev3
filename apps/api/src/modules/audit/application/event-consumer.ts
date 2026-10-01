/**
 * Consommateur d'événements : applique un handler pur puis écrit dans le journal.
 *
 * Utilisation par le futur registre d'abonnés du worker :
 *
 *   for (const s of AUDIT_EVENT_SUBSCRIPTIONS) registry.subscribe(s.pattern, (e) => consumeAuditEvent(deps, e));
 *
 * Idempotent (livraison « au moins une fois », ADR-004) : l'entrée reprend l'id et l'instant
 * de l'événement, la clé primaire du journal écarte le doublon.
 *
 * Événement SANS tenant exploitable (échec de connexion d'un compte inconnu, etc.) : écrit
 * dans le journal de PLATEFORME via `SystemDb.run`. Avec tenant : `SystemDb.runForTenant`
 * (la RLS borne l'écriture à ce tenant).
 */
import type { DomainEvent } from "@ecoledigitale/kernel";
import type { SystemDb } from "@ecoledigitale/database";
import { resolveAuditHandler } from "../domain/events";
import type { RecordResult } from "../domain/types";
import type { AuditService } from "./audit-service";

export interface AuditEventConsumerDeps {
  systemDb: SystemDb;
  audit: AuditService;
}

export type ConsumeOutcome =
  | { status: "ignored"; reason: "no_handler" | "not_auditable" }
  | { status: "recorded" | "duplicate"; scope: "tenant" | "platform"; result: RecordResult };

export async function consumeAuditEvent(deps: AuditEventConsumerDeps, event: DomainEvent): Promise<ConsumeOutcome> {
  const handler = resolveAuditHandler(event.type);
  if (!handler) return { status: "ignored", reason: "no_handler" };

  const entry = handler(event);
  if (!entry) return { status: "ignored", reason: "not_auditable" };

  const { tenantId, ...input } = entry;
  if (tenantId === null) {
    const result = await deps.systemDb.run("audit-platform-event", (tx) => deps.audit.recordPlatform(tx, input));
    return { status: result.duplicate ? "duplicate" : "recorded", scope: "platform", result };
  }
  const result = await deps.systemDb.runForTenant("audit-tenant-event", tenantId, (tx) =>
    deps.audit.record(tx, { ...input, tenantId }),
  );
  return { status: result.duplicate ? "duplicate" : "recorded", scope: "tenant", result };
}
