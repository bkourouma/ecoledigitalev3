/**
 * Adaptateur du port d'audit de `finance` vers `audit.record` (module `audit`).
 *
 * Mapping (documenté dans le README du module) :
 *
 *   finance `AuditEntry`            ->   `audit.record(tx, entry)`
 *   action  `finance.refund.approved`     action   inchangée (déjà `entité.verbe`)
 *   resourceType `refund` (snake_case)    entity   `refund`
 *   resourceId                            entityId
 *   before / after / metadata             before / after / metadata (masquage + diff par `audit`)
 *   sensitive: true                       severity `notice` (sinon `info`)
 *   ctx (RequestContext)                  ignoré : tenant, acteur et requestId sont dérivés du contexte de la
 *                                         transaction (`TenantDb.run`), qui est le même ; ip/user-agent viennent
 *                                         de la portée HTTP.
 *
 * L'appel se fait dans la MÊME transaction que l'opération (l'échec de l'audit annule l'opération).
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/ports/audit";

export function financeAuditAdapter(audit: Pick<RuntimeAuditPort, "record">): AuditPort {
  return {
    async record(tx, _ctx, entry) {
      await audit.record(tx, {
        action: entry.action,
        entity: entry.resourceType,
        entityId: entry.resourceId,
        ...(entry.before !== undefined ? { before: entry.before } : {}),
        ...(entry.after !== undefined ? { after: entry.after } : {}),
        ...(entry.metadata ? { metadata: { ...entry.metadata } } : {}),
        severity: entry.sensitive ? "notice" : "info",
      });
    },
  };
}
