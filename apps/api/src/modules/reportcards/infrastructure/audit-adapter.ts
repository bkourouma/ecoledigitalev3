/**
 * Adaptateur du port d'audit de reportcards vers `audit.record` / `audit.recordPlatform` (module `audit`) —
 * `runtime.auditPort`.
 *
 *   reportcards `AuditEntry`              ->   `audit.record(tx, entry)`
 *   action  `reportcards.report_card.revoked`    action   inchangée (déjà `entité.verbe`)
 *   resourceType `report_card` (snake_case)      entity   `report_card`
 *   resourceId                                   entityId
 *   before / after / metadata / reason           idem (masquage et diff par `audit`)
 *   sensitive: true                              severity `notice` (sinon `info`)
 *   ctx (RequestContext)                         ignoré : tenant, acteur et requestId sont dérivés du contexte de la
 *                                                transaction (`TenantDb.run`) ; ip / user-agent viennent de la portée HTTP.
 *
 * L'appel se fait dans la MÊME transaction que l'opération (l'échec de l'audit annule l'opération). Les opérations de
 * plateforme (gabarits globaux, clés) vont au journal de plateforme (`recordPlatform`, acteur `superAdmin`).
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/ports";

export function reportcardsAuditAdapter(audit: Pick<RuntimeAuditPort, "record" | "recordPlatform">): AuditPort {
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
    async recordPlatform(tx, entry) {
      await audit.recordPlatform(tx, {
        action: entry.action,
        entity: entry.resourceType,
        entityId: entry.resourceId,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.metadata ? { metadata: { ...entry.metadata } } : {}),
        severity: entry.sensitive ? "notice" : "info",
        actor: { type: "superAdmin", id: entry.actorId },
      });
    },
  };
}
