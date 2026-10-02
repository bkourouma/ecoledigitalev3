/**
 * Adaptateur du port d'audit de schoollife vers `audit.record` (module `audit`) — `runtime.auditPort`.
 *
 *   schoollife `AuditEntry`            ->   `audit.record(tx, entry)`
 *   action  `schoollife.measure.validated`        action   inchangée (déjà `entité.verbe`)
 *   resourceType `measure` (snake_case)           entity   `measure`
 *   resourceId                                    entityId
 *   before / after / metadata / reason            idem (masquage et diff par `audit`)
 *   sensitive: true                               severity `notice` (sinon `info`)
 *   ctx (RequestContext)                          ignoré : tenant, acteur et requestId sont dérivés du contexte de la transaction
 *
 * L'appel se fait dans la MÊME transaction que l'opération (l'échec de l'audit annule l'opération). Jamais le contenu d'un
 * élément (description, motif, déclaration) : des identifiants, des codes et des familles.
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/ports";

export function schoollifeAuditAdapter(audit: Pick<RuntimeAuditPort, "record">): AuditPort {
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
