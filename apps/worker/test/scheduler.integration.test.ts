import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { newId } from "@ecoledigitale/kernel";
import { UnsafeDatabaseRoleError } from "../src/infra/db";
import { SCHEDULED_QUEUE } from "../src/scheduler/runtime";
import { defineScheduledJob } from "../src/sdk";
import type { WorkerApp, WorkerAppOptions } from "../src/app";
import { captureLogger, createTestEnv, describeIntegration, sleep, waitFor, type TestEnv } from "./helpers";

const QUIET = { WORKER_RELAY_ENABLED: "false", WORKER_SUBSCRIBERS_ENABLED: "false" };

describeIntegration("jobs planifiés, jobs du socle et garde-fous du démarrage (Postgres + Redis réels)", () => {
  let env: TestEnv;
  const apps: WorkerApp[] = [];
  const queues: Queue[] = [];

  beforeAll(async () => {
    env = await createTestEnv(3);
  });
  afterAll(async () => {
    await env.drop();
  });
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.stop("test");
    for (const q of queues.splice(0)) await q.close();
    await env.flushRedis();
  });

  async function startApp(options: WorkerAppOptions = {}, overrides: Record<string, string> = {}): Promise<WorkerApp> {
    const app = env.app({ skipBuiltinJobs: true, ...options }, { ...QUIET, ...overrides });
    apps.push(app);
    await app.start();
    return app;
  }

  describe("garde-fou du rôle PostgreSQL", () => {
    it("refuse de démarrer avec un SUPERUSER", async () => {
      const app = env.app({}, { ...QUIET, WORKER_DATABASE_URL: env.adminUrl });
      const error = await app.start().then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(UnsafeDatabaseRoleError);
      expect((error as Error).message).toMatch(/SUPERUSER/);
      expect(app.isReady).toBe(false);
    });

    it("refuse un rôle BYPASSRLS même membre de app_user", async () => {
      const role = `wk_bypass_${newId().slice(-8).replace(/-/g, "")}`;
      await env.admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'pw-test-1' BYPASSRLS IN ROLE app_user`);
      try {
        const u = new URL(env.appUrl);
        u.username = role;
        u.password = "pw-test-1";
        const app = env.app({}, { ...QUIET, WORKER_DATABASE_URL: u.toString() });
        await expect(app.start()).rejects.toThrow(/BYPASSRLS/);
      } finally {
        await env.admin.query(`DROP ROLE "${role}"`);
      }
    });

    it("refuse un rôle qui n'hérite pas de app_user", async () => {
      const role = `wk_plain_${newId().slice(-8).replace(/-/g, "")}`;
      await env.admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'pw-test-2'`);
      try {
        const u = new URL(env.appUrl);
        u.username = role;
        u.password = "pw-test-2";
        const app = env.app({}, { ...QUIET, WORKER_DATABASE_URL: u.toString() });
        await expect(app.start()).rejects.toThrow(/n'hérite pas de app_user/);
      } finally {
        await env.admin.query(`DROP ROLE "${role}"`);
      }
    });

    it("démarre avec un rôle membre de app_user et répond sur /health et /ready", async () => {
      const app = await startApp();
      const base = `http://127.0.0.1:${app.health?.port}`;
      expect((await fetch(`${base}/health`)).status).toBe(200);
      expect((await fetch(`${base}/ready`)).status).toBe(200);
      expect((await fetch(`${base}/nope`)).status).toBe(404);
    });
  });

  describe("planification (BullMQ repeatable + verrou d'unicité)", () => {
    it("enregistre les jobs du socle et retire les planifications orphelines", async () => {
      // Une planification dont le code a disparu.
      const q = new Queue(SCHEDULED_QUEUE, { connection: env.redis, prefix: env.prefix });
      queues.push(q);
      await q.upsertJobScheduler("ghost-job", { pattern: "0 0 * * *" }, { name: "ghost-job", data: {} });

      await startApp({ skipBuiltinJobs: false });
      const names = (await q.getJobSchedulers(0, -1, true)).map((s) => s.key ?? s.name).sort();
      expect(names).toEqual(["ensure-partitions", "outbox-cleanup"]);
    });

    it("deux instances, une planification : chaque échéance n'est exécutée qu'UNE fois, sans chevauchement", async () => {
      let running = 0;
      let maxRunning = 0;
      const startedAt: number[] = [];
      const job = defineScheduledJob({
        name: "tick",
        cron: "* * * * * *", // chaque seconde
        handler: async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          startedAt.push(Date.now());
          await sleep(1500); // plus long que la période : les échéances suivantes doivent être ignorées tant que ça tourne
          running -= 1;
        },
      });
      await Promise.all([startApp({ jobs: [job] }), startApp({ jobs: [job] })]);

      await waitFor(() => startedAt.length >= 2, { timeoutMs: 20_000, label: "au moins 2 exécutions" });
      await sleep(500);
      expect(maxRunning).toBe(1);
      // espacées d'au moins la durée du handler : jamais deux départs rapprochés (une échéance par seconde, 2 instances)
      const gaps = startedAt.slice(1).map((t, i) => t - (startedAt[i] as number));
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1400);
    });

    it("run() : le verrou d'unicité écarte une exécution concurrente du même job", async () => {
      let calls = 0;
      const job = defineScheduledJob({
        name: "slow-once",
        cron: "0 0 1 1 *",
        handler: async () => {
          calls += 1;
          await sleep(500);
        },
      });
      const app = await startApp({ jobs: [job] });
      const [a, b] = await Promise.all([app.scheduler?.run("slow-once"), app.scheduler?.run("slow-once")]);
      expect([a?.status, b?.status].sort()).toEqual(["completed", "skipped"]);
      expect(calls).toBe(1);
      // Le verrou est libéré : une exécution ultérieure passe.
      expect((await app.scheduler?.run("slow-once"))?.status).toBe("completed");
      expect(calls).toBe(2);
    });

    it("perTenant : un handler par tenant actif, contexte lié au tenant, l'échec d'un tenant n'arrête pas les autres", async () => {
      await env.admin.query("CREATE TABLE IF NOT EXISTS public.wk_job_log (tenant_id uuid NOT NULL REFERENCES kernel.tenants (id), visible int NOT NULL)");
      await env.admin.query("SELECT kernel.enable_tenant_rls('public.wk_job_log')");
      await env.admin.query("GRANT SELECT, INSERT ON public.wk_job_log TO app_user");
      await env.admin.query("TRUNCATE public.wk_job_log");
      const suspended = await env.addTenant("suspended-t");
      await env.admin.query("UPDATE kernel.tenants SET status = 'suspended' WHERE id = $1", [suspended.id]);

      const failing = env.tenants[1] as (typeof env.tenants)[0];
      const job = defineScheduledJob({
        name: "per-tenant",
        cron: "0 0 1 1 *",
        perTenant: true,
        handler: async ({ tenant, db }) => {
          if (tenant.id === failing.id) throw new Error("tenant en panne (simulation)");
          await db.run(async (tx) => {
            await tx.query("INSERT INTO public.wk_job_log (tenant_id, visible) SELECT $1, count(*) FROM kernel.domain_events", [tenant.id]);
          });
        },
      });
      const app = await startApp({ jobs: [job] });
      await expect(app.scheduler?.run("per-tenant")).rejects.toThrow(/1 tenant\(s\) en échec sur 3/);

      const rows = await env.admin.query("SELECT tenant_id FROM public.wk_job_log ORDER BY tenant_id");
      const ran = rows.rows.map((r) => r.tenant_id).sort();
      expect(ran).toEqual([(env.tenants[0] as { id: string }).id, (env.tenants[2] as { id: string }).id].sort());
      expect(ran).not.toContain(suspended.id); // tenant suspendu ignoré
    });
  });

  describe("outbox-cleanup", () => {
    it("purge par lots les événements PUBLIÉS anciens, garde le reste, purge aussi les marques d'idempotence", async () => {
      await env.admin.query("TRUNCATE kernel.domain_events, kernel.processed_events");
      const t0 = env.tenants[0] as (typeof env.tenants)[0];
      const t1 = env.tenants[1] as (typeof env.tenants)[0];
      const insert = async (tenantId: string, publishedDaysAgo: number | null, extra = "") => {
        const id = newId();
        await env.admin.query(
          `INSERT INTO kernel.domain_events (id, tenant_id, type, occurred_at, published_at ${extra ? ", available_at" : ""})
           VALUES ($1, $2, 'test.thing.happened', now() - interval '60 days',
                   ${publishedDaysAgo === null ? "NULL" : `now() - interval '${publishedDaysAgo} days'`} ${extra ? `, ${extra}` : ""})`,
          [id, tenantId],
        );
        return id;
      };

      const oldPublished: string[] = [];
      for (let i = 0; i < 25; i++) oldPublished.push(await insert(i % 2 ? t0.id : t1.id, 40)); // 25 > lot de 10 => plusieurs lots
      const recentPublished = await insert(t0.id, 2);
      const pending = await insert(t0.id, null);
      const dead = await insert(t0.id, null, "'infinity'");

      for (const [tenantId, daysAgo] of [[t0.id, 45], [t0.id, 1], [t1.id, 45]] as const) {
        await env.admin.query(
          "INSERT INTO kernel.processed_events (tenant_id, subscriber, event_id, processed_at) VALUES ($1, 'x.sub', $2, now() - ($3 || ' days')::interval)",
          [tenantId, newId(), String(daysAgo)],
        );
      }

      const { logger, lines } = captureLogger("info");
      const app = await startApp({ skipBuiltinJobs: false, logger }, { OUTBOX_CLEANUP_BATCH_SIZE: "10", OUTBOX_RETENTION_DAYS: "30" });
      const outcome = await app.scheduler?.run("outbox-cleanup");
      expect(outcome).toMatchObject({ status: "completed", tenants: { ok: 3, failed: 0 } });

      const left = (await env.admin.query("SELECT id FROM kernel.domain_events")).rows.map((r) => r.id).sort();
      expect(left).toEqual([recentPublished, pending, dead].sort());
      expect(oldPublished.some((id) => left.includes(id))).toBe(false);
      const marks = await env.admin.query("SELECT count(*)::int AS n FROM kernel.processed_events");
      expect(marks.rows[0].n).toBe(1);

      const summary = lines.filter((l) => l.msg === "outbox purgée");
      expect(summary.reduce((n, l) => n + l.eventsDeleted, 0)).toBe(25);
      expect(summary.every((l) => typeof l.tenantId === "string" && typeof l.job === "string")).toBe(true); // contexte structuré
    });
  });

  describe("ensure-partitions", () => {
    it("sans module audit : no-op journalisé, jamais une erreur", async () => {
      await env.admin.query("DROP SCHEMA IF EXISTS audit CASCADE");
      const { logger, lines } = captureLogger("info");
      const app = await startApp({ skipBuiltinJobs: false, logger });
      const outcome = await app.scheduler?.run("ensure-partitions");
      expect(outcome?.status).toBe("completed");
      expect(lines.some((l) => /fonction absente/.test(l.msg ?? ""))).toBe(true);
    });

    it("avec la signature réelle du module audit (integer DEFAULT 3, integer DEFAULT 0) : passe les mois d'avance", async () => {
      await env.admin.query(`
        CREATE SCHEMA IF NOT EXISTS audit;
        CREATE TABLE IF NOT EXISTS audit.calls (months int NOT NULL, back int NOT NULL DEFAULT 0, called_by text NOT NULL DEFAULT current_user);
        CREATE OR REPLACE FUNCTION audit.ensure_partitions(p_months_ahead integer DEFAULT 3, p_months_back integer DEFAULT 0) RETURNS SETOF text
          LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO audit.calls (months, back) VALUES (p_months_ahead, p_months_back); RETURN NEXT 'audit_log_2099_01'; END $$;
        GRANT USAGE ON SCHEMA audit TO app_user;
        GRANT EXECUTE ON FUNCTION audit.ensure_partitions(integer, integer) TO app_user;
      `);
      const { logger, lines } = captureLogger("info");
      const app = await startApp({ skipBuiltinJobs: false, logger }, { AUDIT_PARTITIONS_MONTHS_AHEAD: "4" });
      expect((await app.scheduler?.run("ensure-partitions"))?.status).toBe("completed");
      const calls = await env.admin.query("SELECT months, back, called_by FROM audit.calls");
      expect(calls.rows).toEqual([{ months: 4, back: 0, called_by: expect.any(String) }]);
      expect(lines.some((l) => l.msg === "partitions vérifiées" && l.created === 1)).toBe(true);
    });

    it("avec une fonction sans argument : l'appelle telle quelle", async () => {
      await env.admin.query(`
        DROP FUNCTION audit.ensure_partitions(integer, integer);
        CREATE OR REPLACE FUNCTION audit.ensure_partitions() RETURNS integer
          LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO audit.calls (months) VALUES (-1); RETURN 1; END $$;
        GRANT EXECUTE ON FUNCTION audit.ensure_partitions() TO app_user;
        TRUNCATE audit.calls;
      `);
      const app = await startApp({ skipBuiltinJobs: false });
      expect((await app.scheduler?.run("ensure-partitions"))?.status).toBe("completed");
      expect((await env.admin.query("SELECT months FROM audit.calls")).rows).toEqual([{ months: -1 }]);
    });

    it("si app_user n'a pas EXECUTE : avertissement et no-op", async () => {
      await env.admin.query("REVOKE EXECUTE ON FUNCTION audit.ensure_partitions() FROM PUBLIC, app_user");
      await env.admin.query("TRUNCATE audit.calls");
      const { logger, lines } = captureLogger("info");
      const app = await startApp({ skipBuiltinJobs: false, logger });
      expect((await app.scheduler?.run("ensure-partitions"))?.status).toBe("completed");
      expect((await env.admin.query("SELECT count(*)::int AS n FROM audit.calls")).rows[0].n).toBe(0);
      expect(lines.some((l) => l.level === "warn" && /aucune signature utilisable/.test(l.msg ?? ""))).toBe(true);
    });
  });
});
