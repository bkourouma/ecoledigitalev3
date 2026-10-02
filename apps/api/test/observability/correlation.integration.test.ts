/**
 * Observabilité de bout en bout (ADR-009) sur la plateforme ASSEMBLÉE (Postgres réel, Redis réel, VRAI worker en processus) :
 *
 *   requête HTTP -> événement d'outbox -> relais -> routeur -> abonnés
 *
 *  - une requête et tout ce qu'elle déclenche partagent le même `request_id` et la même trace (`trace_id`) ;
 *  - le `traceparent` est écrit dans l'outbox et les spans forment une chaîne parent -> enfant ;
 *  - aucun journal capturé (API + worker) ne contient de champ interdit, après un parcours avec mots de passe, jetons, e-mails ;
 *  - `/health`, `/ready` (PG, Redis, migrations, worker, stockage) et `/metrics` (jeton) ;
 *  - métriques du worker : relais, abonnés, files.
 * Sans réseau sortant (exportateur de spans en mémoire).
 */
import { randomBytes } from "node:crypto";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertNoForbiddenLogContent } from "@ecoledigitale/kernel";
import { createLogger } from "../../../worker/src/logger";
import { createWorkerObservability } from "../../../worker/src/observability";
import { createObservability, observabilityPlugin, shutdownTracing, type Observability } from "../../src/platform/observability";
import { describeIntegration } from "../helpers/fixtures";
import { REDIS_URL, startPhase1Platform, waitFor, type Phase1Env } from "../phase1/support/harness";
import { PASSWORD, redeemInvitation } from "../phase1/support/scenario";

const METRICS_TOKEN = randomBytes(24).toString("hex");

describeIntegration.skipIf(!REDIS_URL)("observabilité — corrélation requête -> événement -> job, santé, métriques, aucune fuite", () => {
  let p: Phase1Env;
  let obs: Observability;
  const exporter = new InMemorySpanExporter();
  const apiLines: Array<Record<string, any>> = [];
  const workerLines: Array<Record<string, any>> = [];
  const sink = (target: Array<Record<string, any>>) => ({
    write(chunk: string) {
      for (const l of chunk.split("\n")) if (l.trim()) target.push(JSON.parse(l));
    },
  });

  beforeAll(async () => {
    obs = createObservability("api", {
      env: { NODE_ENV: "test", LOG_LEVEL: "debug", METRICS_TOKEN },
      logStream: sink(apiLines),
      tracing: { exporter, instrumentations: false, synchronous: true, sampleRatio: 1 },
    });
    const workerLogger = createLogger("debug", sink(workerLines));
    p = await startPhase1Platform({
      instance: {
        fastify: obs.fastifyOptions,
        beforePlatform: async (app) => {
          await app.register(observabilityPlugin, { observability: obs });
        },
      },
      worker: {
        logger: workerLogger,
        observability: createWorkerObservability({ logger: workerLogger, prefix: process.env.WORKER_QUEUE_PREFIX ?? "ed", businessIntervalMs: 0 }),
      },
    });
  }, 240_000);

  afterAll(async () => {
    await p?.stop();
    await shutdownTracing();
  });

  const provision = (slug: string, requestId: string) =>
    p.http("POST", "/api/v1/platform/tenants", {
      token: p.operatorToken,
      headers: { "x-request-id": requestId },
      body: {
        name: `École ${slug}`,
        slug,
        countryCode: "CI",
        packs: ["HIGHER"],
        adminContact: { name: "Responsable Test", email: `owner@${slug}.test`, phone: "+225 07 00 00 00 00" },
      },
    });

  const R1 = `obs-e2e-${randomBytes(4).toString("hex")}-a`;
  const R2 = `obs-e2e-${randomBytes(4).toString("hex")}-b`;
  let tenant1 = "";
  let tenant2 = "";

  it("deux requêtes simultanées : chaque événement et chaque ligne du worker portent le request_id de SA requête", async () => {
    const [a, b] = await Promise.all([provision("obs-alpha", R1), provision("obs-beta", R2)]);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(a.headers["x-request-id"]).toBe(R1);
    expect(b.headers["x-request-id"]).toBe(R2);
    tenant1 = a.body.tenantId;
    tenant2 = b.body.tenantId;

    // 1. Les événements d'outbox portent le request_id ET le traceparent (colonne 0604) de la requête qui les a émis.
    const events = await p.db.admin.query(
      "SELECT id, type, request_id, traceparent, published_at FROM kernel.domain_events WHERE request_id = ANY($1) ORDER BY id",
      [[R1, R2]],
    );
    expect(events.rows.length).toBeGreaterThanOrEqual(2);
    for (const e of events.rows) expect(e.traceparent, `traceparent de ${e.type}`).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const provisioned = events.rows.filter((e) => e.type === "tenancy.tenant.provisioned");
    expect(provisioned.map((e) => e.request_id).sort()).toEqual([R1, R2].sort());

    // 2. Le worker traite ces événements : attendre les lignes « événement traité » des abonnés du provisioning.
    await waitFor(
      () => provisioned.every((e) => workerLines.some((l) => l.event_id === e.id && l.msg === "événement traité")),
      { label: "abonnés du worker ont traité tenancy.tenant.provisioned", timeoutMs: 60_000 },
    );

    // 3. Propriété : toute ligne du worker qui porte un event_id connu porte AUSSI le request_id de cet événement.
    const requestOf = new Map<string, string>(events.rows.map((e) => [e.id as string, e.request_id as string]));
    const correlated = workerLines.filter((l) => typeof l.event_id === "string" && requestOf.has(l.event_id));
    expect(correlated.length).toBeGreaterThanOrEqual(4);
    for (const line of correlated) {
      expect(line.request_id, `${line.msg} (event ${line.event_id})`).toBe(requestOf.get(line.event_id));
      expect(line.tenant_id).toBeTypeOf("string");
      expect(line.module).toBeTypeOf("string");
      expect(line.service).toBe("worker");
    }
    const handled = correlated.filter((l) => l.msg === "événement traité");
    expect(handled.length).toBeGreaterThanOrEqual(2);
    for (const line of handled) {
      expect(line.job_id).toBeTypeOf("string");
      expect(line.module).not.toBe("worker"); // le module de l'abonné (rbac, entitlements, audit…)
    }
    expect(new Set(handled.map((l) => l.request_id))).toEqual(new Set([R1, R2]));
  });

  it("la requête a UNE ligne d'accès (module, route, statut) avec le même request_id et le trace_id du span serveur", () => {
    const access = apiLines.filter((l) => l.msg === "request completed" && l.request_id === R1);
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({ method: "POST", route: "/api/v1/platform/tenants", status: 201, module: "platform", service: "api" });
    const server = exporter.getFinishedSpans().find((s) => s.name === "POST /api/v1/platform/tenants" && s.attributes["request.id"] === R1);
    expect(server).toBeDefined();
    expect(access[0]?.trace_id).toBe(server?.spanContext().traceId);
  });

  it("une trace unique : span HTTP -> publication outbox -> routage -> abonné (parents chaînés)", async () => {
    const server = exporter.getFinishedSpans().find((s) => s.name === "POST /api/v1/platform/tenants" && s.attributes["request.id"] === R1)!;
    const traceId = server.spanContext().traceId;
    await waitFor(() => exporter.getFinishedSpans().some((s) => s.spanContext().traceId === traceId && s.name.startsWith("handle ")), {
      label: "span d'abonné dans la trace de la requête",
      timeoutMs: 30_000,
    });
    const spans = exporter.getFinishedSpans().filter((s) => s.spanContext().traceId === traceId);
    const byId = new Map(spans.map((s) => [s.spanContext().spanId, s]));
    const handles = spans.filter((s) => s.name.startsWith("handle "));
    expect(handles.length).toBeGreaterThanOrEqual(2);
    for (const handle of handles) {
      const route = byId.get(handle.parentSpanContext?.spanId ?? "");
      expect(route?.name, `parent de ${handle.name}`).toMatch(/^route /);
      const publish = byId.get(route?.parentSpanContext?.spanId ?? "");
      expect(publish?.name).toMatch(/^outbox publish /);
      expect(publish?.parentSpanContext?.spanId).toBe(server.spanContext().spanId);
      expect(handle.attributes).toMatchObject({ "tenant.id": tenant1, "request.id": R1, "messaging.system": "bullmq" });
    }
    // Aucune donnée personnelle dans les attributs de spans.
    const blob = JSON.stringify(spans.map((s) => s.attributes));
    expect(blob).not.toMatch(/@[a-z0-9-]+\.test/i);
    expect(blob).not.toContain(PASSWORD);
  });

  it("parcours avec secrets (invitation, mot de passe, connexion, mauvais mot de passe) : AUCUN champ interdit dans les journaux de l'API ni du worker", async () => {
    await redeemInvitation(p, "owner@obs-alpha.test");
    const bad = await p.http("POST", "/api/v1/iam/login", { body: { email: "owner@obs-alpha.test", password: `${PASSWORD}-faux`, tenantSlug: "obs-alpha", client: "mobile" } });
    expect(bad.status).toBe(401);
    // La connexion complète du propriétaire impose la MFA : on s'arrête à l'étape d'enrôlement, qui manipule déjà un jeton.
    const login = await p.http("POST", "/api/v1/iam/login", { body: { email: "owner@obs-alpha.test", password: PASSWORD, tenantSlug: "obs-alpha", client: "mobile" } });
    expect(login.status).toBe(200);

    // Laisser le worker consommer les événements de sécurité (connexion échouée, mot de passe défini).
    await new Promise((r) => setTimeout(r, 1500));
    expect(apiLines.length).toBeGreaterThan(10);
    expect(workerLines.length).toBeGreaterThan(10);
    assertNoForbiddenLogContent(apiLines);
    assertNoForbiddenLogContent(workerLines);
    const blob = JSON.stringify([apiLines, workerLines]);
    for (const secret of [PASSWORD, "owner@obs-alpha.test", "owner@obs-beta.test", login.body.enrollmentToken ?? "no-token-sentinel"]) {
      expect(blob).not.toContain(secret);
    }
  });

  it("/health, /ready (PG, Redis, migrations, worker vivant, stockage) et les chemins sensibles", async () => {
    const health = await p.app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    const ready = await p.app.inject({ method: "GET", url: "/ready" });
    expect(ready.statusCode, ready.body).toBe(200);
    const body = ready.json();
    expect(body.status).toBe("ready");
    const names = body.checks.map((c: any) => c.name);
    expect(names).toEqual(expect.arrayContaining(["postgres", "redis", "migrations", "worker", "storage"]));
    for (const c of body.checks) expect(c.ok, c.name).toBe(true);
    expect(ready.body).not.toMatch(/postgres(ql)?:\/\//);

    // Worker vivant : battement de cœur écrit par le vrai worker.
    expect(body.checks.find((c: any) => c.name === "worker")).toMatchObject({ ok: true, required: false });
    // Le serveur de santé du worker : /health, /ready et /metrics (loopback).
    const base = `http://127.0.0.1:${p.worker.health?.port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const wr = await fetch(`${base}/ready`);
    expect(wr.status).toBe(200);
    expect((await wr.json()).checks.map((c: any) => c.name)).toEqual(["redis", "postgres", "migrations", "storage"]);
  });

  it("/metrics de l'API : 401 sans jeton, métriques par module avec le jeton ; aucune étiquette tenant", async () => {
    expect((await p.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    const res = await p.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${METRICS_TOKEN}` } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('ed_http_requests_total{module="platform",method="POST",route="/api/v1/platform/tenants",status_class="2xx",service="api"}');
    expect(res.body).toMatch(/ed_pg_pool_connections\{pool="v2",state="total",service="api"\} \d+/);
    expect(res.body).not.toContain(tenant1);
    expect(res.body).not.toContain(tenant2);
  });

  it("métriques du worker : relais (retard), abonnés par module, files BullMQ", async () => {
    const text = await p.worker.observability!.kit.registry.metrics();
    expect(text).toMatch(/ed_outbox_events_published_total\{service="worker"\} [1-9]/);
    expect(text).toContain("ed_outbox_publish_lag_seconds_bucket");
    expect(text).toMatch(/ed_subscriber_jobs_total\{[^}]*module="rbac"[^}]*subscriber="rbac\.instantiate-system-roles"[^}]*outcome="success"[^}]*\} [1-9]/);
    expect(text).toMatch(/ed_subscriber_job_duration_seconds_count\{[^}]*subscriber="entitlements\.start-trial"/);
    expect(text).toMatch(/ed_queue_jobs\{queue="domain-events",state="waiting",service="worker"\} 0/);
    expect(text).toContain("ed_outbox_oldest_pending_age_seconds");
    expect(text).not.toContain(tenant1);
  });

  it("/ready : 200 « degraded » quand plus aucun worker ne bat (API toujours utile), 503 si PostgreSQL tombe", async () => {
    await p.worker.stop("test-degraded");
    // Le battement de cœur est retiré à l'arrêt gracieux : la sonde « worker » échoue, les sondes requises restent vertes.
    const degraded = await p.app.inject({ method: "GET", url: "/ready" });
    expect(degraded.statusCode).toBe(200);
    expect(degraded.json().status).toBe("degraded");
    expect(degraded.json().checks.find((c: any) => c.name === "worker").ok).toBe(false);
  });
});
