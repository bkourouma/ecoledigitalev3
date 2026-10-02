/**
 * Observabilité du worker (ADR-009), sans base ni Redis : corrélation des journaux, métriques, serveur de santé,
 * propagation du contexte de trace.
 */
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import { Registry } from "prom-client";
import { assertNoForbiddenLogContent, createDomainEvent, createRequestContext } from "@ecoledigitale/kernel";
import { authorizeMetrics } from "../../api/src/platform/observability/core/metrics-http";
import { loadObservabilityConfig } from "../../api/src/platform/observability/core/config";
import { shutdownTracing } from "../../api/src/platform/observability/core/tracing";
import { HealthServer } from "../src/infra/health";
import { createLogger } from "../src/logger";
import { createWorkerObservability, moduleOfName } from "../src/observability";
import { startPublishTrace } from "../src/observability/job-trace";
import { CachedValue } from "../src/observability/queue-stats";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";

function capture(): { logger: ReturnType<typeof createLogger>; lines: Array<Record<string, any>>; raw: string[] } {
  const lines: Array<Record<string, any>> = [];
  const raw: string[] = [];
  const logger = createLogger("debug", {
    write(chunk: string) {
      for (const l of chunk.split("\n")) {
        if (!l.trim()) continue;
        raw.push(l);
        lines.push(JSON.parse(l));
      }
    },
  });
  return { logger, lines, raw };
}

const event = (requestId = "req-obs-0001") =>
  createDomainEvent({ type: "finance.payment.completed", payload: { v: 1 }, ctx: createRequestContext({ tenantId: T, userId: U, requestId }) });

afterEach(async () => {
  await shutdownTracing();
});

describe("journaux du worker : schéma commun et corrélation", () => {
  it("même schéma que l'API : service, snake_case, redaction ; les clés camelCase des enfants sont normalisées", () => {
    const { logger, lines, raw } = capture();
    logger.child({ tenantId: T, jobId: "j-1" }).info({ eventId: "e-1", password: "hunter2", note: "écrit à a@b.ci" }, "essai avec un jeton Bearer abcdefghij123456");
    expect(lines[0]).toMatchObject({ service: "worker", level: "info", tenant_id: T, job_id: "j-1", event_id: "e-1", password: "[REDACTED]" });
    expect(raw[0]).not.toContain("hunter2");
    expect(raw[0]).not.toContain("a@b.ci");
    expect(raw[0]).not.toContain("abcdefghij123456");
    expect(lines[0]?.msg).toContain("Bearer [REDACTED]");
    assertNoForbiddenLogContent(lines);
  });

  it("runEventJob pose request_id, tenant_id, event_id, job_id et module sur CHAQUE ligne, sans doublon de clé", async () => {
    const { logger, lines, raw } = capture();
    const obs = createWorkerObservability({ logger, prefix: "t", env: {}, businessIntervalMs: 0 });
    const ev = event("req-obs-0042");
    await obs.runEventJob({ stage: "handle", name: "finance.send-receipt", queue: "q", event: ev, jobId: "job-7", attempt: 1 }, async () => {
      logger.info({ note: "dans le handler" }, "traitement");
      await new Promise((r) => setTimeout(r, 5));
      logger.child({ subscriber: "finance.send-receipt" }).warn({}, "après un await");
    });
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l).toMatchObject({ request_id: "req-obs-0042", tenant_id: T, event_id: ev.id, job_id: "job-7", module: "finance" });
    }
    for (const line of raw) {
      const keys = [...line.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]);
      expect(new Set(keys).size).toBe(keys.length);
    }
    logger.info({}, "hors contexte");
    expect(lines[2]?.request_id).toBeUndefined();
  });

  it("deux jobs concurrents ne mélangent pas leurs identifiants", async () => {
    const { logger, lines } = capture();
    const obs = createWorkerObservability({ logger, prefix: "t", env: {}, businessIntervalMs: 0 });
    const run = (id: string) =>
      obs.runEventJob({ stage: "handle", name: "audit.x", queue: "q", event: event(id), jobId: id, attempt: 1 }, async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 20));
        logger.info({}, "ligne");
      });
    await Promise.all(["req-aaaaaaaa", "req-bbbbbbbb", "req-cccccccc"].map(run));
    expect(lines.map((l) => `${l.request_id}/${l.job_id}`).sort()).toEqual(["req-aaaaaaaa/req-aaaaaaaa", "req-bbbbbbbb/req-bbbbbbbb", "req-cccccccc/req-cccccccc"]);
  });
});

describe("métriques du worker", () => {
  it("abonnés par module ; les rendus PDF alimentent aussi les métriques de rendu", async () => {
    const { logger } = capture();
    const obs = createWorkerObservability({ logger, prefix: "t", env: {}, businessIntervalMs: 0 });
    obs.observeSubscriber("reportcards.render-snapshot", "success", 1.5);
    obs.observeSubscriber("reportcards.render-snapshot", "retry", 0.2);
    obs.observeSubscriber("audit.tenancy", "dead", 0.01);
    const text = await obs.kit.registry.metrics();
    expect(text).toMatch(/ed_subscriber_jobs_total\{[^}]*module="reportcards"[^}]*outcome="retry"[^}]*\} 1/);
    expect(text).toMatch(/ed_pdf_render_duration_seconds_count\{[^}]*kind="reportcards.render-snapshot"[^}]*\} 2/);
    expect(text).toMatch(/ed_pdf_render_failures_total\{[^}]*kind="reportcards.render-snapshot"[^}]*\} 1/);
    expect(text).not.toMatch(/ed_pdf_render_failures_total\{[^}]*audit/);
    expect(text).not.toContain(T);
  });

  it("relais : retard de publication, plus ancien événement en attente (alimenté par tenant, retiré à la résolution)", async () => {
    const { logger } = capture();
    const obs = createWorkerObservability({ logger, prefix: "t", env: {}, businessIntervalMs: 0 });
    const old = Date.now() - 120_000;
    obs.tenantPending(T, { count: 3, oldestOccurredAtMs: old });
    obs.published([event()], Date.now());
    let text = await obs.kit.registry.metrics();
    expect(text).toMatch(/ed_outbox_pending_events\{service="worker"\} 3/);
    const age = Number(/ed_outbox_oldest_pending_age_seconds\{service="worker"\} ([0-9.]+)/.exec(text)?.[1]);
    expect(age).toBeGreaterThanOrEqual(119);
    expect(age).toBeLessThan(130);
    expect(text).toMatch(/ed_outbox_events_published_total\{service="worker"\} 1/);
    obs.tenantPending(T, null);
    text = await obs.kit.registry.metrics();
    expect(text).toMatch(/ed_outbox_pending_events\{service="worker"\} 0/);
    expect(text).toMatch(/ed_outbox_oldest_pending_age_seconds\{service="worker"\} 0/);
  });

  it("jobs planifiés : succès / échec / ignoré, durée", async () => {
    const { logger } = capture();
    const obs = createWorkerObservability({ logger, prefix: "t", env: {}, businessIntervalMs: 0 });
    await obs.runScheduledJob("finance.mark-overdue-invoices", "run-1", async () => "ok");
    await expect(obs.runScheduledJob("finance.mark-overdue-invoices", "run-2", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    obs.observeScheduledSkipped("finance.mark-overdue-invoices");
    const text = await obs.kit.registry.metrics();
    for (const outcome of ["success", "failure", "skipped"]) {
      expect(text).toMatch(new RegExp(`ed_scheduled_job_runs_total\\{[^}]*job="finance.mark-overdue-invoices"[^}]*outcome="${outcome}"[^}]*\\} 1`));
    }
    expect(text).toContain("ed_scheduled_job_duration_seconds_count");
  });

  it("moduleOfName", () => {
    expect(moduleOfName("finance.send-receipt")).toBe("finance");
    expect(moduleOfName("outbox-cleanup")).toBe("worker");
  });
});

describe("CachedValue", () => {
  it("recalcule au plus une fois par TTL, partage le calcul en cours, garde la dernière valeur en cas d'erreur", async () => {
    let now = 0;
    let calls = 0;
    let fail = false;
    const errors: unknown[] = [];
    const cv = new CachedValue<number>(
      1000,
      async () => {
        calls += 1;
        if (fail) throw new Error("redis down");
        return calls;
      },
      0,
      (e) => errors.push(e),
      () => now,
    );
    expect(await Promise.all([cv.get(), cv.get(), cv.get()])).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
    now = 500;
    expect(await cv.get()).toBe(1);
    now = 1500;
    expect(await cv.get()).toBe(2);
    fail = true;
    now = 3000;
    expect(await cv.get()).toBe(2);
    expect(errors).toHaveLength(1);
    now = 3100; // pas de martelage d'une dépendance en panne
    await cv.get();
    expect(calls).toBe(3);
  });
});

describe("contexte de trace", () => {
  it("traçage inactif : les données du job restent { event } octet pour octet", () => {
    const ev = event();
    const traced = startPublishTrace(ev);
    expect(traced.data).toEqual({ event: ev });
    expect(Object.keys(traced.data)).toEqual(["event"]);
    traced.end();
    const { logger } = capture();
    const obs = createWorkerObservability({ logger, prefix: "t", env: {}, businessIntervalMs: 0 });
    expect(obs.jobTrace()).toEqual({});
  });

  it("traçage actif : le span producteur est l'enfant du traceparent de l'événement et fournit celui du job", async () => {
    const exporter = new InMemorySpanExporter();
    const { logger } = capture();
    const obs = createWorkerObservability({ logger, prefix: "t", env: {}, businessIntervalMs: 0, tracing: { exporter, instrumentations: false, synchronous: true, sampleRatio: 1 } });
    const parent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const ev = { ...event(), traceparent: parent };
    const traced = startPublishTrace(ev);
    expect(traced.data.trace?.traceparent).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-01$/);
    expect(traced.data.trace?.traceparent).not.toBe(parent);
    traced.end();

    await obs.runEventJob({ stage: "route", name: "domain-events", queue: "domain-events", event: ev, jobId: "j", attempt: 1, trace: traced.data.trace }, async () => {
      expect(obs.jobTrace().traceparent).toMatch(/^00-4bf92f3577b34da6a3ce929d0e0e4736-/);
    });
    const [publish, route] = exporter.getFinishedSpans();
    expect(publish?.name).toBe("outbox publish finance.payment.completed");
    expect(publish?.parentSpanContext?.spanId).toBe("00f067aa0ba902b7");
    expect(route?.name).toBe("route finance.payment.completed");
    expect(route?.parentSpanContext?.spanId).toBe(publish?.spanContext().spanId);
    expect(route?.attributes).toMatchObject({ "tenant.id": T, "request.id": "req-obs-0001" });
  });
});

describe("serveur de santé du worker", () => {
  async function start(options: Partial<ConstructorParameters<typeof HealthServer>[0]> & { token?: string; metricsMode?: "none" | "inline"; tokenRequired?: boolean } = {}) {
    const { logger } = capture();
    const registry = new Registry();
    registry.setDefaultLabels({ service: "worker" });
    const server = new HealthServer({
      host: "127.0.0.1",
      port: 0,
      logger,
      isReady: () => true,
      probes: [
        { name: "redis", check: async () => undefined },
        { name: "postgres", check: async () => undefined },
        { name: "storage", check: async () => "skipped" },
      ],
      metrics: { mode: options.metricsMode ?? "none", registry, token: options.token, tokenRequired: options.tokenRequired ?? true },
      ...options,
    });
    await server.start();
    return { server, base: `http://127.0.0.1:${server.port}` };
  }

  it("/health, /ready (sondes ignorées comptées saines), 404 ailleurs", async () => {
    const { server, base } = await start();
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      const ready = await fetch(`${base}/ready`);
      expect(ready.status).toBe(200);
      expect(await ready.json()).toMatchObject({ status: "ready", service: "worker" });
      expect((await fetch(`${base}/nope`)).status).toBe(404);
      expect((await fetch(`${base}/health`, { method: "POST" })).status).toBe(405);
    } finally {
      await server.stop();
    }
  });

  it("/ready : 503 si une sonde requise échoue (sans fuite du message), 200 dégradé si une sonde facultative échoue", async () => {
    const required = await start({
      probes: [{ name: "redis", check: async () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:6379 password=xyz")) }, { name: "postgres", check: async () => undefined }],
    });
    try {
      const res = await fetch(`${required.base}/ready`);
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain('"status":"not_ready"');
      expect(text).not.toContain("ECONNREFUSED");
      expect(text).not.toContain("xyz");
    } finally {
      await required.server.stop();
    }
    const optional = await start({ probes: [{ name: "postgres", check: async () => undefined }, { name: "storage", check: async () => Promise.reject(new Error("bucket")) }] });
    try {
      const res = await fetch(`${optional.base}/ready`);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe("degraded");
    } finally {
      await optional.server.stop();
    }
  });

  it("/metrics : 404 par défaut ; 401 sans jeton valide ; 200 avec le jeton ; sans jeton seulement si autorisé (loopback)", async () => {
    const off = await start({ metricsMode: "none" });
    try {
      expect((await fetch(`${off.base}/metrics`)).status).toBe(404);
    } finally {
      await off.server.stop();
    }
    const token = "w".repeat(32);
    const guarded = await start({ metricsMode: "inline", token, tokenRequired: true });
    try {
      expect((await fetch(`${guarded.base}/metrics`)).status).toBe(401);
      expect((await fetch(`${guarded.base}/metrics`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
      const ok = await fetch(`${guarded.base}/metrics`, { headers: { authorization: `Bearer ${token}` } });
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toContain("text/plain");
    } finally {
      await guarded.server.stop();
    }
    const loopback = await start({ metricsMode: "inline", tokenRequired: false });
    try {
      expect((await fetch(`${loopback.base}/metrics`)).status).toBe(200);
    } finally {
      await loopback.server.stop();
    }
  });

  it("règle d'exposition du worker : jamais sans jeton hors loopback", () => {
    const hosted = loadObservabilityConfig("worker", { WORKER_HTTP_HOST: "0.0.0.0" });
    expect(hosted.metrics.mode).toBe("none");
    expect(loadObservabilityConfig("worker", { WORKER_HTTP_HOST: "0.0.0.0", METRICS_TOKEN: "z".repeat(30) }).metrics.mode).toBe("inline");
    expect(authorizeMetrics({ tokenRequired: true }, undefined, "Bearer anything")).toBe("unauthorized");
  });
});
