/**
 * Jobs planifiés du module `scheduling` pour `apps/worker` (`modules/<key>/jobs.ts`, découverts automatiquement).
 *
 *  - `scheduling.generate-occurrences`  quotidien (02:30, `WORKER_TZ`), PAR TENANT : génération GLISSANTE —
 *    prolonge chaque emploi du temps publié jusqu'à `generation_horizon_weeks` (paramètre de l'établissement)
 *    après aujourd'hui. Idempotent : le rejouer ne crée rien. La génération à la demande est
 *    `POST /timetables/:id/generate`.
 *
 * Le job « signalement des séances non constatées » du plan (§4) n'est pas un job : `listUnrealizedOccurrences`
 * (lecture) alimente directement l'écran de rapprochement, sans état à matérialiser.
 */
import { createSystemContext } from "@ecoledigitale/kernel";
import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
import { createSchedulingDeps } from "./application/deps";
import { generateRolling } from "./application/generation";
import { registryPorts } from "./ports-registry";

export default [
  defineScheduledJob({
    name: "scheduling.generate-occurrences",
    cron: "30 2 * * *",
    lockTtlMs: 30 * 60_000,
    perTenant: true,
    handler: async ({ tenant, tenantDb, logger }) => {
      const deps = createSchedulingDeps({ db: tenantDb, ports: registryPorts, logger });
      const result = await generateRolling(deps, createSystemContext(tenant.id));
      if (!result.ok) throw result.error;
      const { timetables, created, failed } = result.value;
      logger.info({ tenant: tenant.slug, timetables, created, failed: failed.length }, "scheduling : génération glissante terminée");
      if (failed.length > 0) {
        throw new Error(`scheduling.generate-occurrences : ${failed.length} emploi(s) du temps en échec (${failed.map((f) => `${f.timetableId} : ${f.message}`).join(" ; ")}).`);
      }
    },
  }),
];
