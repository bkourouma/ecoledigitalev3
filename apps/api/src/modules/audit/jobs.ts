/**
 * Jobs planifiés du module `audit` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `audit.ensure-partitions`         quotidien : crée les partitions mensuelles à l'avance (idempotent) ;
 *  - `audit.detach-expired-partitions` mensuel : détache les partitions échues vers `audit_archive`.
 *    TOUJOURS en simulation d'abord (rapport journalisé) ; le détachement réel n'a lieu que si
 *    `AUDIT_DETACH_MODE=apply` (opt-in explicite : c'est une opération d'exploitation irréversible côté
 *    application, le DROP définitif restant manuel après export vérifié — voir README).
 *
 * Le job du socle `ensure-partitions` (apps/worker, 02:05) appelle la même fonction SQL : les deux sont
 * idempotents, celui-ci appartient au module et ne dépend pas de `AUDIT_ENSURE_PARTITIONS_FN`.
 */
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { ensureAuditPartitions } from "./application/partitions";
import { detachExpiredAuditPartitions } from "./application/retention";
import { configureAuditFromEnv } from "./config";
import { audit } from "./service";

const monthsAhead = (): number => {
  const n = Number.parseInt(process.env.AUDIT_PARTITIONS_MONTHS_AHEAD ?? "", 10);
  return Number.isInteger(n) && n >= 1 && n <= 36 ? n : 3;
};

let configured = false;
function ensureConfigured(logger: { warn(o: object, m: string): void; info(o: object, m: string): void }): void {
  if (configured) return;
  configureAuditFromEnv(audit, process.env, { logger });
  configured = true;
}

export default [
  defineScheduledJob({
    name: "audit.ensure-partitions",
    cron: "10 2 * * *",
    handler: async ({ systemDb, logger }) => {
      const created = await ensureAuditPartitions(systemDb, monthsAhead());
      logger.info({ created, monthsAhead: monthsAhead() }, created.length > 0 ? "audit : partitions créées" : "audit : partitions déjà à jour");
    },
  }),
  defineScheduledJob({
    name: "audit.detach-expired-partitions",
    cron: "30 3 1 * *",
    lockTtlMs: 30 * 60_000,
    handler: async ({ systemDb, logger }) => {
      ensureConfigured(logger);
      const simulation = await detachExpiredAuditPartitions(systemDb, audit, { dryRun: true });
      logger.info(
        { retentionMonths: simulation.retentionMonths, candidates: simulation.partitions.map((p) => p.name) },
        "audit : partitions échues (simulation)",
      );
      if (process.env.AUDIT_DETACH_MODE === "apply" && simulation.partitions.length > 0) {
        const applied = await detachExpiredAuditPartitions(systemDb, audit, { dryRun: false });
        logger.warn(
          { detached: applied.partitions.filter((p) => p.detached).map((p) => p.name) },
          "audit : partitions échues détachées vers audit_archive",
        );
      }
    },
  }),
];
