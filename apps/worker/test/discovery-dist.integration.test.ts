import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Queue } from "bullmq";
import { DiscoveryError } from "../src/discovery/discover";
import { DOMAIN_EVENTS_QUEUE } from "../src/events/publisher";
import type { WorkerApp } from "../src/app";
import { WORKER_ROOT, createTestEnv, describeIntegration, waitFor, writeEvents, type TestEnv } from "./helpers";

const FIXTURES = resolve(WORKER_ROOT, "test/fixtures/modules");
const BAD_FIXTURES = resolve(WORKER_ROOT, "test/fixtures/bad-modules");

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => res(port));
    });
  });
}

describeIntegration("découverte des modules et exécution du bundle de production", () => {
  let env: TestEnv;
  let distDir: string;
  const apps: WorkerApp[] = [];
  const children: ChildProcess[] = [];

  beforeAll(async () => {
    env = await createTestEnv(3);
    await env.admin.query(`
      CREATE TABLE public.wk_effects (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES kernel.tenants (id),
        event_id uuid NOT NULL,
        subscriber text NOT NULL
      );
      SELECT kernel.enable_tenant_rls('public.wk_effects');
      GRANT SELECT, INSERT ON public.wk_effects TO app_user;
    `);
    // Build RÉEL du bundle, avec le module de démonstration embarqué.
    distDir = mkdtempSync(join(tmpdir(), "ed-worker-dist-"));
    const build = spawnSync(process.execPath, [join(WORKER_ROOT, "scripts/build.mjs")], {
      cwd: WORKER_ROOT,
      encoding: "utf8",
      env: { ...process.env, WORKER_MODULES_DIRS: FIXTURES, WORKER_BUILD_OUTDIR: distDir },
    });
    if (build.status !== 0) throw new Error(`build échoué :\n${build.stdout}\n${build.stderr}`);
    expect(build.stdout).toContain("demo[subscribers,jobs]");
  }, 120_000);

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.stop("test");
    for (const child of children.splice(0)) child.kill("SIGKILL");
    await env.admin.query("TRUNCATE kernel.domain_events, kernel.processed_events, public.wk_effects");
    await env.flushRedis();
  });

  afterAll(async () => {
    await env.drop();
    rmSync(distDir, { recursive: true, force: true });
  });

  const effects = async (): Promise<number> => (await env.admin.query("SELECT count(*)::int AS n FROM public.wk_effects")).rows[0].n;

  it("découvre modules/*/subscribers.ts et jobs.ts sans fichier central (mode développement)", async () => {
    const app = env.app({ moduleDirs: [FIXTURES], skipBuiltinJobs: true }, { WORKER_RELAY_ENABLED: "true" });
    apps.push(app);
    await app.start();
    expect(app.registry.all().map((s) => s.name)).toEqual(["demo.record"]);
    expect(app.scheduler?.jobNames).toEqual(["demo-job"]);

    await writeEvents(env, env.tenants[0] as never, 3, "demo.thing.happened");
    await writeEvents(env, env.tenants[1] as never, 2, "other.thing.happened"); // sans abonné : ignoré
    await waitFor(async () => (await effects()) === 3, { label: "3 effets du module de démonstration" });
  });

  it("un module invalide fait ÉCHOUER le démarrage en nommant le module", async () => {
    const app = env.app({ moduleDirs: [BAD_FIXTURES], skipBuiltinJobs: true });
    const error = await app.start().then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(DiscoveryError);
    expect((error as Error).message).toMatch(/broken/);
    expect((error as Error).message).toMatch(/handler manquant/);
  });

  /** Lance `node <dist>/index.cjs` (le vrai artefact de production) et attend /ready. */
  async function startDist(extra: Record<string, string> = {}): Promise<{ child: ChildProcess; logs: Array<Record<string, any>>; port: number; exited: Promise<number | null> }> {
    const port = await freePort();
    const child = spawn(process.execPath, [join(distDir, "index.cjs")], {
      cwd: tmpdir(), // loin du dépôt : prouve que le bundle est autonome
      env: {
        PATH: process.env.PATH ?? "",
        ...env.env({ LOG_LEVEL: "info", WORKER_HTTP_PORT: String(port), WORKER_RELAY_BATCH_SIZE: "50", ...extra }),
        // Aucun dossier de modules : seuls les modules EMBARQUÉS au build doivent être vus.
        WORKER_MODULES_DIRS: join(tmpdir(), "does-not-exist"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    const logs: Array<Record<string, any>> = [];
    let buffer = "";
    child.stdout?.on("data", (d: Buffer) => {
      buffer += d.toString();
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try {
          logs.push(JSON.parse(line));
        } catch {
          /* ligne non JSON */
        }
      }
    });
    const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/ready`).catch(() => null))?.status === 200, { label: "dist prêt (/ready)", timeoutMs: 30_000, intervalMs: 100 });
    return { child, logs, port, exited };
  }

  it("`node dist/index.cjs` démarre, embarque les modules, sert /health et /ready", async () => {
    const { logs, port } = await startDist();
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    const loaded = logs.find((l) => l.msg === "extensions des modules chargées");
    expect(loaded).toMatchObject({ source: "bundle", modules: ["demo"], subscribers: ["demo.record"] });
    expect(loaded?.jobs).toEqual(expect.arrayContaining(["outbox-cleanup", "ensure-partitions", "demo-job"]));
    expect(logs.find((l) => /rôle applicatif vérifié/.test(l.msg ?? ""))).toBeTruthy();

    await writeEvents(env, env.tenants[2] as never, 4, "demo.thing.happened");
    await waitFor(async () => (await effects()) === 4, { label: "le bundle traite les événements du module embarqué" });
  });

  it("le bundle refuse de démarrer avec un SUPERUSER (code de sortie non nul, message explicite)", async () => {
    const port = await freePort();
    const result = spawnSync(process.execPath, [join(distDir, "index.cjs")], {
      cwd: tmpdir(),
      encoding: "utf8",
      timeout: 30_000,
      env: { PATH: process.env.PATH ?? "", ...env.env({ WORKER_DATABASE_URL: env.adminUrl, LOG_LEVEL: "info", WORKER_HTTP_PORT: String(port) }) },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/SUPERUSER/);
    expect(result.stdout).not.toContain(new URL(env.adminUrl).password);
  });

  it("le bundle refuse une configuration invalide (code 78) sans afficher les valeurs", () => {
    const result = spawnSync(process.execPath, [join(distDir, "index.cjs")], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", REDIS_URL: "pas-une-url" },
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toMatch(/WORKER_DATABASE_URL : variable obligatoire absente/);
    expect(result.stderr).toMatch(/REDIS_URL/);
  });

  it("process tué (SIGKILL) au milieu de 1 000 événements, puis redémarré : aucune perte, aucun doublon d'effet", async () => {
    const a = await startDist();
    const written = (
      await Promise.all(env.tenants.map((t, i) => writeEvents(env, t, i === 2 ? 334 : 333, "demo.thing.happened")))
    ).flat();
    expect(written).toHaveLength(1000);

    await waitFor(async () => (await effects()) >= 100, { label: "au moins 100 effets avant le crash", intervalMs: 5, timeoutMs: 60_000 });
    a.child.kill("SIGKILL"); // pas d'arrêt gracieux : pertes éventuelles de jobs en vol, verrous Postgres relâchés par la déconnexion
    await a.exited;
    const atCrash = await effects();
    expect(atCrash).toBeLessThan(1000);

    const b = await startDist();
    await waitFor(async () => (await effects()) === 1000, { label: "1000 effets après redémarrage", timeoutMs: 120_000 });
    const distinct = await env.admin.query("SELECT count(DISTINCT event_id)::int AS d FROM public.wk_effects");
    expect(distinct.rows[0].d).toBe(1000); // pas de doublon (idempotence), pas de perte

    // Toutes les lignes d'outbox sont publiées ; la file ne contient que des ids d'événements écrits.
    await waitFor(async () => (await env.admin.query("SELECT count(*)::int AS n FROM kernel.domain_events WHERE published_at IS NULL")).rows[0].n === 0, { label: "outbox vidée" });
    const q = new Queue(DOMAIN_EVENTS_QUEUE, { connection: env.redis, prefix: env.prefix });
    const jobs = await q.getJobs(["waiting", "active", "delayed", "completed", "failed"], 0, -1);
    await q.close();
    expect(new Set(jobs.map((j) => String(j.id)))).toEqual(new Set(written.map((e) => e.id)));
    console.log(`[crash du bundle] SIGKILL après ${atCrash}/1000 effets ; redémarrage -> 1000/1000, 0 doublon`);

    if (process.platform !== "win32") {
      b.child.kill("SIGTERM"); // sous Windows, kill() ne délivre pas de signal interceptable : arrêt gracieux couvert en-process
      expect(await b.exited).toBe(0);
      expect(b.logs.some((l) => l.msg === "worker arrêté")).toBe(true);
    }
  }, 240_000);
});
