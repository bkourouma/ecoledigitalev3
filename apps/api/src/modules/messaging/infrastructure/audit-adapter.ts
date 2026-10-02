/**
 * Adaptateur du port d'audit de messaging vers `audit.record` (module `audit`) — `runtime.auditPort`.
 *
 *   messaging `AuditEntry`            ->   `audit.record(tx, entry)`
 *   action  `messaging.report.decided`          action   inchangée
 *   resourceType / resourceId                    entity / entityId
 *   before / after / metadata / reason           idem (masquage et diff par `audit`)
 *   sensitive: true                              severity `notice` (sinon `info`)
 *   ctx (RequestContext)                         ignoré : tenant, acteur et requestId sont dérivés du contexte de la
 *                                                transaction (`TenantDb.run`) ; ip / user-agent viennent de la portée HTTP.
 *
 * Jamais de contenu de message dans les métadonnées : identifiants, comptages, motifs de décision.
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/ports";

export function messagingAuditAdapter(audit: Pick<RuntimeAuditPort, "record">): AuditPort {
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
