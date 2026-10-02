/**
 * Étape « base » de la démonstration : applique TOUTES les migrations v2 (baseline, worker, modules : même runner que
 * `pnpm db:v2:migrate`) avec le rôle propriétaire du conteneur de démonstration, puis crée/réaligne le rôle de CONNEXION
 * applicatif (`ed_demo_app`, membre de `app_user`, NOSUPERUSER NOBYPASSRLS) avec le mot de passe généré à l'exécution.
 *
 * Variables : DEMO_MIGRATOR_URL, DEMO_APP_ROLE, DEMO_APP_ROLE_PASSWORD (posées par `scripts/demo/cli.mjs`).
 * GARDE-FOU : refuse toute base dont le nom ne finit pas par `_local` (la base de démonstration est `ed_demo_local`).
 */
import { consoleLogger } from "../../packages/kernel/src/index";
import { createLoginRole } from "../../apps/api/src/platform/v2-login-role";
import { redactUrl, runV2Migrations } from "../../apps/api/src/platform/v2-migrations";

async function main(): Promise<void> {
  const url = process.env.DEMO_MIGRATOR_URL;
  const role = process.env.DEMO_APP_ROLE;
  const password = process.env.DEMO_APP_ROLE_PASSWORD;
  if (!url || !role || !password) throw new Error("DEMO_MIGRATOR_URL, DEMO_APP_ROLE et DEMO_APP_ROLE_PASSWORD sont requis.");
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (dbName !== "ed_demo_local") throw new Error(`Garde-fou : la base « ${dbName} » n'est pas la base de démonstration (ed_demo_local).`);

  const logger = { ...consoleLogger, info: () => undefined, debug: () => undefined };
  const report = await runV2Migrations({ url, logger });
  let applied = 0;
  let already = 0;
  for (const { result } of report.steps) {
    applied += result.applied.length;
    already += result.alreadyApplied.length;
  }
  console.log(`[migrate] base ${report.database} (${redactUrl(url)}) : ${applied} migration(s) appliquée(s), ${already} déjà présente(s), ${report.steps.length} dossiers.`);

  await createLoginRole({ adminUrl: url, role, rotate: true, generateSecret: () => password });
  console.log(`[migrate] rôle applicatif « ${role} » prêt (membre de app_user, sans BYPASSRLS).`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[migrate] ÉCHEC :", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
