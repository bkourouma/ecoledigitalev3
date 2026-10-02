/**
 * Imports exécutés par le VRAI worker de production (bundle esbuild construit puis démarré en processus séparé, sur Postgres
 * et Redis réels) : validation et import asynchrones par les abonnés `imports.validate` et `imports.run` (outbox -> relais ->
 * BullMQ), REPRISE après un `SIGKILL` du worker en plein import (aucun doublon, aucune ligne perdue, lots atomiques),
 * rejeu idempotent, annulation en cours d'exécution, mémoire du processus worker.
 *
 *   node ../worker/scripts/with-infra.mjs test/imports        (Postgres 17 + Redis 7 éphémères dans Docker)
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SystemDb, TenantDb } from "@ecoledigitale/database";
import { createRequestContext, newId, noopLogger, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { cancelImportJob, createImportsDeps, requestImportRun, requestImportValidation, setImportMapping, uploadImportFile, type ImportsDeps } from "../../src/modules/imports";
import { buildPlatformPorts, createAdapterKit } from "../../src/platform/adapters";
import { createLoginRole } from "../../src/platform/v2-login-role";
import { runV2Migrations } from "../../src/platform/v2-migrations";
import { MemoryStorage } from "../../src/modules/imports/test/support/world";
import { csvOf, STUDENT_HEADERS, studentRows } from "../../src/modules/imports/test/support/files";
import { createEphemeralDb, describeIntegration, randomSuffix, type EphemeralDb } from "../helpers/fixtures";
import { REDIS_URL, waitFor } from "../phase1/support/harness";

const here = dirname(fileURLToPath(import.meta.url));
const WORKER_ROOT = resolve(here, "../../../worker");

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

/** Mémoire résidente (Mo) d'un processus, sans dépendance : `tasklist` (Windows) ou `/proc` (Linux). */
function rssMb(pid: number): number | null {
  try {
    if (process.platform === "win32") {
      const r = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
      const last = r.stdout.trim().split(/\r?\n/).pop() ?? "";
      const m = /"([^"]*)"\s*$/.exec(last);
      const kb = m ? Number((m[1] as string).replace(/[^\d]/g, "")) : 0;
      return kb > 0 ? Math.round(kb / 1024) : null;
    }
    const r = spawnSync("sh", ["-c", `awk '/VmRSS/ {print $2}' /proc/${pid}/status`], { encoding: "utf8" });
    return r.stdout.trim() ? Math.round(Number(r.stdout.trim()) / 1024) : null;
  } catch {
    return null;
  }
}

describeIntegration.skipIf(!REDIS_URL)("imports par le worker de production (bundle réel, Postgres et Redis réels)", () => {
  let dist: string;
  let db: EphemeralDb;
  let pool: Pool;
  let tenantDb: TenantDb;
  let deps: ImportsDeps;
  let ctx: RequestContext;
  let tenantId: string;
  let appUrl: string;
  let child: ChildProcess | undefined;
  const logs: string[] = [];
  const role = `ed_iw_${randomSuffix()}`;
  const prefix = `iw${randomSuffix()}`;
  const viewer = { manage: true };
  let port = 0;

  async function startWorker(): Promise<ChildProcess> {
    port = await freePort();
    const proc = spawn(process.execPath, [join(dist, "index.cjs")], {
      cwd: dist,
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
        NODE_ENV: "test",
        LOG_LEVEL: "info",
        REDIS_URL: REDIS_URL as string,
        WORKER_DATABASE_URL: appUrl,
        WORKER_HTTP_HOST: "127.0.0.1",
        WORKER_HTTP_PORT: String(port),
        WORKER_QUEUE_PREFIX: prefix,
        WORKER_RELAY_SWEEP_INTERVAL_MS: "500",
        WORKER_RELAY_POLL_INTERVAL_MS: "100",
        AUDIT_HMAC_KEY: randomBytes(16).toString("hex"),
        // Reprise rapide pour les tests : bail court, battement fréquent, filet réactif.
        IMPORTS_LEASE_SECONDS: "6",
        IMPORTS_HEARTBEAT_MS: "500",
        IMPORTS_STALE_AFTER_SECONDS: "4",
        STORAGE_DISK_DIR: join(dist, "objects"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout?.on("data", (d: Buffer) => logs.push(...d.toString().split("\n").filter(Boolean)));
    proc.stderr?.on("data", (d: Buffer) => logs.push(...d.toString().split("\n").filter(Boolean)));
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/ready`).then((r) => r.status).catch(() => 0)) === 200, { label: "le worker (bundle) est prêt", timeoutMs: 90_000 });
    return proc;
  }

  const count = async (sql: string, params: unknown[] = []): Promise<number> => Number((await db.admin.query(sql, params)).rows[0].n);
  const jobStatus = async (id: string): Promise<string> => (await db.admin.query(`SELECT status FROM imports.jobs WHERE id = $1`, [id])).rows[0].status as string;

  async function prepare(bytes: Uint8Array, name: string): Promise<string> {
    const up = unwrap(await uploadImportFile(deps, ctx, { importerKey: "students", fileName: name, bytes }));
    unwrap(await setImportMapping(deps, ctx, up.job.id, { mapping: up.suggestedMapping, runMode: "VALID_ONLY", onExisting: "SKIP" }, viewer));
    unwrap(await requestImportValidation(deps, ctx, up.job.id, viewer));
    try {
      await waitFor(async () => (await jobStatus(up.job.id)) === "VALIDATED", { label: `validation de ${name} par le worker`, timeoutMs: 240_000, intervalMs: 250 });
    } catch (e) {
      const j = (await db.admin.query(`SELECT status, error_code, error_message, lease_owner, lease_until, run_attempts, valid_rows, invalid_rows FROM imports.jobs WHERE id = $1`, [up.job.id])).rows[0];
      throw new Error(`${(e as Error).message} ; état : ${JSON.stringify(j)} ; journaux du worker : ${logs.slice(-12).join(" | ")}`);
    }
    return up.job.id;
  }
  async function launch(id: string): Promise<void> {
    unwrap(await requestImportRun(deps, ctx, id, { runMode: "VALID_ONLY", onExisting: "SKIP", confirm: true }, viewer));
  }

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "ed-imports-worker-"));
    const build = spawnSync(process.execPath, [join(WORKER_ROOT, "scripts/build.mjs")], { cwd: WORKER_ROOT, encoding: "utf8", env: { ...process.env, WORKER_BUILD_OUTDIR: dist, WORKER_MODULES_DIRS: "" } });
    if (build.status !== 0) throw new Error(`build échoué :\n${build.stdout}\n${build.stderr}`);
    expect(build.stdout).toContain("imports[subscribers,jobs]");

    db = await createEphemeralDb("iw_test", [role]);
    await runV2Migrations({ url: db.adminUrl, logger: noopLogger });
    appUrl = (await createLoginRole({ adminUrl: db.adminUrl, role })).applicationUrl;
    pool = new Pool({ connectionString: appUrl, max: 6 });
    tenantDb = new TenantDb(pool);
    const systemDb = new SystemDb(tenantDb, { logger: noopLogger });
    tenantId = newId();
    await db.admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [tenantId, `iw-${tenantId.slice(-8)}`, "École du worker"]);
    ctx = createRequestContext({ tenantId, userId: newId(), roles: ["directeur"], mfa: true });
    const kit = createAdapterKit({ tenantDb, systemDb, logger: noopLogger, env: {} });
    const ports = buildPlatformPorts(kit, null, {}, {});
    deps = createImportsDeps({ db: tenantDb, ports: { targets: ports.imports.targets as never, storage: new MemoryStorage() } });
    child = await startWorker();
  }, 400_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 300));
    }
    await pool?.end().catch(() => undefined);
    if (db) {
      const { Redis } = await import("ioredis");
      const redis = new Redis(REDIS_URL as string, { maxRetriesPerRequest: 1 });
      try {
        for await (const keys of redis.scanStream({ match: `${prefix}:*`, count: 500 }) as AsyncIterable<string[]>) if (keys.length) await redis.del(...keys);
      } finally {
        await redis.quit().catch(() => undefined);
      }
      await db.drop();
    }
    rmSync(dist, { recursive: true, force: true });
  });

  it("le bundle embarque les abonnés et jobs du module imports", () => {
    const line = logs.map((l) => safeJson(l)).find((l) => l?.msg === "extensions des modules chargées");
    expect(line?.subscribers).toEqual(expect.arrayContaining(["imports.validate", "imports.run"]));
    expect(line?.jobs).toEqual(expect.arrayContaining(["imports.resume-stalled", "imports.purge"]));
  });

  it("validation et import par le worker, mémoire du worker bornée, rejeu idempotent", async () => {
    const bytes = csvOf([STUDENT_HEADERS, ...studentRows(400, "W")]);
    const rssStart = rssMb((child as ChildProcess).pid as number);
    let rssPeak = rssStart ?? 0;
    const sampler = setInterval(() => {
      const m = rssMb((child as ChildProcess).pid as number);
      if (m && m > rssPeak) rssPeak = m;
    }, 1500);
    const t0 = Date.now();
    const id = await prepare(bytes, "eleves-400.csv");
    const validationMs = Date.now() - t0;
    expect((await db.admin.query(`SELECT valid_rows, planned_create FROM imports.jobs WHERE id = $1`, [id])).rows[0]).toMatchObject({ valid_rows: 400, planned_create: 400 });
    expect(await count(`SELECT count(*) AS n FROM people.students WHERE external_ref LIKE 'TW-%'`)).toBe(0); // la validation n'écrit rien
    const t1 = Date.now();
    await launch(id);
    await waitFor(async () => (await jobStatus(id)) === "COMPLETED", { label: "import terminé par le worker", timeoutMs: 300_000, intervalMs: 250 });
    const runMs = Date.now() - t1;
    clearInterval(sampler);
    expect(await count(`SELECT count(*) AS n FROM people.students WHERE external_ref LIKE 'TW-%'`)).toBe(400);
    const job = (await db.admin.query(`SELECT created_count, failed_count, duration_ms, started_at, finished_at FROM imports.jobs WHERE id = $1`, [id])).rows[0];
    expect(job).toMatchObject({ created_count: 400, failed_count: 0 });
    expect(job.duration_ms).toBeGreaterThan(0);
    console.log(`[perf-worker] 400 lignes : validation ${validationMs} ms, import ${runMs} ms ; mémoire résidente du worker : départ ${rssStart ?? "?"} Mo, pic ${rssPeak || "?"} Mo`);
    if (rssPeak) expect(rssPeak).toBeLessThan(900);
    // l'événement de fin est relayé (l'onboarding de tenancy le consomme)
    expect(await count(`SELECT count(*) AS n FROM kernel.domain_events WHERE type = 'imports.run.completed' AND aggregate_id = $1`, [id])).toBe(1);

    // Rejeu du MÊME fichier par le worker : tout est ignoré, aucun doublon.
    const again = await prepare(bytes, "eleves-400-bis.csv");
    expect((await db.admin.query(`SELECT planned_skip, planned_create FROM imports.jobs WHERE id = $1`, [again])).rows[0]).toMatchObject({ planned_skip: 400, planned_create: 0 });
    await launch(again);
    await waitFor(async () => (await jobStatus(again)) === "COMPLETED", { label: "rejeu terminé", timeoutMs: 120_000, intervalMs: 250 });
    expect(await count(`SELECT count(*) AS n FROM people.students WHERE external_ref LIKE 'TW-%'`)).toBe(400);
    expect((await db.admin.query(`SELECT created_count, skipped_count FROM imports.jobs WHERE id = $1`, [again])).rows[0]).toMatchObject({ created_count: 0, skipped_count: 400 });
  }, 900_000);

  it("REPRISE après SIGKILL du worker en plein import : aucun doublon, aucune ligne perdue, lots atomiques", async () => {
    const rows = 700;
    const id = await prepare(csvOf([STUDENT_HEADERS, ...studentRows(rows, "K", 2000)]), "eleves-kill.csv");
    await launch(id);
    // attend qu'une partie (mais pas tout) soit écrite, puis tue le worker sans préavis
    await waitFor(async () => (await count(`SELECT count(*) AS n FROM imports.rows WHERE job_id = $1 AND outcome IS NOT NULL`, [id])) >= 150, { label: "import en cours", timeoutMs: 300_000, intervalMs: 150 });
    (child as ChildProcess).kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 500));
    const partial = await count(`SELECT count(*) AS n FROM people.students WHERE external_ref LIKE 'TK-%'`);
    const recorded = await count(`SELECT count(*) AS n FROM imports.rows WHERE job_id = $1 AND outcome IS NOT NULL`, [id]);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(rows); // interrompu pour de bon
    expect(partial).toBe(recorded); // un lot est atomique : élèves créés == résultats enregistrés, jamais à moitié
    expect(await jobStatus(id)).toBe("RUNNING");

    // Un nouveau worker reprend (bail expiré -> filet de reprise ou nouvelle livraison) et termine.
    child = await startWorker();
    try {
      await waitFor(async () => (await jobStatus(id)) === "COMPLETED", { label: "reprise et fin de l'import", timeoutMs: 300_000, intervalMs: 500 });
    } catch (e) {
      const j = (await db.admin.query(`SELECT status, error_code, error_message, lease_owner, lease_until, now() AS now, run_attempts, processed_count, created_count FROM imports.jobs WHERE id = $1`, [id])).rows[0];
      const ob = (await db.admin.query(`SELECT type, published_at FROM kernel.domain_events WHERE aggregate_id = $1 ORDER BY created_at DESC LIMIT 5`, [id])).rows;
      throw new Error(`${(e as Error).message} ; état : ${JSON.stringify(j)} ; événements : ${JSON.stringify(ob)} ; journaux : ${logs.slice(-15).join(" | ")}`);
    }
    expect(await count(`SELECT count(*) AS n FROM people.students WHERE external_ref LIKE 'TK-%'`)).toBe(rows);
    expect(await count(`SELECT count(*) AS n FROM (SELECT external_ref FROM people.students WHERE external_ref LIKE 'TK-%' GROUP BY external_ref HAVING count(*) > 1) d`)).toBe(0);
    const job = (await db.admin.query(`SELECT created_count, failed_count, processed_count, run_attempts FROM imports.jobs WHERE id = $1`, [id])).rows[0];
    expect(job).toMatchObject({ created_count: rows, failed_count: 0, processed_count: rows });
    expect(job.run_attempts).toBeGreaterThanOrEqual(2);
    expect(await count(`SELECT count(*) AS n FROM kernel.domain_events WHERE type = 'people.student.created' AND payload->>'studentId' IN (SELECT id::text FROM people.students WHERE external_ref LIKE 'TK-%')`)).toBe(rows);
    console.log(`[perf-worker] reprise après SIGKILL : ${partial} élèves déjà écrits au moment de l'arrêt, ${job.run_attempts} exécutions`);
  }, 900_000);

  it("annulation demandée pendant l'exécution par le worker : état CANCELLED, lots validés conservés", async () => {
    const rows = 600;
    const id = await prepare(csvOf([STUDENT_HEADERS, ...studentRows(rows, "A", 4000)]), "eleves-annule.csv");
    await launch(id);
    await waitFor(async () => (await count(`SELECT count(*) AS n FROM imports.rows WHERE job_id = $1 AND outcome IS NOT NULL`, [id])) >= 100, { label: "import en cours", timeoutMs: 300_000, intervalMs: 150 });
    unwrap(await cancelImportJob(deps, ctx, id, "Erreur de fichier", viewer));
    await waitFor(async () => (await jobStatus(id)) === "CANCELLED", { label: "annulation prise en compte par le worker", timeoutMs: 120_000, intervalMs: 300 });
    const written = await count(`SELECT count(*) AS n FROM people.students WHERE external_ref LIKE 'TA-%'`);
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThan(rows);
    expect(await count(`SELECT count(*) AS n FROM imports.rows WHERE job_id = $1 AND outcome IS NOT NULL`, [id])).toBe(written);
  }, 900_000);
});

function safeJson(line: string): Record<string, any> | null {
  try {
    return JSON.parse(line) as Record<string, any>;
  } catch {
    return null;
  }
}
