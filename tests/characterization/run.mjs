#!/usr/bin/env node
/**
 * pnpm test:characterization [-- -u] [arguments vitest...]
 *
 * Rejoue les tests de caractérisation du code LEGACY (tranche 2.0 du plan) et échoue en cas de dérive.
 *
 *  - TEST_DATABASE_URL défini (CI : service postgres) : l'instance visée doit être JETABLE (le harnais crée et supprime
 *    ses propres bases `char_*` et n'écrit nulle part ailleurs) ;
 *  - sinon : un Postgres éphémère est lancé dans Docker par packages/database/scripts/with-postgres.mjs (conteneur nommé
 *    `ed-pg-it-*`, port hôte libre, supprimé à la fin ; ED_PG_IMAGE pour choisir l'image, défaut postgres:17-alpine).
 *
 *  - `-u` / `--update` : RÉGÉNÈRE explicitement les snapshots (tests/characterization/snapshots/*.snapshot.json).
 *    Jamais automatique : sans `-u`, une snapshot absente ou différente fait échouer le test.
 *
 * Exemples :
 *   pnpm test:characterization
 *   pnpm test:characterization -- -u
 *   pnpm test:characterization -- tests/classique-terminale.test.ts
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = process.argv.slice(2).filter((a) => a !== "--");
const update = raw.includes("-u") || raw.includes("--update");
const passthrough = raw.filter((a) => a !== "-u" && a !== "--update");
const vitestArgs = ["--root", "tests/characterization", ...passthrough];
const isWin = process.platform === "win32";

const env = { ...process.env, CHARACTERIZATION_UPDATE: update ? "1" : "0" };
if (!env.ED_PG_IMAGE) env.ED_PG_IMAGE = "postgres:17-alpine";
if (update) console.log("[characterization] mode -u : les snapshots seront RÉÉCRITES (relisez le diff avant de committer)");

const [command, args, options] = process.env.TEST_DATABASE_URL
  ? [isWin ? "pnpm.cmd" : "pnpm", ["exec", "vitest", "run", ...vitestArgs], { shell: isWin }]
  : [process.execPath, [resolve(root, "packages/database/scripts/with-postgres.mjs"), ...vitestArgs], {}];

const child = spawn(command, args, { cwd: root, stdio: "inherit", env, ...options });
child.on("exit", (code) => process.exit(code ?? 1));
