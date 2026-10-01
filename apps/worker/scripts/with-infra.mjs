#!/usr/bin/env node
/**
 * Lance un Postgres 17 ET un Redis 7 ÉPHÉMÈRES dans Docker, exécute les tests contre eux
 * (TEST_DATABASE_URL, TEST_REDIS_URL), puis supprime les deux conteneurs.
 *
 *   pnpm --filter @ecoledigitale/worker test:integration [-- <args vitest>]
 *
 * - conteneurs nommés `ed-wk-it-pg-<aléa>` / `ed-wk-it-redis-<aléa>`, ports libres liés à 127.0.0.1 ;
 * - mot de passe Postgres aléatoire, jamais écrit sur disque ni affiché ;
 * - suppression à la fin, même en cas d'échec ou d'interruption ;
 * - ne touche à AUCUN service local existant (ports et noms distincts).
 *
 * Variables : ED_PG_IMAGE (défaut postgres:17-alpine), ED_REDIS_IMAGE (défaut redis:7-alpine).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const pgImage = process.env.ED_PG_IMAGE ?? "postgres:17-alpine";
const redisImage = process.env.ED_REDIS_IMAGE ?? "redis:7-alpine";
const suffix = randomBytes(4).toString("hex");
const pgName = `ed-wk-it-pg-${suffix}`;
const redisName = `ed-wk-it-redis-${suffix}`;
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

const started = new Set();
function cleanup() {
  for (const name of [...started]) {
    started.delete(name);
    const r = docker("rm", "-f", "-v", name);
    console.log(r.status === 0 ? `[infra] conteneur ${name} supprimé` : `[infra] ÉCHEC de suppression de ${name} : ${r.stderr}`);
  }
}
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

async function waitPg(url) {
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

async function waitRedis() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const r = docker("exec", redisName, "redis-cli", "ping");
    if (r.status === 0 && r.stdout.trim() === "PONG") return;
    await new Promise((r2) => setTimeout(r2, 500));
  }
  throw new Error("Redis n'est pas prêt après 30 s");
}

const info = docker("info", "--format", "{{.ServerVersion}}");
if (info.status !== 0) {
  console.error("[infra] Docker indisponible. Définissez TEST_DATABASE_URL et TEST_REDIS_URL vers des instances JETABLES.");
  process.exit(2);
}

let code = 1;
try {
  const pgPort = await freePort();
  const redisPort = await freePort();

  let run = docker("run", "-d", "--name", pgName, "-e", `POSTGRES_PASSWORD=${password}`, "-p", `127.0.0.1:${pgPort}:5432`, pgImage);
  if (run.status !== 0) throw new Error(`docker run postgres a échoué : ${run.stderr}`);
  started.add(pgName);

  // appendonly no / save "" : instance de test, pas de persistance. maxmemory-policy recommandée par BullMQ.
  run = docker(
    "run", "-d", "--name", redisName, "-p", `127.0.0.1:${redisPort}:6379`, redisImage,
    "redis-server", "--save", "", "--appendonly", "no", "--maxmemory-policy", "noeviction",
  );
  if (run.status !== 0) throw new Error(`docker run redis a échoué : ${run.stderr}`);
  started.add(redisName);
  console.log(`[infra] ${pgImage} (${pgName}, port ${pgPort}) et ${redisImage} (${redisName}, port ${redisPort}) démarrés`);

  const pgUrl = `postgres://postgres:${password}@127.0.0.1:${pgPort}/postgres`;
  await Promise.all([waitPg(pgUrl), waitRedis()]);
  console.log(`[infra] prêts : postgres ${docker("exec", pgName, "psql", "-U", "postgres", "-Atc", "SHOW server_version").stdout.trim()}`);

  code = await new Promise((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["exec", "vitest", "run", ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: { ...process.env, TEST_DATABASE_URL: pgUrl, TEST_REDIS_URL: `redis://127.0.0.1:${redisPort}` },
        shell: process.platform === "win32",
      },
    );
    child.on("exit", (c) => resolve(c ?? 1));
  });
} catch (e) {
  console.error(`[infra] ${e instanceof Error ? e.message : e}`);
} finally {
  cleanup();
}
process.exit(code);
