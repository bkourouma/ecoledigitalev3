/**
 * PREUVE de la découverte en PRODUCTION : les modules sont embarqués à la construction du bundle du worker.
 *
 *   1. build réel (`apps/worker/scripts/build.mjs`, dossiers de modules PAR DÉFAUT = les vrais modules) ;
 *   2. démarrage réel du bundle (`node dist/index.cjs`, sans TypeScript ni node_modules du monorepo) sur une base
 *      migrée par le runner de la plateforme (baseline + worker + tous les modules) ;
 *   3. le journal de démarrage liste les abonnés et jobs des modules ; un événement `tenancy.tenant.provisioned`
 *      écrit dans l'outbox est relayé, puis traité par les abonnés EMBARQUÉS (rôles système, essai, audit chaîné
 *      en HMAC avec la clé de l'environnement du worker).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgOutboxWriter, TenantDb } from "@ecoledigitale/database";
import { createDomainEvent, createSystemContext, newId, noopLogger } from "@ecoledigitale/kernel";
import { Pool } from "pg";
import { createLoginRole } from "../../src/platform/v2-login-role";
import { runV2Migrations } from "../../src/platform/v2-migrations";
import { createEphemeralDb, describeIntegration, randomSuffix, type EphemeralDb } from "../helpers/fixtures";
import { REDIS_URL, waitFor } from "./support/harness";

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

describeIntegration.skipIf(!REDIS_URL)("bundle de production du worker : build + démarrage réels avec les vrais modules", () => {
  let dist: string;
  let db: EphemeralDb;
  let child: ChildProcess | undefined;
  let pool: Pool;
  const logs: string[] = [];
  const role = `ed_wb_${randomSuffix()}`;
  const prefix = `wb${randomSuffix()}`;
  let buildOutput = "";
  let port = 0;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "ed-worker-real-dist-"));
    const build = spawnSync(process.execPath, [join(WORKER_ROOT, "scripts/build.mjs")], {
      cwd: WORKER_ROOT,
      encoding: "utf8",
      env: { ...process.env, WORKER_BUILD_OUTDIR: dist, WORKER_MODULES_DIRS: "" },
    });
    if (build.status !== 0) throw new Error(`build échoué :\n${build.stdout}\n${build.stderr}`);
    buildOutput = build.stdout;

    db = await createEphemeralDb("wb_test", [role]);
    await runV2Migrations({ url: db.adminUrl, logger: noopLogger });
    const appUrl = (await createLoginRole({ adminUrl: db.adminUrl, role })).applicationUrl;
    pool = new Pool({ connectionString: appUrl, max: 4 });

    port = await freePort();
    child = spawn(process.execPath, [join(dist, "index.cjs")], {
      cwd: dist, // aucun accès au monorepo : le bundle est autonome
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
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d: Buffer) => logs.push(...d.toString().split("\n").filter(Boolean)));
    child.stderr?.on("data", (d: Buffer) => logs.push(...d.toString().split("\n").filter(Boolean)));
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/ready`).then((r) => r.status).catch(() => 0)) === 200, {
      label: "le worker (bundle) est prêt",
      timeoutMs: 60_000,
    });
  }, 300_000);

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

  it("le build embarque les modules qui déclarent des abonnés ou des jobs", () => {
    for (const expected of ["audit[subscribers,jobs]", "entitlements[subscribers]", "finance[jobs]", "iam[jobs]", "rbac[subscribers]"]) {
      expect(buildOutput, expected).toContain(expected);
    }
  });

  it("le démarrage du bundle charge les abonnés et jobs EMBARQUÉS (source « bundle », aucun scan du disque)", () => {
    const line = logs.map((l) => safeJson(l)).find((l) => l?.msg === "extensions des modules chargées");
    expect(line, logs.slice(-5).join("\n")).toBeDefined();
    expect(line.source).toBe("bundle");
    expect(line.modules).toEqual(expect.arrayContaining(["audit", "entitlements", "finance", "iam", "rbac"]));
    expect(line.subscribers).toEqual(expect.arrayContaining(["rbac.instantiate-system-roles", "entitlements.start-trial", "audit.tenancy", "audit.iam-mfa"]));
    expect(line.jobs).toEqual(expect.arrayContaining(["audit.ensure-partitions", "audit.detach-expired-partitions", "finance.mark-overdue-invoices", "iam.purge-expired-data"]));
  });

  it("le bundle enregistre TOUS les abonnés et jobs des modules (parité avec la découverte sur les sources) et branche les ports entre modules", async () => {
    const { discoverModuleExtensions, defaultModuleDirs } = await import("../../../worker/src/discovery/discover");
    const source = await discoverModuleExtensions({ dirs: defaultModuleDirs(WORKER_ROOT) });
    expect(source.subscribers.length, "les modules déclarent des abonnés").toBeGreaterThan(20);
    expect(source.jobs.length, "les modules déclarent des jobs").toBeGreaterThan(10);

    const line = logs.map((l) => safeJson(l)).find((l) => l?.msg === "extensions des modules chargées");
    expect(line, logs.slice(-5).join("\n")).toBeDefined();
    const missingSubscribers = source.subscribers.map((x) => x.definition.name).filter((n) => !line.subscribers.includes(n));
    const missingJobs = source.jobs.map((x) => x.definition.name).filter((n) => !line.jobs.includes(n));
    expect(missingSubscribers, "abonnés absents du bundle").toEqual([]);
    expect(missingJobs, "jobs absents du bundle").toEqual([]);
    expect(line.modules).toEqual(expect.arrayContaining(source.modules));

    // Les adaptateurs de ports sont embarqués et branchés AVANT les consommateurs (sinon `*.port_unavailable`).
    expect(logs.some((l) => safeJson(l)?.msg === "ports entre modules branchés (adaptateurs de plateforme)"), logs.slice(-8).join("\n")).toBe(true);
    expect(logs.some((l) => safeJson(l)?.msg?.includes("aucun adaptateur de ports"))).toBe(false);
  });

  it("un événement de l'outbox est relayé puis traité par les abonnés embarqués (rôles, essai, audit chaîné en HMAC)", async () => {
    const tenantId = newId();
    await db.admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [tenantId, `wb-${randomSuffix()}`, "Tenant bundle"]);
    // Le profil / l'établissement n'existent pas : seuls l'événement et ses consommateurs sont éprouvés ici.
    const ctx = createSystemContext(tenantId);
    const event = createDomainEvent({
      type: "tenancy.tenant.provisioned",
      ctx,
      payload: {
        v: 1,
        tenantId,
        slug: "wb-tenant",
        name: "Tenant bundle",
        countryCode: "CI",
        packs: ["HIGHER"],
        institutionIds: [newId()],
        adminContact: { name: "Awa Koné", email: "awa@bundle.test" },
      },
    });
    await new TenantDb(pool).run(ctx, (tx) => new PgOutboxWriter(tx).append([event]));

    await waitFor(
      async () => {
        const roles = await db.admin.query("SELECT count(*)::int AS n FROM rbac.roles WHERE tenant_id = $1 AND is_system", [tenantId]);
        const subs = await db.admin.query("SELECT plan_key, status FROM entitlements.tenant_subscriptions WHERE tenant_id = $1", [tenantId]);
        const auditRows = await db.admin.query("SELECT hash_alg FROM audit.audit_log WHERE tenant_id = $1 AND id = $2", [tenantId, event.id]);
        return roles.rows[0].n === 11 && subs.rows.length === 1 && auditRows.rows.length === 1 ? { subs: subs.rows[0], alg: auditRows.rows[0].hash_alg } : false;
      },
      { label: "effets des abonnés embarqués", timeoutMs: 60_000 },
    ).then((r) => {
      expect(r.subs).toMatchObject({ plan_key: "STARTER", status: "TRIALING" });
      expect(r.alg).toBe("hmac-sha256");
    });
    const published = await db.admin.query("SELECT published_at FROM kernel.domain_events WHERE id = $1", [event.id]);
    expect(published.rows[0].published_at).not.toBeNull();
  });
});

function safeJson(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
