#!/usr/bin/env node
// Lance un Postgres ÉPHÉMÈRE dans Docker, exécute les tests de comportement du DDL de
// specs/v2/006-secondary/data-model.md (node:test), puis supprime le conteneur.
//
//   node specs/v2/006-secondary/ddl-test/run.mjs
//
// - conteneur `ed-pg-006-<aléa>`, port hôte libre lié à 127.0.0.1, mot de passe généré, supprimé même en cas d'échec ;
// - ED_PG_IMAGE (défaut postgres:17-alpine) ;
// - TEST_DATABASE_URL (superutilisateur d'un serveur JETABLE) évite Docker ;
// - arguments supplémentaires passés à `node --test` (ex. un fichier de test).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const here = dirname(fileURLToPath(import.meta.url));

const image = process.env.ED_PG_IMAGE ?? "postgres:17-alpine";
const name = `ed-pg-006-${randomBytes(4).toString("hex")}`;
const password = randomBytes(18).toString("hex");
const docker = (...args) => spawnSync("docker", args, { encoding: "utf8" });

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

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
  let ok = 0;
  while (Date.now() < deadline) {
    const c = new Client({ connectionString: url });
    try {
      await c.connect();
      await c.query("SELECT 1");
      ok += 1;
    } catch {
      ok = 0;
    } finally {
      await c.end().catch(() => undefined);
    }
    if (ok >= 2) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Postgres n'est pas prêt après 60 s");
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(here)
      .filter((f) => f.endsWith(".test.mjs"))
      .sort()
      .map((f) => join(here, f));

async function runTests(url) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test", "--test-concurrency=1", "--test-timeout=120000", ...files], {
      stdio: "inherit",
      env: { ...process.env, TEST_DATABASE_URL: url },
    });
    child.on("exit", (c) => resolve(c ?? 1));
  });
}

let code = 1;
if (process.env.TEST_DATABASE_URL) {
  code = await runTests(process.env.TEST_DATABASE_URL);
} else {
  const info = docker("info", "--format", "{{.ServerVersion}}");
  if (info.status !== 0) {
    console.error("[pg] Docker indisponible (démon arrêté ?). Définissez TEST_DATABASE_URL vers un Postgres jetable.");
    process.exit(2);
  }
  const port = await freePort();
  const run = docker("run", "-d", "--name", name, "-e", `POSTGRES_PASSWORD=${password}`, "-p", `127.0.0.1:${port}:5432`, image);
  if (run.status !== 0) {
    console.error(`[pg] docker run a échoué : ${run.stderr}`);
    process.exit(2);
  }
  started = true;
  console.log(`[pg] ${image} démarré : conteneur ${name}, port ${port}`);
  try {
    const url = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
    await waitReady(url);
    const v = docker("exec", name, "psql", "-U", "postgres", "-Atc", "SHOW server_version");
    console.log(`[pg] prêt, server_version=${v.stdout.trim()}`);
    code = await runTests(url);
  } catch (e) {
    console.error(`[pg] ${e instanceof Error ? e.message : e}`);
  } finally {
    cleanup();
  }
}
process.exit(code);
