#!/usr/bin/env node
/**
 * Mode développement « ancien + v2 ensemble » : `pnpm dev:v2:setup` puis `pnpm dev:v2` (ou demarrer-application.bat).
 *
 *   setup  : crée/démarre ses PROPRES conteneurs Docker (`ed-dev-pg` sur 127.0.0.1:54330, `ed-dev-redis` sur :6390), la base
 *            `ecoledigitale_v2_dev`, applique les migrations v2, crée le rôle applicatif, génère les secrets aléatoires
 *            dans `.dev-v2/` (ignoré par git). Ne touche NI à votre Postgres local NI à votre Redis NI à votre `.env`.
 *   up     : charge `.dev-v2/env.local` dans l'environnement (sans écraser ce que vous avez exporté) puis lance l'API,
 *            le web et le worker. L'API legacy continue d'utiliser DATABASE_URL (votre base) ; la v2 utilise la base ci-dessus.
 *   status / down : état et arrêt des conteneurs (ed-dev-* uniquement).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = resolve(root, ".dev-v2");
const secretsFile = resolve(dir, "secrets.json");
const envFile = resolve(dir, "env.local");
const PG = "ed-dev-pg";
const REDIS = "ed-dev-redis";
const PG_PORT = 54330;
const REDIS_PORT = 6390;
const DB = "ecoledigitale_v2_dev";
const ROLE = "ed_dev_app";
const NAME_RE = /^ed-dev-[a-z0-9-]+$/;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const b64url = (n) => randomBytes(n).toString("base64url");
const die = (m) => {
  console.error(`[dev-v2] ${m}`);
  process.exit(1);
};
function docker(args) {
  for (const a of args) if (/^ed-[a-z0-9-]*$/.test(a) && !NAME_RE.test(a)) die(`garde-fou : ressource Docker « ${a} » refusée.`);
  const r = spawnSync("docker", args, { encoding: "utf8", windowsHide: true });
  return { status: r.status ?? 1, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() };
}
const state = (n) => {
  const r = docker(["inspect", n, "--format", "{{.State.Status}}"]);
  return r.status === 0 ? r.out : "absent";
};

function secrets() {
  if (existsSync(secretsFile)) return JSON.parse(readFileSync(secretsFile, "utf8"));
  mkdirSync(dir, { recursive: true });
  const s = {
    pgPassword: b64url(24),
    appPassword: b64url(24),
    redisPassword: b64url(24),
    iamJwtSecret: b64url(48),
    iamMfaEncryptionKey: randomBytes(32).toString("base64"),
  };
  writeFileSync(secretsFile, JSON.stringify(s, null, 2));
  return s;
}

function urls(s) {
  const migrator = `postgresql://postgres:${encodeURIComponent(s.pgPassword)}@127.0.0.1:${PG_PORT}/${DB}`;
  const app = `postgresql://${ROLE}:${encodeURIComponent(s.appPassword)}@127.0.0.1:${PG_PORT}/${DB}`;
  const redis = `redis://:${encodeURIComponent(s.redisPassword)}@127.0.0.1:${REDIS_PORT}`;
  return { migrator, app, redis };
}

function ensureContainers(s) {
  if (docker(["info", "--format", "{{.ServerVersion}}"]).status !== 0) die("Docker n'est pas disponible (démarrez Docker Desktop).");
  if (state(PG) === "absent") {
    const r = docker(["run", "-d", "--name", PG, "-e", `POSTGRES_PASSWORD=${s.pgPassword}`, "-p", `127.0.0.1:${PG_PORT}:5432`, "-v", "ed-dev-pgdata:/var/lib/postgresql/data", "postgres:17-alpine"]);
    if (r.status !== 0) die(`création de ${PG} impossible : ${r.err}`);
  } else if (state(PG) !== "running") docker(["start", PG]);
  if (state(REDIS) === "absent") {
    const r = docker(["run", "-d", "--name", REDIS, "-p", `127.0.0.1:${REDIS_PORT}:6379`, "-v", "ed-dev-redisdata:/data", "redis:7-alpine", "redis-server", "--requirepass", s.redisPassword, "--appendonly", "yes"]);
    if (r.status !== 0) die(`création de ${REDIS} impossible : ${r.err}`);
  } else if (state(REDIS) !== "running") docker(["start", REDIS]);
}

async function waitPg() {
  for (let i = 0; i < 60; i++) {
    if (docker(["exec", PG, "pg_isready", "-U", "postgres"]).status === 0) {
      // L'initialisation du conteneur redémarre une fois : on exige deux réponses consécutives.
      await new Promise((r) => setTimeout(r, 1500));
      if (docker(["exec", PG, "pg_isready", "-U", "postgres"]).status === 0) return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  die("Postgres ne répond pas.");
}

async function setup() {
  const s = secrets();
  const u = urls(s);
  console.log(`[dev-v2] conteneurs ${PG} (127.0.0.1:${PG_PORT}) et ${REDIS} (127.0.0.1:${REDIS_PORT}) : votre Postgres et votre Redis ne sont pas touchés.`);
  ensureContainers(s);
  await waitPg();
  const exists = docker(["exec", PG, "psql", "-U", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname='${DB}'`]).out === "1";
  if (!exists) {
    const r = docker(["exec", PG, "psql", "-U", "postgres", "-c", `CREATE DATABASE ${DB}`]);
    if (r.status !== 0) die(`création de la base impossible : ${r.err}`);
  }
  const r = spawnSync(pnpm, ["exec", "tsx", "scripts/dev-v2/bootstrap.ts"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DEVV2_MIGRATOR_URL: u.migrator, DEVV2_APP_ROLE: ROLE, DEVV2_APP_ROLE_PASSWORD: s.appPassword },
  });
  if (r.status !== 0) die("migrations v2 en échec.");
  const lines = [
    "# Généré par `pnpm dev:v2:setup` : local, ignoré par git. Ne jamais committer.",
    `V2_MIGRATOR_URL=${u.migrator}`,
    `V2_DATABASE_URL=${u.app}`,
    `WORKER_DATABASE_URL=${u.app}`,
    `REDIS_URL=${u.redis}`,
    "WORKER_QUEUE_PREFIX=eddev",
    `IAM_JWT_SECRET=${s.iamJwtSecret}`,
    `IAM_MFA_ENCRYPTION_KEY=${s.iamMfaEncryptionKey}`,
    "IAM_COOKIE_SECURE=false",
    "V2_APP_BASE_URL=http://localhost:3000",
    "",
  ];
  writeFileSync(envFile, lines.join("\n"));
  console.log("[dev-v2] prêt. Variables v2 écrites dans .dev-v2/env.local. Lancez : pnpm dev:v2 (ou demarrer-application.bat).");
}

function loadEnvLocal() {
  if (!existsSync(envFile)) die("`.dev-v2/env.local` absent : lancez d'abord `pnpm dev:v2:setup`.");
  const env = {};
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function dbReady() {
  const sql = `SELECT (SELECT count(*) FROM pg_database WHERE datname='${DB}') + (SELECT count(*) FROM pg_roles WHERE rolname='${ROLE}')`;
  return docker(["exec", PG, "psql", "-U", "postgres", "-tAc", sql]).out === "2";
}

async function up() {
  const s = secrets();
  ensureContainers(s);
  await waitPg();
  // Conteneur ou volume recréé (Docker nettoyé, machine réinstallée) : la base et le rôle manquent, on refait la configuration.
  if (!(await dbReady())) {
    console.log("[dev-v2] base ou rôle v2 absents : configuration automatique.");
    await setup();
  }
  const local = loadEnvLocal();
  // Ce que vous avez exporté l'emporte, sauf REDIS_URL : le Redis du mode v2 est celui du conteneur ed-dev-redis.
  const env = { ...local, ...process.env, REDIS_URL: local.REDIS_URL };
  console.log("[dev-v2] API http://localhost:4000 · Web http://localhost:3000 · worker (santé :8012). Ctrl+C pour arrêter.");
  const sh = process.platform === "win32";
  const run = (args) => spawn(pnpm, args, { cwd: root, stdio: "inherit", shell: sh, env });
  const kids = [run(["dev"]), run(["--filter", "@ecoledigitale/worker", "dev"])];
  const stop = () => kids.forEach((k) => k.kill());
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  kids[0].on("exit", (c) => {
    stop();
    process.exit(c ?? 0);
  });
}

const cmd = process.argv[2] ?? "up";
if (cmd === "setup") await setup();
else if (cmd === "up") await up();
else if (cmd === "status") console.log(`${PG}: ${state(PG)} · ${REDIS}: ${state(REDIS)}`);
else if (cmd === "down") {
  docker(["stop", PG]);
  docker(["stop", REDIS]);
  console.log("[dev-v2] conteneurs arrêtés (données conservées dans les volumes ed-dev-*).");
} else die(`commande inconnue : ${cmd} (setup | up | status | down)`);
