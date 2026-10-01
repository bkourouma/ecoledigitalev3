#!/usr/bin/env node
/**
 * Lance un Postgres 17 ÉPHÉMÈRE dans Docker, exécute les tests d'intégration
 * contre lui (TEST_DATABASE_URL), puis supprime le conteneur.
 *
 *   pnpm --filter @ecoledigitale/database test:integration
 *
 * - conteneur nommé `ed-pg-it-<aléa>`, port hôte libre, lié à 127.0.0.1 ;
 * - mot de passe généré à chaque exécution, jamais écrit sur disque ni affiché ;
 * - le conteneur est supprimé à la fin, même en cas d'échec ou d'interruption.
 *
 * Variables : ED_PG_IMAGE (défaut postgres:17), arguments supplémentaires passés à vitest.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const image = process.env.ED_PG_IMAGE ?? "postgres:17";
const name = `ed-pg-it-${randomBytes(4).toString("hex")}`;
const password = randomBytes(18).toString("hex");

const docker = (...args) => spawnSync("docker", args, { encoding: "utf8" });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let started = false;
function cleanup() {
  if (!started) return;
  started = false;
  const r = docker("rm", "-f", "-v", name);
  console.log(r.status === 0 ? `[pg] conteneur ${name} supprimé` : `[pg] ÉCHEC de suppression de ${name} : ${r.stderr}`);
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

async function waitReady(url) {
  const deadline = Date.now() + 60_000;
  let okInARow = 0;
  while (Date.now() < deadline) {
    const c = new Client({ connectionString: url });
    try {
      await c.connect();
      await c.query("SELECT 1");
      okInARow += 1;
    } catch {
      okInARow = 0;
    } finally {
      await c.end().catch(() => undefined);
    }
    // L'image redémarre le serveur une fois après l'initialisation : on exige 2 succès espacés.
    if (okInARow >= 2) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Postgres n'est pas prêt après 60 s");
}

const info = docker("info", "--format", "{{.ServerVersion}}");
if (info.status !== 0) {
  console.error("[pg] Docker indisponible (démon arrêté ?). Définissez TEST_DATABASE_URL vers un Postgres jetable pour lancer les tests d'intégration.");
  process.exit(2);
}

const port = await freePort();
const run = docker(
  "run", "-d", "--name", name,
  "-e", `POSTGRES_PASSWORD=${password}`,
  "-p", `127.0.0.1:${port}:5432`,
  image,
);
if (run.status !== 0) {
  console.error(`[pg] docker run a échoué : ${run.stderr}`);
  process.exit(2);
}
started = true;
console.log(`[pg] ${image} démarré : conteneur ${name}, port ${port}`);

let code = 1;
try {
  const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  await waitReady(url);
  const v = docker("exec", name, "psql", "-U", "postgres", "-Atc", "SHOW server_version");
  console.log(`[pg] prêt, server_version=${v.stdout.trim()}`);

  code = await new Promise((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["exec", "vitest", "run", ...process.argv.slice(2)],
      { stdio: "inherit", env: { ...process.env, TEST_DATABASE_URL: url }, shell: process.platform === "win32" },
    );
    child.on("exit", (c) => resolve(c ?? 1));
  });
} catch (e) {
  console.error(`[pg] ${e instanceof Error ? e.message : e}`);
} finally {
  cleanup();
}
process.exit(code);
