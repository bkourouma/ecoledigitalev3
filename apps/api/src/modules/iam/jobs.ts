/**
 * Jobs planifiés du module `iam` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `iam.purge-expired-data`  quotidien : supprime les sessions expirées/révoquées et les challenges MFA
 *    périmés depuis plus de `IAM_PURGE_RETENTION_DAYS` jours (défaut 30), tenant par tenant (un échec n'arrête
 *    pas les autres ; le job est alors signalé en échec).
 *
 * Le job n'a besoin d'aucun secret d'IAM (ni `IAM_JWT_SECRET`, ni la clé MFA) : il n'utilise que l'horloge et
 * `SystemDb`, d'où l'appel direct du use case plutôt que la construction d'un `IamService`.
 */
import { systemClock } from "@ecoledigitale/kernel";
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { purgeExpiredData } from "./application/sessions";

const retentionDays = (): number => {
  const n = Number.parseInt(process.env.IAM_PURGE_RETENTION_DAYS ?? "", 10);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : 30;
};

export default [
  defineScheduledJob({
    name: "iam.purge-expired-data",
    cron: "40 3 * * *",
    lockTtlMs: 15 * 60_000,
    handler: async ({ systemDb, logger }) => {
      const days = retentionDays();
      const report = await purgeExpiredData({ clock: systemClock, systemDb }, days);
      logger.info({ ...report, retentionDays: days }, "iam : sessions et challenges périmés purgés");
      // Un tenant en échec ne doit pas passer inaperçu : le job est signalé en échec (les autres ont été purgés).
      if (report.failed > 0) throw new Error(`iam.purge-expired-data : ${report.failed} tenant(s) en échec.`);
    },
  }),
];
