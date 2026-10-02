/**
 * Adaptateur du port d'audit de stateassign vers `audit.record` (module `audit`) — `runtime.auditPort`.
 *
 *   stateassign `AuditEntry`          ->   `audit.record(tx, entry)`
 *   action  `stateassign.assignment.verified`   action   inchangée
 *   resourceType / resourceId                    entity / entityId
 *   before / after / metadata / reason           idem (masquage et diff par `audit`)
 *   sensitive: true                              severity `notice` (sinon `info`)
 *   ctx (RequestContext)                         ignoré : tenant, acteur et requestId sont dérivés du contexte de la transaction
 *
 * Aucun nom d'élève, aucune pièce dans les métadonnées : identifiants, statuts, montants entiers, motifs de décision.
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/ports";

export function stateassignAuditAdapter(audit: Pick<RuntimeAuditPort, "record">): AuditPort {
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
