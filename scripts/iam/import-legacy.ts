#!/usr/bin/env tsx
/**
 * pnpm iam:import-legacy [-- --dry-run] [--tenant <slug>] [--report <fichier.json>]
 *
 * Importe les utilisateurs du legacy dans iam + rbac. Voir apps/api/src/platform/legacy-import.ts (principes) et
 * `--help`. Lecture seule côté legacy ; idempotent ; aucune invitation envoyée.
 */
import "../db/load-env";
import { runImportCli } from "../../apps/api/src/platform/legacy-import-runtime";

const argv = process.argv.slice(2)[0] === "--" ? process.argv.slice(3) : process.argv.slice(2);
runImportCli(argv, process.env).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
