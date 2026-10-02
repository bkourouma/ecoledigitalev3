/**
 * Cœur de l'observabilité (ADR-009) : configuration, nettoyage des spans, propagation W3C, cardinalité. Sans base ni Redis.
 */
import { SpanKind, trace } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import {
  CardinalityGuard,
  ObservabilityConfigError,
  SanitizingSpanExporter,
  contextFromTraceparent,
  createMetricsKit,
  createHttpMetrics,
  createPoolMetrics,
  currentTraceparent,
  initTracing,
  loadObservabilityConfig,
  obfuscateSql,
  parseOtlpHeaders,
  resolveMetricsExposure,
  runWithCorrelation,
  getCorrelation,
  correlationMixin,
  shutdownTracing,
  stripUrlQuery,
  withSpan,
} from "../../src/platform/observability/core";

afterEach(async () => {
  await shutdownTracing();
});

describe("configuration", () => {
  it("traçage désactivé sans point d'accès OTLP : aucun appel réseau possible", () => {
    const c = loadObservabilityConfig("api", { NODE_ENV: "production" });
    expect(c.tracing.enabled).toBe(false);
    expect(c.tracing.endpoint).toBeUndefined();
    expect(c.metrics.mode).toBe("none");
    expect(c.logLevel).toBe("info");
    expect(c.tracing.sampleRatio).toBe(0.1);
    expect(loadObservabilityConfig("api", {}).logLevel).toBe("debug");
  });

  it("active le traçage avec un point d'accès, respecte OTEL_SDK_DISABLED et OTEL_TRACES_SAMPLER_ARG", () => {
    const env = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318", OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20abc,x-team=ed", OTEL_TRACES_SAMPLER_ARG: "0.25" };
    const c = loadObservabilityConfig("worker", env);
    expect(c.tracing).toMatchObject({ enabled: true, endpoint: "http://collector:4318", sampleRatio: 0.25, headers: { authorization: "Bearer abc", "x-team": "ed" } });
    expect(c.serviceName).toBe("ecoledigitale-worker");
    expect(loadObservabilityConfig("api", { ...env, OTEL_SDK_DISABLED: "true" }).tracing.enabled).toBe(false);
    expect(loadObservabilityConfig("api", { ...env, OTEL_TRACES_EXPORTER: "none" }).tracing.enabled).toBe(false);
  });

  it("signale toutes les variables invalides sans recopier leurs valeurs", () => {
    try {
      loadObservabilityConfig("api", { LOG_LEVEL: "bavard", OTEL_TRACES_SAMPLER_ARG: "3", METRICS_TOKEN: "secret-trop-court", OBS_READY_REQUIRE: "postgres,rien", OTEL_EXPORTER_OTLP_ENDPOINT: "pas une url" });
      throw new Error("aurait dû échouer");
    } catch (e) {
      expect(e).toBeInstanceOf(ObservabilityConfigError);
      const msg = (e as Error).message;
      for (const name of ["LOG_LEVEL", "OTEL_TRACES_SAMPLER_ARG", "METRICS_TOKEN", "OBS_READY_REQUIRE", "OTEL_EXPORTER_OTLP_ENDPOINT"]) expect(msg).toContain(name);
      expect(msg).not.toContain("secret-trop-court");
      expect(msg).not.toContain("pas une url");
    }
  });

  it("sondes requises : postgres, redis, migrations par défaut", () => {
    expect([...loadObservabilityConfig("api", {}).health.required].sort()).toEqual(["migrations", "postgres", "redis"]);
  });

  it("parseOtlpHeaders ignore les entrées mal formées", () => {
    expect(parseOtlpHeaders("a=1, b = 2 ,,=x,c")).toEqual({ a: "1", b: "2" });
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });
});

describe("exposition de /metrics", () => {
  const TOKEN = "k".repeat(30);
  it.each([
    [{ service: "api", host: "127.0.0.1" }, "none", true],
    [{ service: "api", host: "127.0.0.1", token: TOKEN }, "inline", true],
    [{ service: "api", host: "127.0.0.1", port: 9464 }, "dedicated", false],
    [{ service: "api", host: "0.0.0.0", port: 9464 }, "none", true],
    [{ service: "api", host: "0.0.0.0", port: 9464, token: TOKEN }, "dedicated", true],
    [{ service: "worker", host: "127.0.0.1" }, "inline", false],
    [{ service: "worker", host: "0.0.0.0" }, "none", true],
    [{ service: "worker", host: "0.0.0.0", token: TOKEN }, "inline", true],
  ] as const)("%j -> %s (jeton exigé : %s)", (input, mode, tokenRequired) => {
    const r = resolveMetricsExposure(input as never);
    expect(r.mode).toBe(mode);
    expect(r.tokenRequired).toBe(tokenRequired);
  });
});

describe("nettoyage des spans exportés", () => {
  it("masque les attributs sensibles, retire les chaînes de requête, obfusque le SQL, écarte le bruit transactionnel", async () => {
    const inner = new InMemorySpanExporter();
    initTracing(loadObservabilityConfig("api", {}), { exporter: new SanitizingSpanExporter(inner), instrumentations: false, synchronous: true, sampleRatio: 1 });
    // Le SanitizingSpanExporter est ajouté une seconde fois par initTracing : le nettoyage est idempotent.
    const tracer = trace.getTracer("test");
    const s = tracer.startSpan("appel sortant jean@ecole.ci", { kind: SpanKind.CLIENT });
    s.setAttributes({
      "url.full": "https://api.exemple.test/v1/pay?token=ABC123&amount=5",
      "http.url": "https://user:pass@api.exemple.test/x?signature=zzz",
      "http.request.header.authorization": "Bearer abcdefghij1234567",
      "enduser.email": "jean@ecole.ci",
      note: "contact jean@ecole.ci",
      "tenant.id": "11111111-1111-4111-8111-111111111111",
    });
    s.addEvent("exception", { "exception.message": "échec pour jean@ecole.ci", "exception.stacktrace": "at x (jean@ecole.ci)" });
    s.end();
    const sql = tracer.startSpan("pg.query:SELECT", { kind: SpanKind.CLIENT });
    sql.setAttribute("db.query.text", "SELECT id FROM iam.identities WHERE email = 'jean@ecole.ci' AND code = 1234567");
    sql.end();
    for (const text of ["BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT ed_sp_1", "SELECT set_config('app.tenant_id', $1, true)"]) {
      const c = tracer.startSpan("pg.query:ctl");
      c.setAttribute("db.query.text", text);
      c.end();
    }
    const spans = inner.getFinishedSpans();
    const blob = JSON.stringify(spans.map((x) => ({ n: x.name, a: x.attributes, e: x.events })));
    for (const leaked of ["jean@ecole.ci", "ABC123", "zzz", "user:pass", "abcdefghij1234567", "1234567"]) expect(blob).not.toContain(leaked);
    const call = spans.find((x) => x.name.startsWith("appel sortant"));
    expect(call?.attributes["url.full"]).toBe("https://api.exemple.test/v1/pay?[REDACTED]");
    expect(call?.attributes["tenant.id"]).toBe("11111111-1111-4111-8111-111111111111");
    expect(spans.find((x) => x.attributes["db.query.text"])?.attributes["db.query.text"]).toBe("SELECT id FROM iam.identities WHERE email = '?' AND code = ?");
    expect(spans).toHaveLength(2); // le SQL de contrôle est écarté
  });

  it("obfuscateSql et stripUrlQuery", () => {
    expect(obfuscateSql("INSERT INTO t(a) VALUES ('x@y.ci', $1, 99999)")).toBe("INSERT INTO t(a) VALUES ('?', ?, ?)");
    expect(stripUrlQuery("/api/v1/x?token=1#frag")).toBe("/api/v1/x?[REDACTED]");
    expect(stripUrlQuery("/api/v1/x")).toBe("/api/v1/x");
  });
});

describe("propagation W3C", () => {
  it("sans traçage : aucun traceparent, withSpan reste utilisable", async () => {
    expect(currentTraceparent()).toBeUndefined();
    expect(await withSpan("x", {}, async () => 42)).toBe(42);
  });

  it("un span devient le parent distant du suivant via traceparent (API -> worker)", async () => {
    const exporter = new InMemorySpanExporter();
    initTracing(loadObservabilityConfig("api", {}), { exporter, instrumentations: false, synchronous: true, sampleRatio: 1 });
    let carried: string | undefined;
    await withSpan("http.request", { kind: SpanKind.SERVER }, async () => {
      carried = currentTraceparent();
    });
    expect(carried).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    await withSpan("worker.handle", { kind: SpanKind.CONSUMER, parent: contextFromTraceparent(carried) }, async () => undefined);
    const [server, consumer] = exporter.getFinishedSpans();
    expect(consumer?.spanContext().traceId).toBe(server?.spanContext().traceId);
    expect(consumer?.parentSpanContext?.spanId).toBe(server?.spanContext().spanId);
  });

  it("ignore un traceparent invalide", () => {
    const base = contextFromTraceparent(undefined);
    expect(contextFromTraceparent("n'importe quoi")).toBe(base);
    expect(contextFromTraceparent("00-zzzz-0000-01")).toBe(base);
  });

  it("une erreur dans withSpan est enregistrée sans donnée personnelle puis relancée", async () => {
    const exporter = new InMemorySpanExporter();
    initTracing(loadObservabilityConfig("api", {}), { exporter, instrumentations: false, synchronous: true, sampleRatio: 1 });
    await expect(withSpan("job", {}, async () => Promise.reject(new Error("échec pour jean@ecole.ci")))).rejects.toThrow();
    const span = exporter.getFinishedSpans()[0];
    expect(span?.status.code).toBe(2);
    expect(JSON.stringify([span?.events, span?.status])).not.toContain("jean@ecole.ci");
  });
});

describe("corrélation des journaux", () => {
  it("fusionne les champs, résout paresseusement tenant et utilisateur, ignore les champs inconnus", () => {
    let tenant: string | undefined;
    runWithCorrelation({ request_id: "r-1", module: "finance", resolve: () => (tenant ? { tenant_id: tenant } : {}) }, () => {
      expect(getCorrelation()).toEqual({ request_id: "r-1", module: "finance" });
      tenant = "t-1";
      expect(correlationMixin()).toMatchObject({ request_id: "r-1", module: "finance", tenant_id: "t-1" });
      runWithCorrelation({ job_id: "j-9", event_id: "e-9", password: "x" } as never, () => {
        const c = getCorrelation();
        expect(c).toMatchObject({ request_id: "r-1", job_id: "j-9", event_id: "e-9", tenant_id: "t-1" });
        expect(JSON.stringify(c)).not.toContain("password");
      });
    });
    expect(getCorrelation()).toEqual({});
  });
});

describe("cardinalité", () => {
  it("CardinalityGuard replie au-delà du plafond et reste stable pour les valeurs déjà vues", () => {
    const g = new CardinalityGuard(2);
    expect([g.resolve("a"), g.resolve("b"), g.resolve("c"), g.resolve("a"), g.resolve("d")]).toEqual(["a", "b", "__other__", "a", "__other__"]);
    expect(g.size).toBe(2);
    expect(g.overflowCount).toBe(2);
  });

  it("le pool est suivi : jauges lues au scrape, durée d'acquisition mesurée", async () => {
    const kit = createMetricsKit("api", { defaultMetrics: false });
    const pools = createPoolMetrics(kit);
    const pool = { totalCount: 4, idleCount: 1, waitingCount: 2, options: { max: 10 }, connect: async () => ({ release() {} }) };
    pools.track("v2", pool);
    await pool.connect();
    const text = await kit.registry.metrics();
    expect(text).toContain('ed_pg_pool_connections{pool="v2",state="waiting",service="api"} 2');
    expect(text).toContain('ed_pg_pool_utilization_ratio{pool="v2",service="api"} 0.3');
    expect(text).toMatch(/ed_pg_pool_acquire_seconds_count\{service="api",pool="v2"\} 1/);
    createHttpMetrics(kit, { routeLabelLimit: 5, tenantLabelMax: 0 });
  });
});
