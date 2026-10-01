#!/usr/bin/env node
/**
 * CLI de migration.
 *
 *   pnpm --filter @ecoledigitale/database migrate -- --dir packages/database/migrations --url "$DATABASE_URL"
 *
 * Options :
 *   --dir <dossier>        dossier de migrations (répétable ; numéros globaux). Défaut : ./migrations
 *   --url <url>            chaîne de connexion. Défaut : variable d'environnement DATABASE_URL
 *   --yes                  confirme la migration d'une base dont le nom ne finit pas par _test/_dev/_local
 *   --dry-run              liste les migrations en attente sans rien écrire
 *   --role <rôle>          rôle d'exécution des fichiers (SET ROLE). Défaut : migrator
 *   --no-role              exécute sous le rôle de connexion
 *   --allow-out-of-order   accepte une migration numérotée avant l'historique
 *   --lock-timeout <ms>    attente maximale du verrou (défaut 60000)
 *   --table <nom>          table de suivi (défaut schema_migrations)
 *
 * Le mot de passe de l'URL n'est jamais affiché.
 */
import { parseArgs } from "node:util";
import { Client } from "pg";
import { consoleLogger } from "@ecoledigitale/kernel";
import { MigrationError } from "./migrations/errors";
import { migrate } from "./migrations/runner";

export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "<url illisible>";
  }
}

const USAGE = `Usage : migrate [--dir <d>]... [--url <url>] [--yes] [--dry-run] [--role <r> | --no-role]
               [--allow-out-of-order] [--lock-timeout <ms>] [--table <nom>]
L'URL par défaut vient de DATABASE_URL.`;

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  // pnpm transmet le « -- » séparateur au script : on l'ignore.
  const args = argv[0] === "--" ? argv.slice(1) : argv;

  let values: ReturnType<typeof parse>["values"];
  try {
    values = parse(args).values;
  } catch (e) {
    console.error(`Erreur d'arguments : ${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const url = values.url ?? env.DATABASE_URL;
  if (!url) {
    console.error(`Aucune URL : passez --url ou définissez DATABASE_URL.\n${USAGE}`);
    return 2;
  }
  const dirs = values.dir && values.dir.length > 0 ? values.dir : ["migrations"];
  const lockTimeoutMs = values["lock-timeout"] === undefined ? undefined : Number(values["lock-timeout"]);
  if (lockTimeoutMs !== undefined && (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0)) {
    console.error("--lock-timeout doit être un nombre de millisecondes ≥ 0.");
    return 2;
  }

  const client = new Client({ connectionString: url, application_name: "ecoledigitale-migrate" });
  try {
    await client.connect();
    const result = await migrate({
      client,
      dirs,
      yes: values.yes === true,
      dryRun: values["dry-run"] === true,
      allowOutOfOrder: values["allow-out-of-order"] === true,
      ...(values["no-role"] ? {} : { role: values.role ?? "migrator" }),
      ...(values.table ? { table: values.table } : {}),
      ...(lockTimeoutMs !== undefined ? { lockTimeoutMs } : {}),
      logger: consoleLogger,
    });
    const verb = values["dry-run"] ? "en attente" : "appliquée(s)";
    const list = values["dry-run"] ? result.pending : result.applied;
    console.log(
      `Base ${result.database} (${redactUrl(url)}) : ${list.length} migration(s) ${verb}, ` +
        `${result.alreadyApplied.length} déjà appliquée(s).`,
    );
    for (const f of list) console.log(`  - ${f}`);
    return 0;
  } catch (e) {
    if (e instanceof MigrationError) {
      console.error(`[${e.code}] ${e.message}`);
    } else {
      console.error(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
    }
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function parse(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: false,
    options: {
      dir: { type: "string", multiple: true },
      url: { type: "string" },
      yes: { type: "boolean" },
      "dry-run": { type: "boolean" },
      role: { type: "string" },
      "no-role": { type: "boolean" },
      "allow-out-of-order": { type: "boolean" },
      "lock-timeout": { type: "string" },
      table: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}

// Exécution directe (`tsx src/cli.ts`) mais pas lors d'un import (tests).
const invokedDirectly = (() => {
  const entry = process.argv[1]?.replace(/\\/g, "/") ?? "";
  return /\/cli\.(ts|js|mjs|cjs)$/.test(entry);
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
