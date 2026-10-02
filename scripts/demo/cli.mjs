#!/usr/bin/env node
/**
 * Démonstration EcoleDigitale v2 en UNE commande.
 *
 *   pnpm demo:up [-- --detach] [--no-web] [--web-port N]   démarre tout (Docker, base, seed, API, worker, web)
 *   pnpm demo:down                                         arrête tout (les données sont conservées)
 *   pnpm demo:reset                                        supprime conteneurs, volumes et .demo/ de DÉMONSTRATION (ed-demo-* uniquement)
 *   pnpm demo:status                                       état des conteneurs, processus et URL
 *   pnpm demo:totp <e-mail | etablissement role>           code MFA courant d'un compte
 *   pnpm demo:smoke                                        test de fumée sur la pile démarrée
 *
 * Sans dépendance nouvelle : Node >= 18, Docker, pnpm (déjà installé : tsx et next viennent du dépôt).
 * Aucun fichier .env n'est lu ni copié ; secrets générés à l'exécution dans `.demo/` (ignoré par git).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { API_TSCONFIG, CREDENTIALS_JSON, CREDENTIALS_MD, DEMO_DIR, IMPORT_DIR, LOG_DIR, MAILBOX_FILE, ROOT } from "./lib/paths.mjs";
import * as dk from "./lib/docker.mjs";
import { apiEnv, APP_ROLE, pgUrl, platformEnv, webEnv, workerEnv } from "./lib/env.mjs";
import { isPortFree, pickPort, sleep, waitHttp } from "./lib/net.mjs";
import { isAlive, killTree, launch, launchTs, stopAll } from "./lib/procs.mjs";
import { loadOrCreateSecrets, loadSecrets } from "./lib/secrets.mjs";
import { ensureDirs, readJson, readPids, readState, wipeDemoDir, writeState } from "./lib/state.mjs";
import { readCredentials, writeCredentialsMd } from "./lib/credentials.mjs";
import { PLATFORM_GUIDE, ROLE_GUIDE, ROLE_ORDER, TENANTS } from "./lib/guide.mjs";
import { secondsLeft, totpAt } from "./lib/totp.mjs";

const PREFERRED = { pg: 15432, redis: 16379, api: 4100, web: 3100, worker: 8112 };
const DEFAULT_TENANT = TENANTS[0].slug;

const out = (s = "") => process.stdout.write(`${s}\n`);
const step = (s) => out(`\n• ${s}`);
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;

function die(message, code = 1) {
  console.error(`\nERREUR : ${message}`);
  process.exit(code);
}

function parseFlags(argv) {
  const flags = new Map();
  const rest = [];
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) flags.set(a.slice(2, eq), a.slice(eq + 1));
      else if (args[i + 1] && !args[i + 1].startsWith("--") && ["web-port", "api-port"].includes(a.slice(2))) flags.set(a.slice(2), args[(i += 1)]);
      else flags.set(a.slice(2), true);
    } else rest.push(a);
  }
  return { flags, rest };
}

// ------------------------------------------------------------------------------------------------------------- préparation
function preflight() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 18) die(`Node 18 ou plus est requis (version courante : ${process.versions.node}).`);
  const version = dk.dockerAvailable();
  if (!version) die("Docker est introuvable ou son démon n'est pas démarré. Lancez Docker Desktop puis relancez `pnpm demo:up`.");
  if (!existsSync(resolve(ROOT, "node_modules", "tsx", "dist", "cli.mjs"))) die("Dépendances absentes : lancez `pnpm install` à la racine du dépôt.");
  if (!existsSync(resolve(ROOT, "apps", "web", "node_modules", "next", "dist", "bin", "next"))) die("Dépendances du web absentes : lancez `pnpm install` à la racine du dépôt.");
  return version;
}

async function choosePorts(flags) {
  const state = readState();
  const saved = state.ports ?? {};
  const ports = {};
  for (const key of ["pg", "redis"]) {
    // Ports des conteneurs : ceux du conteneur existant s'il y en a un, sinon un port libre (fixé une fois pour toutes dans l'état).
    const container = key === "pg" ? dk.PG_CONTAINER : dk.REDIS_CONTAINER;
    const existing = dk.containerState(container) !== "absent" ? dk.publishedPort(container, key === "pg" ? 5432 : 6379) : null;
    ports[key] = existing ?? (saved[key] && (await isPortFree(saved[key])) ? saved[key] : await pickPort(PREFERRED[key]));
  }
  const wanted = (key, flag) => (flags.get(flag) ? Number(flags.get(flag)) : saved[key] ?? PREFERRED[key]);
  ports.api = (await isPortFree(wanted("api", "api-port"))) ? wanted("api", "api-port") : await pickPort(PREFERRED.api);
  ports.web = (await isPortFree(wanted("web", "web-port"))) ? wanted("web", "web-port") : await pickPort(PREFERRED.web);
  ports.worker = (await isPortFree(saved.worker ?? PREFERRED.worker)) ? (saved.worker ?? PREFERRED.worker) : await pickPort(PREFERRED.worker);
  return ports;
}

async function ensureContainers(secrets, ports) {
  const pgState = dk.containerState(dk.PG_CONTAINER);
  const redisState = dk.containerState(dk.REDIS_CONTAINER);
  for (const image of [dk.PG_IMAGE, dk.REDIS_IMAGE]) {
    if (!dk.imageExists(image)) out(`  image ${image} absente en local : premier lancement, Docker la télécharge (une seule fois).`);
  }
  if (pgState === "absent") {
    if (dk.volumeExists(dk.PG_VOLUME)) die(`Le volume ${dk.PG_VOLUME} existe sans conteneur : état incohérent. Lancez \`pnpm demo:reset\`.`);
    const r = dk.createPostgres({ port: ports.pg, password: secrets.pgSuperPassword });
    if (r.status !== 0) die(`création du conteneur ${dk.PG_CONTAINER} impossible : ${r.stderr}`);
  } else if (pgState !== "running") {
    const r = dk.startContainer(dk.PG_CONTAINER);
    if (r.status !== 0) die(`démarrage de ${dk.PG_CONTAINER} impossible : ${r.stderr}`);
  }
  if (redisState === "absent") {
    const r = dk.createRedis({ port: ports.redis, password: secrets.redisPassword });
    if (r.status !== 0) die(`création du conteneur ${dk.REDIS_CONTAINER} impossible : ${r.stderr}`);
  } else if (redisState !== "running") {
    const r = dk.startContainer(dk.REDIS_CONTAINER);
    if (r.status !== 0) die(`démarrage de ${dk.REDIS_CONTAINER} impossible : ${r.stderr}`);
  }
  await Promise.all([dk.waitPostgres(), dk.waitRedis(secrets.redisPassword)]);
}

function runTsSync(name, file, env) {
  const logFile = resolve(LOG_DIR, `${name}.log`);
  const r = spawnSync(process.execPath, [resolve(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), file], {
    cwd: ROOT,
    env: { ...process.env, TSX_TSCONFIG_PATH: API_TSCONFIG, ...env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  try {
    writeFileSync(logFile, text, "utf8"); // journal (écrasé à chaque exécution)
  } catch {
    /* journal au mieux */
  }
  return { status: r.status ?? 1, text };
}

async function seedIfNeeded(secrets, ports, flags) {
  const state = readState();
  if (state.seeded) {
    out("  données de démonstration déjà présentes (conservées depuis le lancement précédent).");
    return;
  }
  if (flags.get("no-seed")) {
    out("  --no-seed : base laissée vide.");
    return;
  }
  const env = {
    ...platformEnv({ secrets, ports }),
    ALLOW_SEED: "1",
    DEMO_CREDENTIALS_JSON: CREDENTIALS_JSON,
    DEMO_IMPORT_DIR: IMPORT_DIR,
    DEMO_MAILBOX_FILE: MAILBOX_FILE,
    DEMO_SEED_PACKS: typeof flags.get("packs") === "string" ? flags.get("packs") : "",
    LOG_LEVEL: "warn",
  };
  // Le seed s'exécute dans un processus détaché : sa progression est relayée depuis son journal.
  const child = launchTs("seed", "scripts/demo/seed.ts", [], { env });
  const logFile = resolve(LOG_DIR, "seed.log");
  let shown = 0;
  const relay = () => {
    if (!existsSync(logFile)) return;
    const lines = readFileSync(logFile, "utf8").split("\n");
    for (; shown < lines.length - 1; shown += 1) {
      const l = lines[shown];
      if (/^(•|===|Seed terminé|\[seed\])/.test(l)) out(`  ${l}`);
    }
  };
  for (;;) {
    await sleep(1500);
    relay();
    if (!child.alive()) break;
  }
  relay();
  const finalText = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
  if (!/Seed terminé/.test(finalText) || !existsSync(CREDENTIALS_JSON)) {
    die(`le seed a échoué (voir ${logFile}).\n${finalText.split("\n").slice(-12).join("\n")}\nSi la base contient des restes d'un seed interrompu : \`pnpm demo:reset\`.`);
  }
  writeState({ seeded: true, seededAt: new Date().toISOString() });
}

// ------------------------------------------------------------------------------------------------------------- commandes
async function up({ flags }) {
  const startedAt = Date.now();
  const timings = {};
  const mark = (name, from) => (timings[name] = Math.round((Date.now() - from) / 1000));

  out("EcoleDigitale v2 : démarrage de la démonstration");
  const dockerVersion = preflight();
  ensureDirs();
  const live = readPids();
  if (Object.values(live).some((pid) => isAlive(pid))) die("Une démonstration est déjà en cours (processus actifs). Utilisez `pnpm demo:down` d'abord, ou `pnpm demo:status`.");
  const { secrets, created } = loadOrCreateSecrets();
  if (created && (dk.containerState(dk.PG_CONTAINER) !== "absent" || dk.volumeExists(dk.PG_VOLUME))) {
    die("Des ressources Docker de démonstration existent mais .demo/secrets.json est absent : états incompatibles. Lancez `pnpm demo:reset`.");
  }
  const ports = await choosePorts(flags);
  writeState({ ports, defaultTenant: DEFAULT_TENANT });

  let t = Date.now();
  step(`Docker ${dockerVersion} : Postgres 17 et Redis 7 (conteneurs ${dk.PG_CONTAINER} / ${dk.REDIS_CONTAINER}, 127.0.0.1:${ports.pg} et :${ports.redis})`);
  await ensureContainers(secrets, ports);
  mark("conteneurs", t);

  t = Date.now();
  step("Base : migrations v2 (baseline, worker, modules) et rôle applicatif app_user (RLS)");
  const migrateEnv = {
    DEMO_MIGRATOR_URL: pgUrl("postgres", secrets.pgSuperPassword, ports.pg),
    DEMO_APP_ROLE: APP_ROLE,
    DEMO_APP_ROLE_PASSWORD: secrets.appRolePassword,
  };
  const mig = runTsSync("migrate", "scripts/demo/migrate.ts", migrateEnv);
  if (mig.status !== 0) die(`migrations en échec :\n${mig.text.split("\n").slice(-15).join("\n")}`);
  out(`  ${mig.text.split("\n").filter((l) => l.startsWith("[migrate]")).join("\n  ")}`);
  mark("migrations", t);

  t = Date.now();
  step("Données de démonstration (trois établissements ; mots de passe aléatoires)");
  await seedIfNeeded(secrets, ports, flags);
  mark("seed", t);
  writeCredentialsMd({ secrets, ports });

  t = Date.now();
  step("Worker (relais d'outbox, abonnés, tâches planifiées)");
  const worker = launchTs("worker", "src/index.ts", [], { cwd: resolve(ROOT, "apps", "worker"), env: workerEnv({ secrets, ports }) });
  step("API v2");
  const api = launchTs("api", "scripts/demo/api-server.ts", [], { env: { ...apiEnv({ secrets, ports }), DEMO_MAILBOX_FILE: MAILBOX_FILE } });
  await Promise.all([
    waitHttp(`http://127.0.0.1:${ports.worker}/ready`, { label: "worker /ready", timeoutMs: 120_000, alive: worker.alive }),
    waitHttp(`http://127.0.0.1:${ports.api}/health`, { label: "API /health", timeoutMs: 180_000, alive: api.alive }),
  ]);
  await waitHttp(`http://127.0.0.1:${ports.api}/ready`, { label: "API /ready", timeoutMs: 120_000, alive: api.alive });
  mark("api+worker", t);

  if (!flags.get("no-web")) {
    t = Date.now();
    step("Web (Next.js en mode développement : fiable sous Windows, première visite de chaque page plus lente)");
    const web = launch("web", process.execPath, [resolve(ROOT, "apps", "web", "node_modules", "next", "dist", "bin", "next"), "dev", "--turbo", "-p", String(ports.web), "-H", "127.0.0.1"], {
      cwd: resolve(ROOT, "apps", "web"),
      env: webEnv({ secrets, ports, defaultTenantSlug: DEFAULT_TENANT }),
    });
    await waitHttp(`http://127.0.0.1:${ports.web}/api/health`, { label: "web /api/health", timeoutMs: 300_000, alive: web.alive });
    // Préchauffage : compile la page de connexion (la première compilation prend quelques secondes).
    await fetch(`http://127.0.0.1:${ports.web}/v2/login`, { signal: AbortSignal.timeout(180_000) }).catch(() => undefined);
    mark("web", t);
  }

  writeState({ running: true, startedAt: new Date().toISOString(), timings });
  const total = Math.round((Date.now() - startedAt) / 1000);
  printSummary(ports, secrets, total, timings);

  if (flags.get("detach")) {
    out("\nMode --detach : la pile reste active en arrière-plan. Arrêt : `pnpm demo:down`.");
    return;
  }
  out("\nCtrl+C pour arrêter proprement la démonstration (les données sont conservées).");
  await new Promise((resolveWait) => {
    const stop = () => resolveWait();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const timer = setInterval(() => {
      const pids = readPids();
      if (!isAlive(pids.api) || !isAlive(pids.worker)) {
        out("\nUn processus essentiel s'est arrêté (voir .demo/logs/).");
        clearInterval(timer);
        resolveWait();
      }
    }, 3000);
  });
  await down();
}

function printSummary(ports, secrets, total, timings) {
  const web = `http://localhost:${ports.web}`;
  out("\n" + "=".repeat(78));
  out(` Démonstration prête en ${total} s  (${Object.entries(timings).map(([k, v]) => `${k} ${v}s`).join(", ")})`);
  out("=".repeat(78));
  out(` Ouvrir               : ${web}/v2/login   (établissement par défaut : ${DEFAULT_TENANT})`);
  for (const tn of TENANTS) out(`   ${tn.slug.padEnd(16)} : http://${tn.slug}.localhost:${ports.web}/v2/login`);
  out(` Console plateforme   : ${web}/v2/platform/login`);
  out(` API                  : http://127.0.0.1:${ports.api}   (/health, /ready)`);
  out(` Comptes et mots de passe : ${CREDENTIALS_MD}`);
  out(` Code MFA courant     : pnpm demo:totp <e-mail>        Journaux : ${LOG_DIR}`);
  out(` Boîte aux lettres locale (aucun e-mail réel) : ${MAILBOX_FILE}`);
  out("");
  out(" Rôle                              Ce qu'il peut tester");
  out(" " + "-".repeat(76));
  for (const role of ROLE_ORDER) {
    const g = ROLE_GUIDE[role];
    out(` ${(g.label + (g.mfa ? " (MFA)" : "")).padEnd(33)} ${g.tests}`);
  }
  out(` ${PLATFORM_GUIDE.label.padEnd(33)} ${PLATFORM_GUIDE.tests}`);
  out("");
  out(" Règles de calcul : jeux de DÉMONSTRATION (placeholder), jamais des règles officielles ; le bandeau « règles de démonstration »");
  out(" s'affiche sur les écrans concernés. Aucun envoi réel (e-mail, SMS, WhatsApp) ; paiements en fournisseur SANDBOX uniquement.");
}

async function down() {
  step("Arrêt des processus (web, API, worker)");
  const stopped = stopAll();
  out(`  arrêtés : ${stopped.length > 0 ? stopped.join(", ") : "aucun"}`);
  if (dk.dockerAvailable()) {
    step("Arrêt des conteneurs de démonstration (volumes conservés)");
    for (const name of dk.DEMO_CONTAINERS) {
      if (dk.containerState(name) === "running") {
        const r = dk.stopContainer(name);
        out(`  ${name} : ${r.status === 0 ? "arrêté" : `échec (${r.stderr})`}`);
      }
    }
  }
  writeState({ running: false });
  out("\nDémonstration arrêtée. Les données sont conservées : `pnpm demo:up` les retrouve ; `pnpm demo:reset` les supprime.");
}

async function reset() {
  out("Réinitialisation de la démonstration (ressources ed-demo-* uniquement)");
  stopAll();
  if (dk.dockerAvailable()) {
    for (const name of dk.DEMO_CONTAINERS) {
      if (dk.containerState(name) !== "absent") out(`  suppression du conteneur ${name} : ${dk.removeContainer(name).status === 0 ? "ok" : "échec"}`);
    }
    for (const name of dk.DEMO_VOLUMES) {
      if (dk.volumeExists(name)) out(`  suppression du volume ${name} : ${dk.removeVolume(name).status === 0 ? "ok" : "échec"}`);
    }
  } else {
    out("  Docker indisponible : conteneurs et volumes non supprimés.");
  }
  wipeDemoDir();
  out("  dossier .demo/ supprimé (secrets, identifiants, journaux, objets).");
  out("\nÉtat neuf. `pnpm demo:up` recrée tout avec de nouveaux secrets et de nouveaux mots de passe.");
}

/** Développement du seed : `pnpm demo:seed -- --packs SECONDARY --suffix -d1` crée des établissements supplémentaires (autres slugs), sans toucher aux comptes. */
async function seedDev({ flags }) {
  preflight();
  ensureDirs();
  const { secrets } = loadOrCreateSecrets();
  const ports = readState().ports ?? (await choosePorts(flags));
  await ensureContainers(secrets, ports);
  const mig = runTsSync("migrate", "scripts/demo/migrate.ts", { DEMO_MIGRATOR_URL: pgUrl("postgres", secrets.pgSuperPassword, ports.pg), DEMO_APP_ROLE: APP_ROLE, DEMO_APP_ROLE_PASSWORD: secrets.appRolePassword });
  if (mig.status !== 0) die(`migrations en échec :\n${mig.text.slice(-1500)}`);
  const env = {
    ...platformEnv({ secrets, ports }),
    ALLOW_SEED: "1",
    DEMO_CREDENTIALS_JSON: resolve(DEMO_DIR, "credentials-dev.json"),
    DEMO_IMPORT_DIR: IMPORT_DIR,
    DEMO_SEED_PACKS: String(flags.get("packs") ?? ""),
    DEMO_SEED_SLUG_SUFFIX: String(flags.get("suffix") ?? "-dev"),
    LOG_LEVEL: "warn",
  };
  const r = spawnSync(process.execPath, [resolve(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/demo/seed.ts"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, TSX_TSCONFIG_PATH: API_TSCONFIG, ...env }, windowsHide: true });
  process.exit(r.status ?? 1);
}

/** `pnpm demo:restart-web` : relance seulement le serveur web (variables d'environnement du web modifiées). */
async function restartWeb() {
  const state = readState();
  const secrets = loadSecrets();
  if (!state.ports || !secrets) die("La démonstration n'est pas initialisée.");
  const pids = readPids();
  if (isAlive(pids.web)) killTree(pids.web);
  const web = launch("web", process.execPath, [resolve(ROOT, "apps", "web", "node_modules", "next", "dist", "bin", "next"), "dev", "--turbo", "-p", String(state.ports.web), "-H", "127.0.0.1"], {
    cwd: resolve(ROOT, "apps", "web"),
    env: webEnv({ secrets, ports: state.ports, defaultTenantSlug: DEFAULT_TENANT }),
  });
  await waitHttp(`http://127.0.0.1:${state.ports.web}/api/health`, { label: "web /api/health", timeoutMs: 300_000, alive: web.alive });
  out("Web relancé.");
}

function status() {
  const state = readState();
  const pids = readPids();
  out("Démonstration EcoleDigitale");
  for (const name of dk.DEMO_CONTAINERS) out(`  conteneur ${name} : ${dk.dockerAvailable() ? dk.containerState(name) : "Docker indisponible"}`);
  for (const [name, pid] of Object.entries(pids)) out(`  processus ${name} (pid ${pid}) : ${isAlive(pid) ? "actif" : "arrêté"}`);
  if (state.ports) out(`  ports : ${JSON.stringify(state.ports)}`);
  out(`  données : ${state.seeded ? `prêtes (depuis ${state.seededAt})` : "absentes"}`);
  if (state.ports) out(`  URL : http://localhost:${state.ports.web}/v2/login`);
}

function totp(rest) {
  const creds = readCredentials();
  if (!creds) die("Aucun compte : lancez `pnpm demo:up` d'abord.");
  const [a, b] = rest;
  if (!a) die("Usage : pnpm demo:totp <e-mail>   ou   pnpm demo:totp <etablissement> <role>");
  const found = creds.accounts.filter((c) => (b ? c.tenant === a && c.role === b : c.email === a.toLowerCase()));
  if (found.length === 0) die(`Compte introuvable. Comptes avec MFA : ${creds.accounts.filter((c) => c.totpSecret).map((c) => `${c.tenant}/${c.role}`).join(", ")}`);
  const withTotp = found.filter((c) => c.totpSecret);
  if (withTotp.length === 0) die(`Le compte ${found[0].email} n'a pas de MFA : aucun code n'est demandé à la connexion.`);
  for (const c of withTotp) out(`${totpAt(c.totpSecret)}  (${c.tenant} / ${c.role} / ${c.email}) : valide encore ${secondsLeft()} s ; un code ne sert qu'une fois`);
}

function smoke(rest) {
  const state = readState();
  if (!state.ports || !state.running) die("La démonstration n'est pas démarrée : lancez `pnpm demo:up` (ou `pnpm demo:up -- --detach`).");
  const secrets = loadSecrets();
  const r = spawnSync(process.execPath, [resolve(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/demo/smoke.ts", ...rest], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, TSX_TSCONFIG_PATH: API_TSCONFIG, DEMO_API_URL: `http://127.0.0.1:${state.ports.api}`, DEMO_WEB_URL: `http://127.0.0.1:${state.ports.web}`, DEMO_CREDENTIALS_JSON: CREDENTIALS_JSON, DEMO_OPERATOR_EMAIL: secrets.operatorEmail, DEMO_OPERATOR_PASSWORD: secrets.operatorPassword },
    windowsHide: true,
  });
  process.exit(r.status ?? 1);
}

const [command, ...argv] = process.argv.slice(2);
const parsed = parseFlags(argv);
switch (command) {
  case "up":
    await up(parsed);
    break;
  case "down":
    await down();
    break;
  case "reset":
    await reset();
    break;
  case "status":
    status();
    break;
  case "seed":
    await seedDev(parsed);
    break;
  case "restart-web":
    await restartWeb();
    break;
  case "totp":
    totp(parsed.rest);
    break;
  case "smoke":
    smoke(argv);
    break;
  default:
    out("Usage : pnpm demo:up | demo:down | demo:reset | demo:status | demo:totp <e-mail> | demo:smoke");
    process.exit(command ? 2 : 0);
}
