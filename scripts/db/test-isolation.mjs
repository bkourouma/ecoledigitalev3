#!/usr/bin/env node
/**
 * pnpm test:isolation
 *
 * Test d'isolation multi-tenant GLOBAL (blocage CI) : base éphémère, baseline + migrations de
 * tous les modules, `checkTenantIsolation` sur `kernel` et chaque schéma de module, liste
 * blanche centralisée (apps/api/src/modules/isolation-allowlist*.ts). Passe trivialement
 * quand aucun module n'existe encore.
 *
 *  - TEST_DATABASE_URL défini (CI : service postgres) : l'instance visée doit être JETABLE
 *    (le test crée et supprime sa propre base et son propre rôle de connexion) ;
 *  - sinon : un Postgres éphémère est lancé dans Docker (packages/database/scripts/with-postgres.mjs ;
 *    ED_PG_IMAGE pour choisir l'image, ex. postgres:17-alpine).
 *
 * Arguments supplémentaires transmis à vitest.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const extra = process.argv.slice(2).filter((a) => a !== "--");
const vitestArgs = ["--root", "apps/api", "test/isolation/", ...extra];
const isWin = process.platform === "win32";

const [command, args, options] = process.env.TEST_DATABASE_URL
  ? [isWin ? "pnpm.cmd" : "pnpm", ["exec", "vitest", "run", ...vitestArgs], { shell: isWin }]
  : [process.execPath, [resolve(root, "packages/database/scripts/with-postgres.mjs"), ...vitestArgs], {}];

const child = spawn(command, args, { cwd: root, stdio: "inherit", env: process.env, ...options });
child.on("exit", (code) => process.exit(code ?? 1));
