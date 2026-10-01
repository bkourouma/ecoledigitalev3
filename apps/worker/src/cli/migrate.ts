#!/usr/bin/env node
/**
 * Applique les migrations du worker (`apps/worker/migrations`, plage 0600-0699) avec le runner de
 * @ecoledigitale/database (checksum, verrou, une transaction par fichier, SET ROLE migrator).
 *
 *   pnpm --filter @ecoledigitale/worker migrate -- --url "$MIGRATOR_DATABASE_URL"
 *
 * Les versions sont GLOBALES (table `schema_migrations` partagée, cf. module-conventions.md) : le runner
 * refuse un historique dont des fichiers manquent. Ce raccourci de développement applique donc la
 * baseline (`packages/database/migrations`) + les migrations du worker. Dès que d'autres modules sont
 * déjà migrés, utilisez le runner de la plateforme avec TOUS les dossiers, dont `--dir apps/worker/migrations`
 * (ou passez ici vos propres `--dir`, qui remplacent les défauts).
 *
 * L'URL doit désigner un rôle capable de `SET ROLE migrator` (rôle de déploiement),
 * JAMAIS le rôle du worker. Options : celles du runner (--yes, --dry-run, ...).
 */
import { resolve } from "node:path";
import { main } from "@ecoledigitale/database/src/cli";

const argv = process.argv.slice(2);
const args = argv[0] === "--" ? argv.slice(1) : argv;
const workerMigrations = resolve(__dirname, "..", "..", "migrations");
const baselineMigrations = resolve(__dirname, "..", "..", "..", "..", "packages", "database", "migrations");

const env = { ...process.env };
// Priorité : --url explicite, puis MIGRATOR_DATABASE_URL ; jamais WORKER_DATABASE_URL.
if (!args.includes("--url") && env.MIGRATOR_DATABASE_URL) env.DATABASE_URL = env.MIGRATOR_DATABASE_URL;

const dirs = args.includes("--dir") ? [] : ["--dir", baselineMigrations, "--dir", workerMigrations];

main([...dirs, ...args], env).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
