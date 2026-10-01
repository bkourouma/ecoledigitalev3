/**
 * Adaptateur du port d'audit de `payroll` vers `audit.record` (module `audit`, via `runtime.auditPort`).
 *
 *   payroll `AuditEntry`                ->   `audit.record(tx, entry)`
 *   action  `payroll.payslip.approved`        action   inchangée (déjà `entité.verbe`)
 *   resourceType (snake_case)                 entity
 *   resourceId                                entityId
 *   reason / before / after / metadata        reason / before / after / metadata (masquage + diff par `audit`)
 *   sensitive: true                           severity `notice` (sinon `info`)
 *   ctx (RequestContext)                      ignoré : tenant, acteur et requestId sont dérivés du contexte de la
 *                                             transaction (`TenantDb.run`), qui est le même.
 *
 * L'appel se fait dans la MÊME transaction que l'opération (l'échec de l'audit l'annule).
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/audit";

export function payrollAuditAdapter(audit: Pick<RuntimeAuditPort, "record">): AuditPort {
  return {
    async record(tx, _ctx, entry) {
      await audit.record(tx, {
        action: entry.action,
        entity: entry.resourceType,
        entityId: entry.resourceId,
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.before !== undefined ? { before: entry.before } : {}),
        ...(entry.after !== undefined ? { after: entry.after } : {}),
        ...(entry.metadata ? { metadata: { ...entry.metadata } } : {}),
        severity: entry.sensitive ? "notice" : "info",
      });
    },
  };
}
