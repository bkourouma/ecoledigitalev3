/**
 * Observabilité du worker avec un VRAI Postgres et un VRAI Redis (ADR-009) : propagation du contexte de trace et du
 * `request_id` du relais jusqu'au handler, métriques de files et de relais, battement de cœur, dead-letter.
 */
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { Queue } from "bullmq";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createDomainEvent, createRequestContext, newId } from "@ecoledigitale/kernel";
import { PgOutboxWriter } from "@ecoledigitale/database";
import { workerHeartbeatProbe } from "../../api/src/platform/observability/core/health";
import { shutdownTracing } from "../../api/src/platform/observability/core/tracing";
import type { WorkerApp } from "../src/app";
import { DEAD_LETTER_QUEUE } from "../src/events/publisher";
import { createLogger } from "../src/logger";
import { createWorkerObservability, type WorkerObservability } from "../src/observability";
import { startHeartbeat } from "../src/observability/heartbeat";
import { snapshotQueue } from "../src/observability/queue-stats";
import type { SubscriberDefinition } from "../src/sdk";
import { createTestEnv, describeIntegration, sleep, waitFor, writeEvents, type TestEnv } from "./helpers";

const TP = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describeIntegration("observabilité du worker (Postgres + Redis réels)", () => {
  let env: TestEnv;
  const apps: WorkerApp[] = [];
  const queues: Queue[] = [];
  const lines: Array<Record<string, any>> = [];
  const logger = createLogger("debug", {
    write(chunk: string) {
      for (const l of chunk.split("\n")) if (l.trim()) lines.push(JSON.parse(l));
    },
  });

  beforeAll(async () => {
    env = await createTestEnv(2);
  });
  afterAll(async () => {
    await env.drop();
  });
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.stop("test");
    for (const q of queues.splice(0)) await q.close();
    await shutdownTracing();
    await env.flushRedis();
    await env.admin.query("TRUNCATE kernel.domain_events, kernel.processed_events");
    lines.length = 0;
  });

  function observability(options: { tracing?: InMemorySpanExporter } = {}): WorkerObservability {
    return createWorkerObservability({
      logger,
      prefix: env.prefix,
      env: { ...process.env, OBS_COLLECT_CACHE_MS: "0" },
      businessIntervalMs: 0,
      ...(options.tracing ? { tracing: { exporter: options.tracing, instrumentations: false, synchronous: true, sampleRatio: 1 } } : {}),
    });
  }

  async function startApp(subscribers: SubscriberDefinition[], obs: WorkerObservability): Promise<WorkerApp> {
    const app = env.app({ subscribers, skipBuiltinJobs: true, logger, observability: obs }, { WORKER_SCHEDULER_ENABLED: "false" });
    apps.push(app);
    await app.start();
    return app;
  }

  it("snapshotQueue : profondeur par état et âge du plus ancien job en attente (file réelle)", async () => {
    const queue = new Queue("obs-stats", { connection: env.redis, prefix: env.prefix });
    queues.push(queue);
    expect((await snapshotQueue("obs-stats", queue)).oldestWaitingSeconds).toBe(0);
    await queue.add("a", {});
    await sleep(1_100);
    await queue.add("b", {});
    await queue.add("c", {});
    const snap = await snapshotQueue("obs-stats", queue);
    expect(snap.counts).toMatchObject({ waiting: 3, active: 0, failed: 0 });
    expect(snap.oldestWaitingSeconds).toBeGreaterThanOrEqual(1);
    expect(snap.oldestWaitingSeconds).toBeLessThan(30);
  });

  it("battement de cœur : la sonde « worker » est verte tant qu'une instance bat, rouge après son arrêt gracieux", async () => {
    const probe = workerHeartbeatProbe(env.redis, env.prefix);
    await expect(probe.check()).rejects.toThrow(/battement/);
    const hb = startHeartbeat(env.redis, env.prefix, { intervalMs: 200 });
    await waitFor(async () => {
      try {
        await probe.check();
        return true;
      } catch {
        return false;
      }
    }, { label: "battement visible" });
    await hb.stop();
    await expect(probe.check()).rejects.toThrow(/battement/);
  });

  it("événement avec traceparent : publication -> routage -> abonné forment une chaîne, le request_id de l'événement est sur chaque ligne", async () => {
    const exporter = new InMemorySpanExporter();
    const obs = observability({ tracing: exporter });
    expect(obs.tracing.enabled).toBe(true);
    const seen: string[] = [];
    await startApp(
      [{ name: "obs.sink", pattern: "obs.thing.happened", handler: (_e, ctx) => void (seen.push(ctx.jobId), ctx.logger.info({ note: "dans le handler" }, "traitement")) }],
      obs,
    );
    const [tenant] = env.tenants as [(typeof env.tenants)[0]];
    const ctx = createRequestContext({ tenantId: tenant.id, userId: newId(), requestId: "req-obs-worker-1" });
    const event = createDomainEvent({ type: "obs.thing.happened", payload: { v: 1 }, ctx });
    await env.tenantDb.run(ctx, async (tx) => {
      await new PgOutboxWriter(tx).append([{ ...event, traceparent: TP }]);
    });
    await waitFor(() => seen.length === 1, { label: "abonné exécuté" });
    await waitFor(() => exporter.getFinishedSpans().some((s) => s.name === "handle obs.sink"), { label: "span d'abonné terminé" });

    const spans = exporter.getFinishedSpans();
    const publish = spans.find((s) => s.name === "outbox publish obs.thing.happened")!;
    const route = spans.find((s) => s.name === "route obs.thing.happened")!;
    const handle = spans.find((s) => s.name === "handle obs.sink")!;
    for (const s of [publish, route, handle]) expect(s.spanContext().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(publish.parentSpanContext?.spanId).toBe("00f067aa0ba902b7");
    expect(route.parentSpanContext?.spanId).toBe(publish.spanContext().spanId);
    expect(handle.parentSpanContext?.spanId).toBe(route.spanContext().spanId);
    expect(handle.attributes).toMatchObject({ "tenant.id": tenant.id, "request.id": "req-obs-worker-1", "ed.subscriber": "obs.sink" });

    const mine = lines.filter((l) => l.event_id === event.id);
    expect(mine.length).toBeGreaterThanOrEqual(2);
    for (const l of mine) expect(l).toMatchObject({ request_id: "req-obs-worker-1", tenant_id: tenant.id, service: "worker" });
    const handler = lines.find((l) => l.msg === "traitement");
    expect(handler).toMatchObject({ request_id: "req-obs-worker-1", module: "obs", trace_id: "4bf92f3577b34da6a3ce929d0e0e4736", event_id: event.id });
  });

  it("sans traçage : l'outbox n'écrit pas de traceparent, les données du job restent { event }, le request_id est quand même propagé", async () => {
    const obs = observability();
    expect(obs.tracing.enabled).toBe(false);
    let received: unknown;
    await startApp([{ name: "obs.sink2", pattern: "obs.thing.happened", handler: (e) => void (received = e) }], obs);
    const [tenant] = env.tenants as [(typeof env.tenants)[0]];
    const [event] = await writeEvents(env, tenant, 1, "obs.thing.happened");
    await waitFor(() => received !== undefined, { label: "abonné exécuté" });
    const row = await env.admin.query("SELECT request_id, traceparent FROM kernel.domain_events WHERE id = $1", [event?.id]);
    expect(row.rows[0].traceparent).toBeNull();
    expect(row.rows[0].request_id).toBe(event?.requestId);
    expect((received as { traceparent?: string }).traceparent).toBeUndefined();
    expect(lines.filter((l) => l.event_id === event?.id).every((l) => l.request_id === event?.requestId)).toBe(true);
  });

  it("métriques : relais (publiés, retard, balayage), abonnés, files, DLQ", async () => {
    const obs = observability();
    const app = await startApp(
      [
        { name: "obs.ok", pattern: "obs.thing.happened", handler: () => undefined },
        { name: "obs.fail", pattern: "obs.thing.happened", retry: { attempts: 1 }, handler: () => Promise.reject(new Error("boom")) },
      ],
      obs,
    );
    const [tenant] = env.tenants as [(typeof env.tenants)[0]];
    await writeEvents(env, tenant, 3, "obs.thing.happened");
    await waitFor(
      async () => {
        const text = await obs.kit.registry.metrics();
        return /ed_subscriber_jobs_total\{[^}]*subscriber="obs.ok"[^}]*outcome="success"[^}]*\} 3/.test(text) && /subscriber="obs.fail"[^}]*outcome="dead"[^}]*\} 3/.test(text);
      },
      { label: "abonnés comptés" },
    );
    const text = await obs.kit.registry.metrics();
    expect(text).toMatch(/ed_outbox_events_published_total\{service="worker"\} 3/);
    expect(text).toMatch(/ed_outbox_publish_lag_seconds_count\{service="worker"\} 3/);
    expect(Number(/ed_outbox_relay_last_sweep_timestamp_seconds\{service="worker"\} ([0-9.]+)/.exec(text)?.[1])).toBeGreaterThan(Date.now() / 1000 - 60);
    expect(text).toMatch(/ed_subscriber_job_duration_seconds_count\{[^}]*subscriber="obs.ok"[^}]*\} 3/);
    expect(text).toMatch(/ed_outbox_pending_events\{service="worker"\} 0/);
    // Les 3 échecs définitifs de obs.fail sont dans la DLQ ; la file du routeur est vide.
    await waitFor(
      async () => /ed_queue_jobs\{queue="domain-events-dead",state="waiting",service="worker"\} 3/.test(await obs.kit.registry.metrics()),
      { label: "DLQ visible dans ed_queue_jobs" },
    );
    expect(await obs.kit.registry.metrics()).toMatch(/ed_queue_jobs\{queue="domain-events",state="waiting",service="worker"\} 0/);
    expect(app.consumers?.queueList().length).toBe(2);
    const dead = new Queue(DEAD_LETTER_QUEUE, { connection: env.redis, prefix: env.prefix });
    queues.push(dead);
    expect((await dead.getJobCounts("waiting")).waiting).toBe(3);
  });

  it("outbox bloquée : un événement dont la publication échoue reste « en attente » dans la jauge, avec son âge", async () => {
    const obs = observability();
    obs.tenantPending("t-1", { count: 2, oldestOccurredAtMs: Date.now() - 90_000 });
    const text = await obs.kit.registry.metrics();
    expect(text).toMatch(/ed_outbox_pending_events\{service="worker"\} 2/);
    expect(Number(/ed_outbox_oldest_pending_age_seconds\{service="worker"\} ([0-9.]+)/.exec(text)?.[1])).toBeGreaterThanOrEqual(89);
  });
});
