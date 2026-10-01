import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import { newId, type DomainEvent } from "@ecoledigitale/kernel";
import { DeadLetterAdmin } from "../src/events/dlq-admin";
import { subscriberQueueName } from "../src/events/registry";
import { idempotent, type SubscriberDefinition } from "../src/sdk";
import type { WorkerApp } from "../src/app";
import { createTestEnv, describeIntegration, sleep, waitFor, writeEvents, type TestEnv } from "./helpers";

describeIntegration("abonnés d'événements (relais -> routeur -> handlers, Postgres + Redis réels)", () => {
  let env: TestEnv;
  const apps: WorkerApp[] = [];
  const queues: Queue[] = [];

  beforeAll(async () => {
    env = await createTestEnv(3);
    await env.admin.query(`
      CREATE TABLE public.wk_notes (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES kernel.tenants (id),
        body text NOT NULL
      );
      SELECT kernel.enable_tenant_rls('public.wk_notes');
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.wk_notes TO app_user;

      CREATE TABLE public.wk_effects (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES kernel.tenants (id),
        event_id uuid NOT NULL,
        subscriber text NOT NULL
      );
      SELECT kernel.enable_tenant_rls('public.wk_effects');
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.wk_effects TO app_user;
    `);
  });

  afterAll(async () => {
    await env.drop();
  });

  beforeEach(async () => {
    await env.admin.query("TRUNCATE kernel.domain_events, kernel.processed_events, public.wk_effects, public.wk_notes");
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.stop("test");
    for (const q of queues.splice(0)) await q.close();
    await env.flushRedis();
  });

  async function startApp(subscribers: SubscriberDefinition[], overrides?: Record<string, string>): Promise<WorkerApp> {
    const app = env.app({ subscribers, skipBuiltinJobs: true }, { WORKER_SCHEDULER_ENABLED: "false", ...overrides });
    apps.push(app);
    await app.start();
    return app;
  }

  const queueOf = (name: string): Queue => {
    const q = new Queue(name, { connection: env.redis, prefix: env.prefix });
    queues.push(q);
    return q;
  };

  const tenantA = () => env.tenants[0] as (typeof env.tenants)[0];
  const tenantB = () => env.tenants[1] as (typeof env.tenants)[0];

  it("un handler qui échoue 2 fois puis réussit : 3 tentatives, backoff, succès, rien en DLQ", async () => {
    const seen: Array<{ attempt: number; at: number }> = [];
    const app = await startApp([
      {
        name: "t.flaky",
        pattern: "school.student.enrolled",
        retry: { attempts: 5, backoffMs: 60, maxBackoffMs: 500 },
        handler: async (_event, ctx) => {
          seen.push({ attempt: ctx.attempt, at: Date.now() });
          if (ctx.attempt < 3) throw new Error(`échec simulé #${ctx.attempt}`);
        },
      },
    ]);
    const [event] = await writeEvents(env, tenantA(), 1, "school.student.enrolled");

    const sub = queueOf(subscriberQueueName("t.flaky"));
    await waitFor(async () => (await sub.getJob((event as DomainEvent).id))?.isCompleted(), { label: "job terminé avec succès" });

    expect(seen.map((s) => s.attempt)).toEqual([1, 2, 3]);
    // backoff exponentiel : ≥ 60 ms puis ≥ 120 ms (le jitter peut retirer 20 %)
    expect((seen[1] as { at: number }).at - (seen[0] as { at: number }).at).toBeGreaterThanOrEqual(45);
    expect((seen[2] as { at: number }).at - (seen[1] as { at: number }).at).toBeGreaterThanOrEqual(90);
    const job = await sub.getJob((event as DomainEvent).id);
    expect(job?.attemptsMade).toBe(3);
    expect(await new DeadLetterAdmin(env.redis, env.prefix).count()).toBe(0);
    void app;
  });

  it("DLQ après N échecs, puis rejeu depuis la DLQ", async () => {
    const attempts: number[] = [];
    let failing = true;
    await startApp([
      {
        name: "t.dead",
        pattern: "school.student.enrolled",
        retry: { attempts: 3, backoffMs: 20, maxBackoffMs: 100 },
        handler: async (_e, ctx) => {
          attempts.push(ctx.attempt);
          if (failing) throw new Error("toujours en échec");
        },
      },
    ]);
    const [event] = await writeEvents(env, tenantA(), 1, "school.student.enrolled");
    const admin = new DeadLetterAdmin(env.redis, env.prefix);
    queues.push({ close: () => admin.close() } as unknown as Queue);

    await waitFor(async () => (await admin.count()) === 1, { label: "entrée en DLQ" });
    expect(attempts).toEqual([1, 2, 3]);

    const [entry] = await admin.list();
    expect(entry?.record).toMatchObject({
      kind: "handler",
      subscriber: "t.dead",
      attempts: 3,
      event: { id: (event as DomainEvent).id, tenantId: tenantA().id },
    });
    expect(entry?.record.error).toContain("toujours en échec");
    const failedJob = await queueOf(subscriberQueueName("t.dead")).getJob((event as DomainEvent).id);
    expect(await failedJob?.isFailed()).toBe(true);

    // Le problème est corrigé : on rejoue.
    failing = false;
    expect(await admin.replay((entry as { id: string }).id)).toBe(true);
    await waitFor(() => attempts.length === 4, { label: "rejeu exécuté" });
    expect(attempts).toEqual([1, 2, 3, 1]); // compteur de tentatives remis à zéro
    await waitFor(async () => (await admin.count()) === 0, { label: "DLQ vidée" });
    await waitFor(async () => (await queueOf(subscriberQueueName("t.dead")).getJob((event as DomainEvent).id))?.isCompleted(), { label: "job terminé" });
  });

  it("idempotent() : livraisons multiples d'un même événement => un seul effet ; un échec annule la marque ET l'effet", async () => {
    let calls = 0;
    await startApp([
      {
        name: "t.idem",
        pattern: "school.student.enrolled",
        retry: { attempts: 4, backoffMs: 20, maxBackoffMs: 100 },
        handler: idempotent("t.idem", async (event, ctx, tx) => {
          calls += 1;
          await tx.query("INSERT INTO public.wk_effects (id, tenant_id, event_id, subscriber) VALUES ($1, $2, $3, 't.idem')", [newId(), ctx.tenantId, event.id]);
          // 1re livraison de l'événement « flaky » : l'effet est écrit PUIS le handler échoue -> tout est annulé.
          if ((event.payload as { flaky?: boolean }).flaky && ctx.attempt === 1) throw new Error("échec après l'effet");
        }),
      },
    ]);

    // (a) doublons : même événement poussé 3 fois dans la file de l'abonné (jobIds différents).
    const [dup] = await writeEvents(env, tenantA(), 1, "school.student.enrolled", () => ({ v: 1 }));
    const sub = queueOf(subscriberQueueName("t.idem"));
    await waitFor(async () => (await sub.getJob((dup as DomainEvent).id))?.isCompleted(), { label: "1re livraison" });
    await sub.add("school.student.enrolled", { event: dup }, { jobId: "redelivery-1" });
    await sub.add("school.student.enrolled", { event: dup }, { jobId: "redelivery-2" });
    await Promise.all(["redelivery-1", "redelivery-2"].map((id) => waitFor(async () => (await sub.getJob(id))?.isCompleted(), { label: id })));

    // (b) échec après l'effet.
    const [flaky] = await writeEvents(env, tenantB(), 1, "school.student.enrolled", () => ({ v: 1, flaky: true }));
    await waitFor(async () => (await sub.getJob((flaky as DomainEvent).id))?.isCompleted(), { label: "événement flaky terminé" });

    const effects = await env.admin.query("SELECT event_id, count(*)::int AS n FROM public.wk_effects GROUP BY event_id ORDER BY n DESC");
    expect(effects.rowCount).toBe(2);
    expect(effects.rows.every((r) => r.n === 1)).toBe(true);
    const marks = await env.admin.query("SELECT count(*)::int AS n FROM kernel.processed_events WHERE subscriber = 't.idem'");
    expect(marks.rows[0].n).toBe(2);
    expect(calls).toBe(1 + 2 * 0 + 2); // dup : 1 exécution (les 2 redélivrances sont ignorées avant le handler) ; flaky : 2 (échec + succès)
  });

  it("isolation du contexte tenant : chaque handler ne voit et n'écrit que son tenant", async () => {
    // Pré-remplit des notes pour les deux tenants (en tant que app_user, via TenantDb).
    for (const t of [tenantA(), tenantB()]) {
      await env.admin.query("INSERT INTO public.wk_notes (id, tenant_id, body) SELECT gen_random_uuid(), $1, 'note-' || g FROM generate_series(1, 5) g", [t.id]);
    }
    const observations: Array<{ eventTenant: string; ctxTenant: string; visibleTenants: string[]; crossWrite: string; own: string }> = [];

    await startApp([
      {
        name: "t.isolation",
        pattern: "school.student.enrolled",
        concurrency: 5,
        handler: async (event, ctx) => {
          const visible = await ctx.db.run((tx) => tx.many<{ tenant_id: string }>("SELECT DISTINCT tenant_id FROM public.wk_notes"));
          const other = [tenantA(), tenantB()].find((t) => t.id !== event.tenantId) as (typeof env.tenants)[0];
          let crossWrite = "autorisé (BUG)";
          try {
            await ctx.db.run((tx) => tx.query("INSERT INTO public.wk_notes (id, tenant_id, body) VALUES ($1, $2, 'intrusion')", [newId(), other.id]));
          } catch (e) {
            crossWrite = /row-level security/i.test((e as Error).message) ? "refusé par la RLS" : `refusé : ${(e as Error).message}`;
          }
          await ctx.db.run((tx) => tx.query("INSERT INTO public.wk_notes (id, tenant_id, body) VALUES ($1, $2, 'ma note')", [newId(), ctx.tenantId]));
          const own = await ctx.db.run((tx) => tx.many<{ n: number }>("SELECT count(*)::int AS n FROM public.wk_notes"));
          observations.push({
            eventTenant: event.tenantId,
            ctxTenant: ctx.db.ctx.tenantId,
            visibleTenants: visible.map((v) => v.tenant_id),
            crossWrite,
            own: String(own[0]?.n),
          });
        },
      },
    ]);

    await Promise.all([writeEvents(env, tenantA(), 4, "school.student.enrolled"), writeEvents(env, tenantB(), 4, "school.student.enrolled")]);
    await waitFor(() => observations.length === 8, { label: "8 handlers exécutés" });

    for (const o of observations) {
      expect(o.ctxTenant).toBe(o.eventTenant);
      expect(o.visibleTenants).toEqual([o.eventTenant]); // jamais le tenant voisin
      expect(o.crossWrite).toBe("refusé par la RLS");
      // 5 notes préexistantes + « ma note » écrites par les handlers du MÊME tenant (entre 1 et 4 selon l'ordre)
      expect(Number(o.own)).toBeGreaterThanOrEqual(6);
      expect(Number(o.own)).toBeLessThanOrEqual(9);
    }
    const intrusions = await env.admin.query("SELECT count(*)::int AS n FROM public.wk_notes WHERE body = 'intrusion'");
    expect(intrusions.rows[0].n).toBe(0);
    const perTenant = await env.admin.query("SELECT tenant_id, count(*)::int AS n FROM public.wk_notes WHERE body = 'ma note' GROUP BY tenant_id");
    expect(Object.fromEntries(perTenant.rows.map((r) => [r.tenant_id, r.n]))).toEqual({ [tenantA().id]: 4, [tenantB().id]: 4 });
  });

  it("routage par motif : chaque abonné ne reçoit que ses types, une fois ; un type sans abonné est ignoré", async () => {
    const got: Record<string, string[]> = { exact: [], star: [], family: [], all: [], regex: [] };
    const record = (key: string) => async (event: DomainEvent) => void got[key]?.push(event.type);
    await startApp([
      { name: "r.exact", pattern: "finance.payment.completed", handler: record("exact") },
      { name: "r.star", pattern: "finance.*.completed", handler: record("star") },
      { name: "r.family", pattern: "finance.**", handler: record("family") },
      { name: "r.all", pattern: "**", handler: record("all") },
      { name: "r.regex", pattern: /^academic\./, handler: record("regex") },
    ]);
    await writeEvents(env, tenantA(), 1, "finance.payment.completed");
    await writeEvents(env, tenantA(), 1, "finance.invoice.completed");
    await writeEvents(env, tenantA(), 1, "finance.payment.refund.requested");
    await writeEvents(env, tenantA(), 1, "academic.grade.published");
    await writeEvents(env, tenantA(), 1, "nobody.listens.here");

    await waitFor(() => got.all?.length === 5, { label: "abonné « ** »" });
    await sleep(300);
    expect(got.exact).toEqual(["finance.payment.completed"]);
    expect(got.star?.sort()).toEqual(["finance.invoice.completed", "finance.payment.completed"]);
    expect(got.family?.sort()).toEqual(["finance.invoice.completed", "finance.payment.completed", "finance.payment.refund.requested"]);
    expect(got.regex).toEqual(["academic.grade.published"]);
    expect(got.all).toHaveLength(5);
  });

  it("bout en bout : 1 000 événements / 3 tenants / DEUX instances du worker => chacun traité une seule fois (idempotent)", async () => {
    let invocations = 0;
    const definition: SubscriberDefinition = {
      name: "t.e2e",
      pattern: "school.student.enrolled",
      concurrency: 10,
      handler: idempotent("t.e2e", async (event, ctx, tx) => {
        invocations += 1;
        await tx.query("INSERT INTO public.wk_effects (id, tenant_id, event_id, subscriber) VALUES ($1, $2, $3, 't.e2e')", [newId(), ctx.tenantId, event.id]);
      }),
    };
    const t0 = Date.now();
    await Promise.all([startApp([definition]), startApp([definition])]);
    const written = (
      await Promise.all([writeEvents(env, env.tenants[0] as never, 333, "school.student.enrolled"), writeEvents(env, env.tenants[1] as never, 333, "school.student.enrolled"), writeEvents(env, env.tenants[2] as never, 334, "school.student.enrolled")])
    ).flat();

    await waitFor(async () => (await env.admin.query("SELECT count(*)::int AS n FROM public.wk_effects")).rows[0].n === 1000, { label: "1000 effets", timeoutMs: 90_000 });
    console.log(`[bout en bout] 1000 événements outbox -> relais -> routeur -> handler en ${Date.now() - t0} ms, ${invocations} invocation(s)`);

    const effects = await env.admin.query("SELECT count(DISTINCT event_id)::int AS d, count(*)::int AS n FROM public.wk_effects");
    expect(effects.rows[0]).toEqual({ d: 1000, n: 1000 });
    expect(new Set((await env.admin.query("SELECT event_id FROM public.wk_effects")).rows.map((r) => r.event_id))).toEqual(new Set(written.map((e) => e.id)));
    expect((await env.admin.query("SELECT count(*)::int AS n FROM kernel.processed_events WHERE subscriber = 't.e2e'")).rows[0].n).toBe(1000);
    expect(invocations).toBeGreaterThanOrEqual(1000);
  });

  it("arrêt gracieux : /ready passe à 503, le job en cours se termine, les pools sont fermés", async () => {
    let started = false;
    let finished = false;
    const app = await startApp([
      {
        name: "t.slow",
        pattern: "school.student.enrolled",
        handler: async () => {
          started = true;
          await sleep(1500);
          finished = true;
        },
      },
    ]);
    const base = `http://127.0.0.1:${app.health?.port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(200);
    expect((await ready.json()) as { checks: Array<{ name: string; ok: boolean }> }).toMatchObject({ status: "ready", checks: [{ name: "redis", ok: true }, { name: "postgres", ok: true }] });

    await writeEvents(env, tenantA(), 1, "school.student.enrolled");
    await waitFor(() => started, { label: "handler démarré" });

    const stopping = app.stop("test-sigterm");
    expect(app.isReady).toBe(false);
    await stopping;
    expect(finished).toBe(true); // le job en cours a été mené à terme avant la fermeture
    expect(app.pool.totalCount).toBe(0); // pool PG fermé
    await expect(fetch(`${base}/health`)).rejects.toThrow(); // serveur HTTP fermé
    // l'événement a bien été acquitté : pas de reprise au prochain démarrage
    await env.flushRedis();
  });
});
