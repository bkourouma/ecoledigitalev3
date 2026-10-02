/**
 * Adaptateur du port d'audit de councils vers `audit.record` (module `audit`) — `runtime.auditPort`.
 *
 *   councils `AuditEntry`              ->   `audit.record(tx, entry)`
 *   action  `councils.council.opened`          action   inchangée (déjà `entité.verbe`)
 *   resourceType `council` (snake_case)        entity   `council`
 *   resourceId                                 entityId
 *   before / after / metadata / reason         idem (masquage et diff par `audit`)
 *   sensitive: true                            severity `notice` (sinon `info`)
 *   ctx (RequestContext)                       ignoré : tenant, acteur et requestId sont dérivés du contexte de la transaction
 *
 * L'appel se fait dans la MÊME transaction que l'opération (l'échec de l'audit annule l'opération). Jamais le contenu d'une
 * appréciation ou d'une justification : des identifiants, des codes et des longueurs.
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/ports";

export function councilsAuditAdapter(audit: Pick<RuntimeAuditPort, "record">): AuditPort {
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
