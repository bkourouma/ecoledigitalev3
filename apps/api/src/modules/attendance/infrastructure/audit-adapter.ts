/**
 * Adaptateur du port d'audit d'attendance vers `audit.record` (module `audit`) — `runtime.auditPort`.
 *
 * Mapping (documenté dans le README du module) :
 *
 *   attendance `AuditEntry`            ->   `audit.record(tx, entry)`
 *   action  `attendance.justification.accepted`   action   inchangée (déjà `entité.verbe`)
 *   resourceType `justification` (snake_case)     entity   `justification`
 *   resourceId                                    entityId
 *   before / after / metadata / reason            idem (masquage et diff par `audit`)
 *   sensitive: true                               severity `notice` (sinon `info`)
 *   ctx (RequestContext)                          ignoré : tenant, acteur et requestId sont dérivés du contexte de la
 *                                                 transaction (`TenantDb.run`) ; ip / user-agent viennent de la portée HTTP.
 *
 * L'appel se fait dans la MÊME transaction que l'opération (l'échec de l'audit annule l'opération).
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/ports";

export function attendanceAuditAdapter(audit: Pick<RuntimeAuditPort, "record">): AuditPort {
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
