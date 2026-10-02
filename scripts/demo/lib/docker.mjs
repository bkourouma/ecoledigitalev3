/**
 * Docker de la démonstration. GARDE-FOU ABSOLU : toute commande qui crée, démarre, arrête ou supprime quelque chose passe par
 * `assertDemoName` : seuls les noms `ed-demo-*` sont acceptés. Aucune autre ressource Docker (conteneur, volume, réseau,
 * image) n'est jamais modifiée.
 */
import { spawnSync } from "node:child_process";

export const PG_CONTAINER = "ed-demo-pg";
export const REDIS_CONTAINER = "ed-demo-redis";
export const PG_VOLUME = "ed-demo-pgdata";
export const REDIS_VOLUME = "ed-demo-redisdata";
export const DEMO_CONTAINERS = [PG_CONTAINER, REDIS_CONTAINER];
export const DEMO_VOLUMES = [PG_VOLUME, REDIS_VOLUME];

export const PG_IMAGE = process.env.ED_DEMO_PG_IMAGE ?? "postgres:17-alpine";
export const REDIS_IMAGE = process.env.ED_DEMO_REDIS_IMAGE ?? "redis:7-alpine";
export const DB_NAME = "ed_demo_local";

const NAME_RE = /^ed-demo-[a-z0-9-]+$/;
export function assertDemoName(name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new Error(`Garde-fou : « ${String(name)} » n'est pas une ressource de démonstration (ed-demo-*). Opération refusée.`);
  }
  return name;
}

export function docker(args, { env, input } = {}) {
  const r = spawnSync("docker", args, { encoding: "utf8", env: { ...process.env, ...(env ?? {}) }, input, windowsHide: true });
  return { status: r.status ?? 1, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim(), error: r.error };
}

export function dockerAvailable() {
  const r = docker(["info", "--format", "{{.ServerVersion}}"]);
  return r.status === 0 ? r.stdout : null;
}

export function imageExists(image) {
  return docker(["image", "inspect", image, "--format", "{{.Id}}"]).status === 0;
}

/** `running` | `exited` | `created` | … | `absent`. */
export function containerState(name) {
  assertDemoName(name);
  const r = docker(["inspect", name, "--format", "{{.State.Status}}"]);
  return r.status === 0 ? r.stdout : "absent";
}

export function volumeExists(name) {
  assertDemoName(name);
  return docker(["volume", "inspect", name, "--format", "{{.Name}}"]).status === 0;
}

/** Port hôte publié par un conteneur de démonstration (ou `null`). */
export function publishedPort(name, containerPort) {
  assertDemoName(name);
  const r = docker(["inspect", name, "--format", `{{(index (index .NetworkSettings.Ports "${containerPort}/tcp") 0).HostPort}}`]);
  const n = Number(r.stdout);
  return r.status === 0 && Number.isInteger(n) ? n : null;
}

export function createPostgres({ port, password }) {
  assertDemoName(PG_CONTAINER);
  assertDemoName(PG_VOLUME);
  // `-e NOM` sans valeur : Docker lit la valeur dans l'environnement du client (le mot de passe ne figure pas dans la ligne de commande).
  return docker(
    ["run", "-d", "--name", PG_CONTAINER, "--label", "ed.demo=1", "-e", "POSTGRES_PASSWORD", "-e", `POSTGRES_DB=${DB_NAME}`, "-v", `${PG_VOLUME}:/var/lib/postgresql/data`, "-p", `127.0.0.1:${port}:5432`, "--restart", "no", PG_IMAGE],
    { env: { POSTGRES_PASSWORD: password } },
  );
}

export function createRedis({ port, password }) {
  assertDemoName(REDIS_CONTAINER);
  assertDemoName(REDIS_VOLUME);
  return docker(
    ["run", "-d", "--name", REDIS_CONTAINER, "--label", "ed.demo=1", "-v", `${REDIS_VOLUME}:/data`, "-p", `127.0.0.1:${port}:6379`, "--restart", "no", REDIS_IMAGE, "redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction", "--requirepass", password],
  );
}

export function startContainer(name) {
  return docker(["start", assertDemoName(name)]);
}
export function stopContainer(name) {
  return docker(["stop", "-t", "10", assertDemoName(name)]);
}
export function removeContainer(name) {
  return docker(["rm", "-f", assertDemoName(name)]);
}
export function removeVolume(name) {
  return docker(["volume", "rm", "-f", assertDemoName(name)]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitPostgres(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let ok = 0;
  while (Date.now() < deadline) {
    const r = docker(["exec", PG_CONTAINER, "pg_isready", "-U", "postgres", "-d", DB_NAME]);
    ok = r.status === 0 ? ok + 1 : 0;
    // L'image redémarre le serveur une fois après l'initialisation : deux succès espacés.
    if (ok >= 2) return;
    await sleep(1000);
  }
  throw new Error("Postgres n'est pas prêt après 90 s (voir `docker logs ed-demo-pg`).");
}

export async function waitRedis(password, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = docker(["exec", "-e", "REDISCLI_AUTH", REDIS_CONTAINER, "redis-cli", "ping"], { env: { REDISCLI_AUTH: password } });
    if (r.status === 0 && r.stdout === "PONG") return;
    await sleep(500);
  }
  throw new Error("Redis n'est pas prêt après 30 s (voir `docker logs ed-demo-redis`).");
}
