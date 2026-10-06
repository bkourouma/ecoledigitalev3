#!/usr/bin/env node
/**
 * Mode développement « ancien + v2 ensemble » : `pnpm dev:v2:setup` puis `pnpm dev:v2` (ou demarrer-application.bat).
 *
 * La plateforme v2 utilise une base SÉPARÉE `ecoledigitale_v2_dev` sur le MÊME serveur Postgres local que l'ancienne
 * application (celui de DATABASE_URL dans `.env`) ; Redis est celui de REDIS_URL. Aucun Docker.
 *
 *   setup  : crée la base `ecoledigitale_v2_dev` si elle n'existe pas (aucune autre base n'est touchée), applique les
 *            migrations v2, crée le rôle applicatif `ed_dev_app` (membre de `app_user`, sans BYPASSRLS) avec un mot de passe
 *            aléatoire, et écrit `.dev-v2/env.local` (ignoré par git) : URL du rôle applicatif + secrets IAM générés.
 *            Le mot de passe administrateur de `.env` n'est JAMAIS recopié ailleurs.
 *   up     : (re)configure si besoin, puis lance l'API, le web et le worker avec ces variables.
 *   status : état de la base v2.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = resolve(root, ".dev-v2");
const secretsFile = resolve(dir, "secrets.json");
const envFile = resolve(dir, "env.local");
const DB = "ecoledigitale_v2_dev";
const ROLE = "ed_dev_app";
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const { Client } = createRequire(resolve(root, "apps", "worker", "package.json"))("pg");

const b64url = (n) => randomBytes(n).toString("base64url");
const die = (m) => {
  console.error(`[dev-v2] ${m}`);
  process.exit(1);
};

/** Lit une variable dans `.env` (racine) sans l'afficher ; l'environnement du shell l'emporte. */
function fromDotEnv(name) {
  if (process.env[name]) return process.env[name];
  const file = resolve(root, ".env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = new RegExp(`^${name}=(.*)$`).exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

function secrets() {
  if (existsSync(secretsFile)) return JSON.parse(readFileSync(secretsFile, "utf8"));
  mkdirSync(dir, { recursive: true });
  const s = { appPassword: b64url(24), iamJwtSecret: b64url(48), iamMfaEncryptionKey: randomBytes(32).toString("base64") };
  writeFileSync(secretsFile, JSON.stringify(s, null, 2));
  return s;
}

/** URL d'administration du serveur local (celle de l'ancienne application), pointée sur une base donnée. */
function adminUrl(database) {
  const base = fromDotEnv("DATABASE_URL");
  if (!base) die("DATABASE_URL est absent de `.env` : impossible de trouver le Postgres local.");
  const u = new URL(base);
  u.pathname = `/${database}`;
  return u.toString();
}

async function withClient(database, fn) {
  const c = new Client({ connectionString: adminUrl(database), application_name: "ecoledigitale-dev-v2" });
  try {
    await c.connect();
  } catch (e) {
    die(`connexion au Postgres local impossible (${e instanceof Error ? e.message : e}). Démarrez le service Postgres.`);
  }
  try {
    return await fn(c);
  } finally {
    await c.end().catch(() => undefined);
  }
}

async function dbReady() {
  return withClient("postgres", async (c) => {
    const d = await c.query("SELECT 1 FROM pg_database WHERE datname=$1", [DB]);
    const r = await c.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [ROLE]);
    return d.rowCount === 1 && r.rowCount === 1 && existsSync(envFile);
  });
}

async function setup() {
  const s = secrets();
  const host = new URL(adminUrl("postgres"));
  console.log(`[dev-v2] Postgres local ${host.hostname}:${host.port || 5432} : création de la base ${DB} si absente (les autres bases ne sont pas touchées).`);
  await withClient("postgres", async (c) => {
    const exists = (await c.query("SELECT 1 FROM pg_database WHERE datname=$1", [DB])).rowCount === 1;
    if (!exists) await c.query(`CREATE DATABASE ${DB}`);
  });
  const r = spawnSync(pnpm, ["exec", "tsx", "scripts/dev-v2/bootstrap.ts"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DEVV2_MIGRATOR_URL: adminUrl(DB), DEVV2_APP_ROLE: ROLE, DEVV2_APP_ROLE_PASSWORD: s.appPassword },
  });
  if (r.status !== 0) die("migrations v2 en échec.");
  const u = new URL(adminUrl(DB));
  u.username = ROLE;
  u.password = s.appPassword;
  const app = u.toString();
  const lines = [
    "# Généré par `pnpm dev:v2:setup` : local, ignoré par git. Ne jamais committer.",
    `V2_DATABASE_URL=${app}`,
    `WORKER_DATABASE_URL=${app}`,
    "WORKER_QUEUE_PREFIX=eddev",
    `IAM_JWT_SECRET=${s.iamJwtSecret}`,
    `IAM_MFA_ENCRYPTION_KEY=${s.iamMfaEncryptionKey}`,
    "IAM_COOKIE_SECURE=false",
    "V2_APP_BASE_URL=http://localhost:3000",
    "",
  ];
  writeFileSync(envFile, lines.join("\n"));
  console.log("[dev-v2] prêt. Lancez : pnpm dev:v2 (ou demarrer-application.bat).");
}

function loadEnvLocal() {
  const env = {};
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function up() {
  if (!(await dbReady())) {
    console.log("[dev-v2] base ou rôle v2 absents : configuration automatique.");
    await setup();
  }
  // Ce que vous avez exporté dans le shell l'emporte ; REDIS_URL vient de `.env` (lu par l'API et le worker).
  const env = { ...loadEnvLocal(), ...process.env };
  const redis = fromDotEnv("REDIS_URL");
  if (redis) env.REDIS_URL = redis;
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
else if (cmd === "status") console.log(`base ${DB} + rôle ${ROLE} : ${(await dbReady()) ? "prêts" : "à configurer (pnpm dev:v2:setup)"}`);
else die(`commande inconnue : ${cmd} (setup | up | status)`);
