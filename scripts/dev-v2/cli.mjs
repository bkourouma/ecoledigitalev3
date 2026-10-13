#!/usr/bin/env node
/**
 * Mode développement « ancien + v2 ensemble » : `pnpm dev:v2:setup` puis `pnpm dev:v2` (ou demarrer-application.bat).
 *
 * La plateforme v2 utilise une base SÉPARÉE `ecoledigitale_v2` sur le MÊME serveur Postgres local que l'ancienne
 * application (celui de DATABASE_URL dans `.env`) ; Redis est celui de REDIS_URL. Aucun Docker.
 *
 *   setup  : crée la base `ecoledigitale_v2` si elle n'existe pas (aucune autre base n'est touchée), applique les
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
import { platformEnv } from "../demo/lib/env.mjs";
import { generateSecrets } from "../demo/lib/secrets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = resolve(root, ".dev-v2");
const secretsFile = resolve(dir, "secrets.json");
const envFile = resolve(dir, "env.local");
const credentialsFile = resolve(dir, "credentials.json");
const DB = "ecoledigitale_v2";
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
    env: { ...process.env, DEVV2_MIGRATOR_URL: adminUrl(DB),  },
  });
  if (r.status !== 0) die("migrations v2 en échec.");
  // Rôle applicatif : membre de `app_user` (créé par les migrations), sans superuser ni BYPASSRLS. Créé ici (et non par
  // `createLoginRole`, qui refuse les bases dont le nom ne finit pas par _dev/_test/_local).
  await withClient(DB, async (c) => {
    const have = (await c.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=$1", [ROLE])).rows[0];
    if (have && (have.rolsuper || have.rolbypassrls)) die(`le rôle ${ROLE} existe mais n'est pas un rôle applicatif sûr.`);
    if (!/^[A-Za-z0-9_-]{16,}$/.test(s.appPassword)) die("mot de passe généré invalide.");
    await c.query(`${have ? "ALTER" : "CREATE"} ROLE ${ROLE} LOGIN PASSWORD '${s.appPassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    await c.query(`GRANT app_user TO ${ROLE}`);
    await c.query(`GRANT CONNECT ON DATABASE ${DB} TO ${ROLE}`);
  });
  console.log(`[dev-v2] rôle applicatif « ${ROLE} » prêt (membre de app_user, sans BYPASSRLS).`);
  const u = new URL(adminUrl(DB));
  u.username = ROLE;
  u.password = s.appPassword;
  const app = u.toString();
  // Secrets de plateforme (paiements sandbox, signature des bulletins, notifications SIMULÉES, stockage disque) : générés une
  // fois, persistés dans `.dev-v2/secrets.json`, partagés par l'API, le worker et le seed (mêmes clés partout).
  const all = { ...generateSecrets(), ...s };
  writeFileSync(secretsFile, JSON.stringify(all, null, 2), { mode: 0o600 });
  const platform = platformEnv({ secrets: all, ports: { pg: 5432, redis: 6379, api: 4000, web: 3000, worker: 8012 } });
  delete platform.AUDIT_HMAC_KEY; // la chaîne d'audit reste en SHA-256 simple comme celle de l'API déjà démarrée
  delete platform.REDIS_URL; // Redis vient de `.env`
  const vars = {
    ...platform,
    V2_DATABASE_URL: app,
    WORKER_DATABASE_URL: app,
    WORKER_QUEUE_PREFIX: "eddev",
    IAM_MFA_TOTP_ISSUER: "EcoleDigitale (test)",
    STORAGE_DISK_DIR: resolve(dir, "objects"),
    REPORTCARDS_VERIFICATION_BASE_URL: "http://localhost:3000",
    REPORTCARDS_SIGNING_KEY_ID: "ed-dev-key-1",
    // Web : connexion v2, panneau des comptes de test alimenté par le seed (DEV_V2_AUTH=0 pour garder l'ancienne connexion).
    NEXT_PUBLIC_AUTH_V2: process.env.DEV_V2_AUTH === "0" ? "0" : "1",
    NEXT_PUBLIC_V2_LANDING: "1",
    NEXTAUTH_SECRET: all.nextAuthSecret,
    SHOW_TECHNICAL_ACCOUNTS: "true",
    DEV_CREDENTIALS_FILE: credentialsFile,
    // Paiement en ligne : propose le fournisseur simulé « sandbox » (succès / en attente 001 / échec 013) aux écrans parent et caisse.
    NEXT_PUBLIC_FINANCE_SANDBOX: "1",
  };
  const lines = ["# Généré par `pnpm dev:v2:setup` : local, ignoré par git. Ne jamais committer.", ...Object.entries(vars).map(([k, v]) => `${k}=${JSON.stringify(String(v))}`), ""];
  writeFileSync(envFile, lines.join("\n"), { mode: 0o600 });
  console.log("[dev-v2] prêt. Lancez : pnpm dev:v2 (ou demarrer-application.bat).");
}

function loadEnvLocal() {
  const env = {};
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) continue;
    try {
      env[m[1]] = m[2].startsWith('"') ? JSON.parse(m[2]) : m[2];
    } catch {
      env[m[1]] = m[2];
    }
  }
  // Environnements créés avant l'ajout du fournisseur simulé : actif par défaut en développement.
  if (env.NEXT_PUBLIC_FINANCE_SANDBOX === undefined) env.NEXT_PUBLIC_FINANCE_SANDBOX = "1";
  // Pas de SMTP en développement : l'API journalise le lien des invitations (cherchez « iam_mail_dev_link » dans le terminal de `pnpm dev:v2`).
  if (env.ACCOUNT_MAIL_DEV_LINKS === undefined) env.ACCOUNT_MAIL_DEV_LINKS = "1";
  // Pas de ClamAV en développement : l'analyseur local met en quarantaine un fichier contenant la chaîne d'essai EICAR (voir `docs/guide-test/14-documents-ged.md`).
  if (env.DOCUMENTS_SCANNER === undefined) env.DOCUMENTS_SCANNER = "dev-eicar";
  return env;
}

async function seed(script = "scripts/dev-v2/seed.ts") {
  if (!(await dbReady())) await setup();
  const env = { ...process.env, ...loadEnvLocal(), ALLOW_SEED: "1", NODE_ENV: "development" };
  const redis = fromDotEnv("REDIS_URL");
  if (!redis) die("REDIS_URL est absent de `.env` (Redis local requis pour le worker du seed).");
  env.REDIS_URL = redis;
  const r = spawnSync(process.execPath, [resolve(root, "node_modules", "tsx", "dist", "cli.mjs"), script], { cwd: root, stdio: "inherit", env: { ...env, TSX_TSCONFIG_PATH: resolve(root, "apps", "api", "tsconfig.json") }, windowsHide: true });
  if (r.status !== 0) die("seed en échec.");
  console.log(`[dev-v2] comptes de test écrits dans .dev-v2/credentials.json (local). Relancez l'application : le panneau de /login les affiche.`);
}

async function up() {
  if (!(await dbReady())) {
    console.log("[dev-v2] base ou rôle v2 absents : configuration automatique.");
    await setup();
  }
  // Ce que vous avez exporté dans le shell l'emporte ; REDIS_URL vient de `.env` (lu par l'API et le worker).
  const env = { ...loadEnvLocal(), ...process.env };
  env.DEV_CREDENTIALS_FILE = credentialsFile;
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

/**
 * Simule des webhooks de paiement EN ÉCHEC (L-62) : aucun opérateur réel n'en envoie en développement, donc « Webhooks en échec »
 * restait vide et « Rejouer » intestable. Pour chaque paiement simulé (fournisseur `sandbox`) encore EN ATTENTE de l'école
 * (DEVV2_SCHOOL_SLUG, défaut ecole-flamboyants), pose un événement FAILED (compte signataire différent du compte encaisseur).
 * Créez d'abord un paiement simulé dont le montant finit par 001 (en attente). Refusé hors base locale ecoledigitale_v2.
 */
async function failWebhook() {
  const slug = process.env.DEVV2_SCHOOL_SLUG?.trim() || "ecole-flamboyants";
  const n = await withClient(DB, async (c) => {
    const t = (await c.query("SELECT id FROM kernel.tenants WHERE slug = $1", [slug])).rows[0];
    if (!t) die(`école « ${slug} » introuvable.`);
    const pending = (
      await c.query(
        `SELECT p.id FROM finance.payments p
          WHERE p.tenant_id = $1 AND p.provider = 'sandbox' AND p.status = 'PENDING'
            AND NOT EXISTS (SELECT 1 FROM finance.webhook_events w WHERE w.tenant_id = p.tenant_id AND w.payment_id = p.id AND w.status = 'FAILED')`,
        [t.id],
      )
    ).rows;
    for (const p of pending) {
      await c.query(
        `INSERT INTO finance.webhook_events (id, tenant_id, provider, event_id, event_type, payload, status, payment_id, error, attempts, received_at, processed_at)
         VALUES (gen_random_uuid(), $1, 'sandbox', $2, 'payment.succeeded', $3::jsonb, 'FAILED', $4, 'finance.webhook_account_mismatch', 1, now(), now())`,
        [t.id, `dev-fail-${p.id}`, JSON.stringify({ simulated: true, reference: p.id }), p.id],
      );
    }
    return pending.length;
  });
  console.log(n === 0 ? "[dev-v2] aucun paiement simulé en attente sans événement en échec : créez d'abord un paiement dont le montant finit par 001." : `[dev-v2] ${n} webhook(s) en échec créé(s) : Finance > Webhooks en échec > Rejouer.`);
}

const cmd = process.argv[2] ?? "up";
if (cmd === "setup") await setup();
else if (cmd === "up") await up();
else if (cmd === "seed") await seed();
else if (cmd === "new-school") await seed("scripts/dev-v2/new-school.ts");
else if (cmd === "add-account") await seed("scripts/dev-v2/add-account.ts");
else if (cmd === "real-school") await seed("scripts/dev-v2/real-school.ts");
else if (cmd === "fail-webhook") await failWebhook();
else if (cmd === "probe") await seed("scripts/dev-v2/probe.ts");
else if (cmd === "status") console.log(`base ${DB} + rôle ${ROLE} : ${(await dbReady()) ? "prêts" : "à configurer (pnpm dev:v2:setup)"}`);
else die(`commande inconnue : ${cmd} (setup | up | status)`);
