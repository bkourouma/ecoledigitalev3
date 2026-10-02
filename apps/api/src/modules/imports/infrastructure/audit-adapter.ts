/**
 * Adaptateur du port d'audit de `imports` vers `audit.record` (`runtime.auditPort`).
 *
 * Actions : `imports.job.create|map|validate|validated|delete`, `imports.run.request|completed|failed|cancelled|cancel_requested`,
 * `imports.template.create|update|delete`, `imports.settings.update`. Tenant, acteur et requête sont dérivés du contexte
 * de la transaction ; l'appel se fait dans la MÊME transaction que l'opération. Aucune ligne du fichier ne transite ici :
 * identifiants, décomptes, noms de colonnes et empreinte du fichier seulement.
 */
import type { RuntimeAuditPort } from "../../../platform/runtime";
import type { AuditPort } from "../application/ports";

export function importsAuditAdapter(audit: Pick<RuntimeAuditPort, "record">): AuditPort {
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
