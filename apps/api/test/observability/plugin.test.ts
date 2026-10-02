/**
 * Plugin d'observabilité (ADR-009), sans base ni Redis : identifiant de requête, journal d'accès, corrélation, span serveur,
 * métriques HTTP, santé et protection de `/metrics`.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import { assertNoForbiddenLogContent } from "@ecoledigitale/kernel";
import { createObservability, observabilityPlugin, shutdownTracing, type Probe } from "../../src/platform/observability";

const TRACE_PARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

interface Harness {
  app: FastifyInstance;
  lines: Array<Record<string, any>>;
  spans: InMemorySpanExporter | undefined;
  metrics(): Promise<string>;
}

const open: FastifyInstance[] = [];

async function harness(options: { env?: Record<string, string>; tracing?: boolean; probes?: Probe[]; routes?: (app: FastifyInstance) => void } = {}): Promise<Harness> {
  const lines: Array<Record<string, any>> = [];
  const stream = {
    write(chunk: string) {
      for (const l of chunk.split("\n")) if (l.trim()) lines.push(JSON.parse(l));
    },
  };
  const exporter = options.tracing ? new InMemorySpanExporter() : undefined;
  const observability = createObservability("api", {
    env: { NODE_ENV: "test", LOG_LEVEL: "debug", ...(options.env ?? {}) },
    logStream: stream,
    ...(exporter ? { tracing: { exporter, instrumentations: false, synchronous: true, sampleRatio: 1 } } : {}),
  });
  const app = Fastify({ ...observability.fastifyOptions });
  await app.register(observabilityPlugin, { observability, env: {}, moduleKeys: ["finance", "iam"], ...(options.probes ? { probes: () => options.probes as Probe[] } : {}) });
  app.get("/api/v1/legacy-things/:id", async (request) => {
    request.log.info({ note: "dans le handler" }, "traitement");
    return { id: (request.params as { id: string }).id };
  });
  app.get("/api/v1/iam/boom", async () => {
    throw new Error("échec pour jean@ecole.ci");
  });
  options.routes?.(app);
  await app.ready();
  open.push(app);
  return { app, lines, spans: exporter, metrics: async () => await observability.kit.registry.metrics() };
}

afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
  await shutdownTracing();
});

describe("identifiant de requête", () => {
  it("génère un UUID v7, le renvoie dans la réponse et le journalise", async () => {
    const h = await harness();
    const res = await h.app.inject({ method: "GET", url: "/api/v1/legacy-things/42" });
    const id = res.headers["x-request-id"] as string;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(h.lines.filter((l) => l.request_id === id).length).toBeGreaterThanOrEqual(2); // handler + accès
  });

  it("reprend un x-request-id valide et rejette un identifiant dangereux", async () => {
    const h = await harness();
    const ok = await h.app.inject({ method: "GET", url: "/api/v1/legacy-things/1", headers: { "x-request-id": "client-req-12345" } });
    expect(ok.headers["x-request-id"]).toBe("client-req-12345");
    const bad = await h.app.inject({ method: "GET", url: "/api/v1/legacy-things/1", headers: { "x-request-id": "x y\n{evil}" } });
    expect(bad.headers["x-request-id"]).not.toBe("x y\n{evil}");
    expect(String(bad.headers["x-request-id"])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("l'en-tête réécrit est celui que lit la plateforme v2 (un seul identifiant par requête)", async () => {
    let seen: string | undefined;
    const h = await harness({
      routes: (app) =>
        app.get("/api/v1/legacy-probe", async (request) => {
          seen = request.headers["x-request-id"] as string;
          return { ok: true };
        }),
    });
    const res = await h.app.inject({ method: "GET", url: "/api/v1/legacy-probe" });
    expect(seen).toBe(res.headers["x-request-id"]);
  });
});

describe("journal d'accès et corrélation", () => {
  it("écrit UNE ligne par requête, avec le motif de route et sans chaîne de requête", async () => {
    const h = await harness();
    await h.app.inject({ method: "GET", url: "/api/v1/legacy-things/42?token=SECRET-TOKEN-123&email=a@b.ci", headers: { authorization: "Bearer abcdefghij1234567890", cookie: "sid=secretcookie" } });
    const access = h.lines.filter((l) => l.msg === "request completed");
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({ method: "GET", route: "/api/v1/legacy-things/:id", status: 200, module: "legacy", service: "api" });
    expect(typeof access[0]?.duration_ms).toBe("number");
    const blob = JSON.stringify(h.lines);
    expect(blob).not.toContain("SECRET-TOKEN-123");
    expect(blob).not.toContain("secretcookie");
    expect(blob).not.toContain("abcdefghij1234567890");
    expect(blob).not.toContain("a@b.ci");
    assertNoForbiddenLogContent(h.lines);
  });

  it("ajoute tenant_id et user_id (identité, jamais d'e-mail) dès que l'authentification les connaît", async () => {
    const T = "11111111-1111-4111-8111-111111111111";
    const U = "22222222-2222-4222-8222-222222222222";
    const h = await harness({
      routes: (app) => {
        app.addHook("preHandler", async (request) => {
          (request as any).ctx = { tenantId: T, userId: U };
        });
        app.get("/api/v1/finance/invoices", async (request) => {
          request.log.info({}, "dans le handler");
          app.log.warn({}, "journal racine, même contexte");
          return { ok: true };
        });
      },
      env: {},
    });
    await h.app.inject({ method: "GET", url: "/api/v1/finance/invoices" });
    const mine = h.lines.filter((l) => l.msg === "dans le handler" || l.msg === "journal racine, même contexte" || l.msg === "request completed");
    expect(mine).toHaveLength(3);
    for (const l of mine) expect(l).toMatchObject({ tenant_id: T, user_id: U, request_id: expect.any(String) });
  });

  it("masque les secrets des journaux applicatifs et réduit les erreurs", async () => {
    const h = await harness();
    h.app.log.info({ password: "hunter2", user: { email: "x@y.ci", token: "t0k3n" }, tenantId: "t-1" }, "connexion de jean@ecole.ci");
    await h.app.inject({ method: "GET", url: "/api/v1/iam/boom" });
    const blob = JSON.stringify(h.lines);
    for (const secret of ["hunter2", "x@y.ci", "t0k3n", "jean@ecole.ci"]) expect(blob).not.toContain(secret);
    expect(h.lines.some((l) => l.tenant_id === "t-1")).toBe(true);
    assertNoForbiddenLogContent(h.lines);
    const failed = h.lines.find((l) => l.msg === "request completed" && l.status === 500);
    expect(failed?.module).toBe("iam");
  });

  it("route inconnue : motif __unmatched__, jamais l'URL demandée", async () => {
    const h = await harness();
    await h.app.inject({ method: "GET", url: "/api/v1/n-importe-quoi/9f1c2d3e?token=abc" });
    const access = h.lines.find((l) => l.msg === "request completed");
    expect(access?.route).toBe("__unmatched__");
    expect(JSON.stringify(h.lines)).not.toContain("9f1c2d3e");
    expect(await h.metrics()).toContain('route="__unmatched__"');
  });
});

describe("traçage", () => {
  it("désactivé par défaut : aucun fournisseur, pas de trace_id", async () => {
    const h = await harness();
    await h.app.inject({ method: "GET", url: "/api/v1/legacy-things/1" });
    expect(h.app.observability.tracing.enabled).toBe(false);
    expect(h.lines.every((l) => l.trace_id === undefined)).toBe(true);
  });

  it("span serveur nommé par le motif, attributs d'identité sans PII, trace_id dans les journaux", async () => {
    const T = "11111111-1111-4111-8111-111111111111";
    const U = "22222222-2222-4222-8222-222222222222";
    const h = await harness({
      tracing: true,
      routes: (app) => {
        app.addHook("preHandler", async (request) => {
          (request as any).ctx = { tenantId: T, userId: U };
        });
        app.get("/api/v1/finance/invoices/:id", async () => ({ ok: true }));
      },
    });
    const res = await h.app.inject({ method: "GET", url: "/api/v1/finance/invoices/777?token=SECRET" });
    const spans = h.spans?.getFinishedSpans() ?? [];
    expect(spans).toHaveLength(1);
    const span = spans[0]!;
    expect(span.name).toBe("GET /api/v1/finance/invoices/:id");
    expect(span.attributes).toMatchObject({
      "http.route": "/api/v1/finance/invoices/:id",
      "http.response.status_code": 200,
      "tenant.id": T,
      "enduser.id": U,
      "ed.module": "finance",
      "request.id": res.headers["x-request-id"],
    });
    expect(JSON.stringify(span.attributes)).not.toContain("SECRET");
    const access = h.lines.find((l) => l.msg === "request completed");
    expect(access?.trace_id).toBe(span.spanContext().traceId);
    expect(access?.span_id).toBe(span.spanContext().spanId);
  });

  it("n'honore PAS le traceparent entrant par défaut, le continue si OBS_TRUST_INBOUND_TRACEPARENT=true", async () => {
    const strict = await harness({ tracing: true });
    await strict.app.inject({ method: "GET", url: "/api/v1/legacy-things/1", headers: { traceparent: TRACE_PARENT } });
    expect(strict.spans?.getFinishedSpans()[0]?.spanContext().traceId).not.toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    await strict.app.close();
    await shutdownTracing();

    const trusting = await harness({ tracing: true, env: { OBS_TRUST_INBOUND_TRACEPARENT: "true" } });
    await trusting.app.inject({ method: "GET", url: "/api/v1/legacy-things/1", headers: { traceparent: TRACE_PARENT } });
    const span = trusting.spans?.getFinishedSpans()[0];
    expect(span?.spanContext().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(span?.parentSpanContext?.spanId).toBe("00f067aa0ba902b7");
  });

  it("marque le span en erreur sur un 5xx sans recopier le message brut", async () => {
    const h = await harness({ tracing: true });
    await h.app.inject({ method: "GET", url: "/api/v1/iam/boom" });
    const span = h.spans?.getFinishedSpans()[0];
    expect(span?.status.code).toBe(2);
    expect(JSON.stringify(span?.events)).not.toContain("jean@ecole.ci");
  });
});

describe("métriques HTTP", () => {
  it("compte par module, méthode, motif et classe de statut ; ne porte jamais l'URL ni le tenant", async () => {
    const h = await harness();
    await h.app.inject({ method: "GET", url: "/api/v1/legacy-things/1" });
    await h.app.inject({ method: "GET", url: "/api/v1/legacy-things/2" });
    await h.app.inject({ method: "GET", url: "/api/v1/iam/boom" });
    const text = await h.metrics();
    expect(text).toContain('ed_http_requests_total{module="legacy",method="GET",route="/api/v1/legacy-things/:id",status_class="2xx",service="api"} 2');
    expect(text).toContain('status_class="5xx"');
    expect(text).toContain("ed_http_request_duration_seconds_bucket");
    expect(text).not.toMatch(/tenant_id=/);
    expect(text).not.toContain("legacy-things/1");
  });

  it("série par tenant uniquement si METRICS_TENANT_LABEL_MAX > 0, plafonnée", async () => {
    const tenants = ["a", "b", "c", "d"].map((c) => `${c.repeat(8)}-1111-4111-8111-111111111111`);
    let current = tenants[0] as string;
    const h = await harness({
      env: { METRICS_TENANT_LABEL_MAX: "2" },
      routes: (app) => {
        app.addHook("preHandler", async (request) => {
          (request as any).ctx = { tenantId: current, userId: "22222222-2222-4222-8222-222222222222" };
        });
        app.get("/api/v1/finance/x", async () => ({ ok: true }));
      },
    });
    for (const t of tenants) {
      current = t;
      await h.app.inject({ method: "GET", url: "/api/v1/finance/x" });
    }
    const text = await h.metrics();
    const series = text.split("\n").filter((l) => l.startsWith("ed_tenant_http_requests_total{"));
    expect(series).toHaveLength(3); // 2 tenants distingués + « other »
    expect(series.some((l) => l.includes('tenant_id="other"'))).toBe(true);
  });

  it("plafonne les motifs de route distincts (repli sur __other__)", async () => {
    const h = await harness({
      env: { OBS_ROUTE_LABEL_LIMIT: "10" },
      routes: (app) => {
        for (let i = 0; i < 15; i += 1) app.get(`/api/v1/finance/r${i}`, async () => ({ i }));
      },
    });
    for (let i = 0; i < 15; i += 1) await h.app.inject({ method: "GET", url: `/api/v1/finance/r${i}` });
    const text = await h.metrics();
    expect(text).toContain('route="__other__"');
  });
});

describe("santé", () => {
  const ok = (name: Probe["name"]): Probe => ({ name, check: async () => undefined });
  const ko = (name: Probe["name"], message = "boom"): Probe => ({
    name,
    check: async () => {
      throw new Error(message);
    },
  });

  it("/health ne touche aucune dépendance", async () => {
    const h = await harness({ probes: [ko("postgres")] });
    const res = await h.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "api" });
  });

  it("/ready : 200 si tout va bien", async () => {
    const h = await harness({ probes: [ok("postgres"), ok("redis"), ok("migrations"), ok("worker"), ok("storage")] });
    const res = await h.app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ready");
  });

  it("/ready : 503 si une sonde REQUISE échoue, sans message d'erreur", async () => {
    const h = await harness({ probes: [ko("postgres", "password authentication failed for user app_user"), ok("redis"), ok("migrations")] });
    const res = await h.app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: "not_ready" });
    expect(res.body).not.toContain("password authentication");
    expect(res.json().checks.find((c: any) => c.name === "postgres")).toMatchObject({ ok: false, required: true });
  });

  it("/ready : 200 « degraded » si seule une sonde facultative (worker, stockage) échoue", async () => {
    const h = await harness({ probes: [ok("postgres"), ok("redis"), ok("migrations"), ko("worker"), ko("storage")] });
    const res = await h.app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("degraded");
  });

  it("OBS_READY_REQUIRE rend le worker requis ; OBS_HEALTH_DETAILS ajoute les messages", async () => {
    const h = await harness({ env: { OBS_READY_REQUIRE: "postgres,worker", OBS_HEALTH_DETAILS: "true" }, probes: [ok("postgres"), ko("worker", "pas de battement")] });
    const res = await h.app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.find((c: any) => c.name === "worker").error).toBe("pas de battement");
  });

  it("une sonde qui dépasse son délai échoue", async () => {
    const slow: Probe = { name: "postgres", check: () => new Promise(() => undefined) };
    const h = await harness({ env: { OBS_PROBE_TIMEOUT_MS: "100" }, probes: [slow] });
    const res = await h.app.inject({ method: "GET", url: "/ready" });
    expect(res.statusCode).toBe(503);
  });
});

describe("/metrics n'est jamais public sans authentification", () => {
  const TOKEN = "t".repeat(32);

  it("sans METRICS_PORT ni METRICS_TOKEN : la route n'existe pas", async () => {
    const h = await harness();
    expect((await h.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(404);
  });

  it("avec METRICS_TOKEN : 401 sans jeton, 401 avec un mauvais jeton, 200 avec le bon", async () => {
    const h = await harness({ env: { METRICS_TOKEN: TOKEN } });
    expect((await h.app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${"x".repeat(32)}` } })).statusCode).toBe(401);
    expect((await h.app.inject({ method: "GET", url: "/metrics", headers: { authorization: TOKEN } })).statusCode).toBe(401);
    const res = await h.app.inject({ method: "GET", url: "/metrics", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("ed_http_requests_total");
    expect(res.body).toContain("nodejs_eventloop_lag_seconds");
  });

  it("un jeton trop court est refusé au démarrage, sans recopier la valeur", () => {
    expect(() => createObservability("api", { env: { METRICS_TOKEN: "court" } })).toThrow(/METRICS_TOKEN/);
    try {
      createObservability("api", { env: { METRICS_TOKEN: "court" } });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("court\n");
    }
  });

  it("serveur dédié : loopback sans jeton accepté ; hors loopback sans jeton refusé au démarrage", async () => {
    expect(() => createObservability("api", { env: { METRICS_PORT: "0", METRICS_HOST: "0.0.0.0" } })).toThrow(/non loopback/);
    const h = await harness({ env: { METRICS_PORT: "0" } });
    expect(h.app.observability.config.metrics.mode).toBe("dedicated");
  });
});
