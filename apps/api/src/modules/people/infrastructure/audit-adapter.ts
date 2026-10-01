/**
 * Adaptateur du port d'audit de `people` vers `audit.record` (`runtime.auditPort`).
 *
 * Mapping (documenté dans le README du module) :
 *
 *   people `AuditEntry`                  ->   `audit.record(tx, entry)`
 *   action  `people.student.created`          action   inchangée (déjà `entité.verbe`)
 *   entity / entityId                         entity / entityId
 *   severity `notice`                         toute lecture / modification de donnée personnelle sensible
 *   reason, metadata, before, after           idem (masquage + diff par le module audit)
 *
 * L'acteur, le tenant et la requête sont dérivés du contexte de la transaction (`TenantDb.run`) ; l'appel se fait dans la
 * MÊME transaction que l'opération : l'échec de l'audit annule l'opération. Aucune donnée personnelle ne transite ici :
 * les cas d'usage n'y mettent que des identifiants, des statuts et des NOMS de champs.
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/ports";

export function peopleAuditAdapter(audit: Pick<RuntimeAuditPort, "record">): AuditPort {
  return {
    async record(tx, entry) {
      await audit.record(tx, {
        action: entry.action,
        entity: entry.entity,
        ...(entry.entityId !== undefined ? { entityId: entry.entityId } : {}),
        ...(entry.before !== undefined ? { before: entry.before } : {}),
        ...(entry.after !== undefined ? { after: entry.after } : {}),
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
        ...(entry.metadata ? { metadata: { ...entry.metadata } } : {}),
        severity: entry.severity ?? "info",
      });
    },
  };
}
