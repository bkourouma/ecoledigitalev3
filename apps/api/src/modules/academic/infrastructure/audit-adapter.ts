/**
 * Adaptateur du port d'audit d'`academic` vers `audit.record` (module `audit`), via `runtime.auditPort`.
 *
 * Mapping (documenté dans le README du module) :
 *
 *   academic `AuditEntry`          ->   `audit.record(tx, entry)`
 *   action `academic.period.reopened`    action   inchangée (déjà `entité.verbe`)
 *   resourceType (snake_case)            entity
 *   resourceId                           entityId
 *   before / after / metadata / reason   inchangés (masquage + diff par `audit`)
 *   sensitive: true                      severity `notice` (sinon `info`)
 *   ctx (RequestContext)                 ignoré : tenant, acteur et requête sont dérivés du contexte de la transaction
 *
 * L'appel se fait dans la MÊME transaction que l'opération (l'échec de l'audit annule l'opération).
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/ports";

export function academicAuditAdapter(audit: Pick<RuntimeAuditPort, "record">): AuditPort {
  return {
    async record(tx, _ctx, entry) {
      await audit.record(tx, {
        action: entry.action,
        entity: entry.resourceType,
        entityId: entry.resourceId,
        ...(entry.before !== undefined ? { before: entry.before } : {}),
        ...(entry.after !== undefined ? { after: entry.after } : {}),
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.metadata ? { metadata: { ...entry.metadata } } : {}),
        severity: entry.sensitive ? "notice" : "info",
      });
    },
  };
}
