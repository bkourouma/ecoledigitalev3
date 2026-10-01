#!/usr/bin/env node
/**
 * Exécute un fichier SQL avec `psql`, en lisant la connexion dans DATABASE_URL.
 *
 *   node scripts/run-psql.mjs <fichier.sql> [autres arguments psql…]
 *
 * Remplace les anciens scripts du package.json racine qui contenaient l'URL
 * Postgres (mot de passe compris) en clair. Fonctionne à l'identique sous
 * Windows, macOS et Linux : pas de substitution `$DATABASE_URL` par le shell.
 *
 * DATABASE_URL est lu dans l'environnement ; à défaut dans `.env` (racine) puis
 * `apps/api/.env` (sans écraser une variable déjà définie).
 */
import { spawnSync } from "node:child_process";
import { loadEnvFiles } from "./lib/load-env.mjs";

loadEnvFiles();

const [file, ...extraArgs] = process.argv.slice(2);
if (!file) {
  console.error("Usage : node scripts/run-psql.mjs <fichier.sql> [arguments psql]");
  process.exit(2);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(
    "DATABASE_URL n'est pas défini. Le renseigner dans l'environnement ou dans .env / apps/api/.env " +
      "(voir .env.example)."
  );
  process.exit(1);
}

const result = spawnSync("psql", [databaseUrl, "-f", file, ...extraArgs], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`Impossible de lancer psql : ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
