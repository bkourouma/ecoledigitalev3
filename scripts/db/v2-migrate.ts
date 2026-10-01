#!/usr/bin/env tsx
/**
 * pnpm db:v2:migrate
 *
 * Applique les migrations v2 : `packages/database/migrations` (baseline) puis
 * `apps/api/src/modules/<key>/migrations` dans l'ordre topologique des manifestes.
 *
 *   pnpm db:v2:migrate [-- --url <url>] [--yes] [--dry-run]
 *
 * Connexion : `--url`, sinon V2_MIGRATOR_URL (rôle propriétaire/migrator ; JAMAIS
 * V2_DATABASE_URL, qui est le rôle applicatif sans droit de DDL). Le mot de passe n'est
 * jamais affiché. Garde-fou du runner conservé : une base dont le nom ne finit pas par
 * `_dev`, `_test` ou `_local` exige `--yes`.
 */
import "./load-env";
import { parseArgs } from "node:util";
import { MigrationError, redactUrl, runV2Migrations } from "../../apps/api/src/platform/v2-migrations";

const USAGE = `Usage : pnpm db:v2:migrate [-- --url <url>] [--yes] [--dry-run] [--allow-out-of-order] [--lock-timeout <ms>]
URL par défaut : V2_MIGRATOR_URL (rôle propriétaire). Base hors _dev/_test/_local : --yes obligatoire.`;

async function main(): Promise<number> {
  const args = process.argv.slice(2)[0] === "--" ? process.argv.slice(3) : process.argv.slice(2);
  let values;
  try {
    values = parseArgs({
      args,
      allowPositionals: false,
      options: {
        url: { type: "string" },
        yes: { type: "boolean" },
        "dry-run": { type: "boolean" },
        "allow-out-of-order": { type: "boolean" },
        "lock-timeout": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (e) {
    console.error(`Erreur d'arguments : ${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const url = values.url ?? process.env.V2_MIGRATOR_URL?.trim();
  if (!url) {
    console.error(`Aucune URL : définissez V2_MIGRATOR_URL (voir .env.example) ou passez --url.\n${USAGE}`);
    return 2;
  }
  const lockTimeout = values["lock-timeout"] === undefined ? undefined : Number(values["lock-timeout"]);
  if (lockTimeout !== undefined && (!Number.isFinite(lockTimeout) || lockTimeout < 0)) {
    console.error("--lock-timeout doit être un nombre de millisecondes >= 0.");
    return 2;
  }

  try {
    const report = await runV2Migrations({
      url,
      yes: values.yes === true,
      dryRun: values["dry-run"] === true,
      allowOutOfOrder: values["allow-out-of-order"] === true,
      ...(lockTimeout !== undefined ? { lockTimeoutMs: lockTimeout } : {}),
    });
    const verb = values["dry-run"] ? "en attente" : "appliquée(s)";
    console.log(`Base ${report.database} (${redactUrl(url)})`);
    for (const { step, result } of report.steps) {
      const list = values["dry-run"] ? result.pending : result.applied;
      console.log(`  [${step.id}] ${list.length} migration(s) ${verb}, ${result.alreadyApplied.length} déjà appliquée(s).`);
      for (const f of list) console.log(`      - ${f}`);
    }
    return 0;
  } catch (e) {
    if (e instanceof MigrationError) console.error(`[${e.code}] ${e.message}`);
    else console.error(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
