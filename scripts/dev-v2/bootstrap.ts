/**
 * Étape « base » du mode développement v2 (`pnpm dev:v2:setup`) : applique les migrations v2 sur la base
 * `ecoledigitale_v2` du conteneur `ed-dev-pg`, puis crée/réaligne le rôle de CONNEXION applicatif (`ed_dev_app`,
 * membre de `app_user`, sans BYPASSRLS). Variables : DEVV2_MIGRATOR_URL, DEVV2_APP_ROLE, DEVV2_APP_ROLE_PASSWORD.
 * GARDE-FOU : refuse toute base autre que `ecoledigitale_v2`.
 */
import { consoleLogger } from "../../packages/kernel/src/index";
import { redactUrl, runV2Migrations } from "../../apps/api/src/platform/v2-migrations";

async function main(): Promise<void> {
  const url = process.env.DEVV2_MIGRATOR_URL;
  if (!url) throw new Error("DEVV2_MIGRATOR_URL sont requis.");
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (dbName !== "ecoledigitale_v2") throw new Error(`Garde-fou : la base « ${dbName} » n'est pas ecoledigitale_v2.`);

  const logger = { ...consoleLogger, info: () => undefined, debug: () => undefined };
  const report = await runV2Migrations({ url, logger, yes: true });
  let applied = 0;
  let already = 0;
  for (const { result } of report.steps) {
    applied += result.applied.length;
    already += result.alreadyApplied.length;
  }
  console.log(`[dev-v2] base ${report.database} (${redactUrl(url)}) : ${applied} migration(s) appliquée(s), ${already} déjà présente(s).`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[dev-v2] ÉCHEC :", e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
