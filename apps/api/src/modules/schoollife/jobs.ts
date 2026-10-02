/**
 * Jobs planifiés du module "schoollife" pour apps/worker (découverts automatiquement : modules/<key>/jobs.ts).
 * Aucun job par défaut : le tableau vide est valide. Fuseau des expressions cron : WORKER_TZ.
 *
 * En production le worker EMBARQUE les modules dans son bundle : reconstruisez-le après modification
 * (pnpm --filter @ecoledigitale/worker build).
 *
 * Règles : nom stable et unique, traitement idempotent (le planificateur peut rejouer), perTenant: true pour
 * exécuter le handler une fois par tenant actif (ctx.db est alors lié au tenant), sinon ctx.systemDb explicite.
 */

// import { defineScheduledJob } from "@ecoledigitale/worker/sdk";
//
// export default [
//   defineScheduledJob({
//     name: "schoollife.nightly-cleanup",
//     cron: "20 2 * * *", // 5 champs, ou 6 avec les secondes
//     perTenant: true,
//     handler: async ({ tenant, db, logger }) => {
//       await db.run(async (tx) => {
//         await tx.query("SELECT 1");
//       });
//       logger.info({ tenant: tenant.id }, "schoollife : nettoyage terminé");
//     },
//   }),
// ];

export default [];
