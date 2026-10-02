/**
 * Tests unitaires (sans base de données) : manifeste, plan de rafraîchissement (événement -> demandes), CSV, mesures
 * pures, ports sources en mémoire, et chargement du plugin PAR LE REGISTRE (signature (app, runtime), préfixe
 * /api/v1/analytics, gardes de permission et de feature, garde de contexte).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, resolveModuleOrder, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import { ANALYTICS_EXPORT_DATASETS, ANALYTICS_FEATURES, ANALYTICS_PERMISSIONS } from "@ecoledigitale/contracts/src/v2/analytics";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../registry";
import type { ModuleRuntime } from "../../../platform/runtime";
import { EXPORT_PERMISSIONS } from "../application/exports";
import { clampRange } from "../application/refresh";
import { retryDelayMs } from "../application/requests";
import { csvCell, toCsv } from "../domain/csv";
import { AnalyticsEvents } from "../domain/events";
import { binCount, binIndex, buildBins, canonicalJson, contentHash, rateBps, readingStatus } from "../domain/metrics";
import { addDays, monthRange, parseRange, planRefreshes, SUBSCRIPTION_GROUPS } from "../domain/refresh-plan";
import { KIND_ORDER, REFRESH_KINDS } from "../domain/types";
import { InMemoryAnalyticsWorld } from "../infrastructure/in-memory-sources";
import manifest from "../manifest";
import { buildSubscribers } from "../subscribers";
import jobs from "../jobs";
import { makeFakeDb } from "./support/fakes";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const ctx: RequestContext = createRequestContext({ tenantId: TENANT, userId: USER });

describe("module analytics : manifeste", () => {
  it("déclare un manifeste valide dont les permissions sont préfixées par la clé", () => {
    expect(manifest.key).toBe("analytics");
    for (const permission of manifest.permissions) expect(permission.key.startsWith("analytics.")).toBe(true);
    expect(() => resolveModuleOrder([manifest])).not.toThrow();
  });

  it("publie des événements <module>.<entité>.<verbe> et ses fichiers conventionnels existent", () => {
    for (const type of manifest.events.publishes) expect(type).toMatch(/^analytics\.[a-z_]+\.[a-z_]+$/);
    const dir = resolve(__dirname, "..");
    for (const file of ["manifest.ts", "index.ts", "subscribers.ts", "jobs.ts", "http/plugin.ts", "migrations/1600_analytics_init.sql"]) expect(existsSync(resolve(dir, file)), file).toBe(true);
  });

  it("les permissions et features des contrats sont celles du manifeste, la paie est sensible", () => {
    const keys = manifest.permissions.map((p) => p.key).sort();
    expect(Object.values(ANALYTICS_PERMISSIONS).sort()).toEqual(keys);
    expect(manifest.features.map((f) => f.key).sort()).toEqual(Object.values(ANALYTICS_FEATURES).sort());
    expect(manifest.permissions.filter((p) => p.sensitive).map((p) => p.key)).toEqual(["analytics.payroll.read"]);
    for (const menu of manifest.menus) {
      expect(keys).toContain(menu.permission);
      expect(menu.portal).toBe("owner");
      expect(menu.href).toMatch(/^\/v2\/(owner|direction)(\/|$)/);
    }
  });

  it("chaque jeu de données exportable a une permission de données du manifeste", () => {
    for (const dataset of ANALYTICS_EXPORT_DATASETS) expect(manifest.permissions.map((p) => p.key), dataset).toContain(EXPORT_PERMISSIONS[dataset]);
  });
});

describe("plan de rafraîchissement : événement -> demandes", () => {
  const at = "2026-03-20T10:00:00.000Z";
  const plan = (type: string, payload: unknown = {}) => planRefreshes(type, payload, at);

  it("inscriptions : l'année du payload, sinon tout", () => {
    expect(plan("academic.enrollment.confirmed", { academicYearId: "Y" })).toEqual([{ kind: "ENROLLMENT", scopeKey: "Y" }]);
    expect(plan("academic.enrollment.withdrawn", {})).toEqual([{ kind: "ENROLLMENT", scopeKey: "*" }]);
    expect(plan("people.student.status_changed")).toEqual([{ kind: "ENROLLMENT", scopeKey: "*" }]);
    expect(plan("people.student.updated", { fields: ["sex"] })).toEqual([{ kind: "ENROLLMENT", scopeKey: "*" }]);
    expect(plan("people.student.updated", { fields: ["phone"] })).toEqual([]);
  });

  it("calendrier et charge d'enseignement", () => {
    expect(plan("academic.classroom.created")).toEqual([{ kind: "CALENDAR", scopeKey: "*" }]);
    expect(plan("academic.year.closed")).toEqual([
      { kind: "CALENDAR", scopeKey: "*" },
      { kind: "TEACHING_LOAD", scopeKey: "*" },
    ]);
    expect(plan("people.teaching_assignment.ended")).toEqual([{ kind: "TEACHING_LOAD", scopeKey: "*" }]);
  });

  it("résultats : (classe, période) à la clôture / réouverture, toute la période à la confirmation d'une décision", () => {
    expect(plan("results.period.closed", { classroomId: "C", academicPeriodId: "P" })).toEqual([{ kind: "RESULTS", scopeKey: "C|P" }]);
    expect(plan("results.period.reopened", { classroomId: "C", academicPeriodId: "P" })).toEqual([{ kind: "RESULTS", scopeKey: "C|P" }]);
    expect(plan("results.decision.confirmed", { academicPeriodId: "P" })).toEqual([{ kind: "RESULTS", scopeKey: "*|P" }]);
    expect(plan("results.period.closed", {})).toEqual([]);
    expect(plan("results.period_result.computed", { classroomId: "C", academicPeriodId: "P" })).toEqual([]); // un brouillon n'est jamais un FINAL
  });

  it("présences : le jour du payload, sinon le jour de l'événement ; congés : l'intervalle borné", () => {
    expect(plan("attendance.session.submitted", { date: "2026-03-18" })).toEqual([{ kind: "ATTENDANCE", scopeKey: "2026-03-18..2026-03-18" }]);
    expect(plan("attendance.absence.recorded", {})).toEqual([{ kind: "ATTENDANCE", scopeKey: "2026-03-20..2026-03-20" }]);
    expect(plan("attendance.staff_absence.recorded", { workDate: "2026-03-02" })).toEqual([{ kind: "STAFF_PRESENCE", scopeKey: "2026-03-02..2026-03-02" }]);
    expect(plan("attendance.staff_leave.approved", { startsOn: "2026-03-02", endsOn: "2026-03-06" })).toEqual([{ kind: "STAFF_PRESENCE", scopeKey: "2026-03-02..2026-03-06" }]);
    expect(plan("attendance.staff_leave.approved", { startsOn: "2020-01-01", endsOn: "2026-03-06" })).toEqual([{ kind: "STAFF_PRESENCE", scopeKey: "2026-03-20..2026-03-20" }]);
    expect(plan("attendance.staff_leave.requested", { startsOn: "2026-03-02", endsOn: "2026-03-06" })).toEqual([]); // une demande n'est pas un congé
  });

  it("finance : créances, encaissements du mois, caisse ; paie", () => {
    expect(plan("finance.invoice.issued")).toEqual([{ kind: "FINANCE", scopeKey: "*" }]);
    expect(plan("finance.payment.completed", { confirmedAt: "2026-02-14T09:00:00.000Z" })).toEqual([
      { kind: "FINANCE", scopeKey: "*" },
      { kind: "COLLECTIONS", scopeKey: "2026-02-01..2026-02-28" },
    ]);
    expect(plan("finance.refund.completed")).toEqual([
      { kind: "FINANCE", scopeKey: "*" },
      { kind: "COLLECTIONS", scopeKey: "2026-03-01..2026-03-31" },
    ]);
    expect(plan("finance.payment.initiated")).toEqual([]); // un paiement non confirmé n'est pas encaissé
    expect(plan("finance.cash_session.closed")).toEqual([{ kind: "CASH", scopeKey: "*" }]);
    expect(plan("payroll.payslip.approved")).toEqual([{ kind: "PAYROLL", scopeKey: "*" }]);
    expect(plan("payroll.claim.source_changed")).toEqual([]);
    expect(plan("unknown.event.happened")).toEqual([]);
  });

  it("la charge utile malformée dégrade en périmètre plus large, jamais en erreur", () => {
    expect(planRefreshes("academic.enrollment.created", null, at)).toEqual([{ kind: "ENROLLMENT", scopeKey: "*" }]);
    expect(planRefreshes("attendance.session.submitted", { date: 42 }, "garbage")).toEqual([{ kind: "ATTENDANCE", scopeKey: "1970-01-01..1970-01-01" }]);
  });

  it("chaque événement accepté par un motif d'abonnement et planifié l'est par un abonné, et inversement", () => {
    const matchers = SUBSCRIPTION_GROUPS.map((g) => g.pattern);
    const planned = [
      "academic.enrollment.created", "academic.classroom.activated", "people.student.status_changed", "people.teaching_assignment.created", "results.period.closed",
      "results.decision.confirmed", "attendance.session.validated", "attendance.staff_leave.cancelled", "finance.invoice.paid", "finance.cash_session.opened", "payroll.run.completed",
    ];
    for (const type of planned) {
      expect(planRefreshes(type, { classroomId: "C", academicPeriodId: "P", date: "2026-03-18", startsOn: "2026-03-02", endsOn: "2026-03-06" }, at).length, type).toBeGreaterThan(0);
      expect(matchers.some((m) => m.test(type)), type).toBe(true);
    }
    expect(matchers.some((m) => m.test("results.period_result.computed"))).toBe(false);
    expect(new Set(SUBSCRIPTION_GROUPS.map((g) => g.name)).size).toBe(SUBSCRIPTION_GROUPS.length);
    expect(buildSubscribers().map((s) => s.name)).toEqual(SUBSCRIPTION_GROUPS.map((g) => g.name));
  });

  it("intervalles : analyse, mois, bornage", () => {
    expect(parseRange("2026-03-01..2026-03-31")).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(parseRange("2026-03-31..2026-03-01")).toBeNull();
    expect(parseRange("*")).toBeNull();
    expect(monthRange("2024-02-10")).toBe("2024-02-01..2024-02-29");
    expect(addDays("2026-03-20", -30)).toBe("2026-02-18");
    expect(clampRange("2020-01-01..2026-03-20", "2026-03-20")).toEqual({ from: "2025-02-14", to: "2026-03-20" });
    expect(clampRange("2026-03-01..2027-01-01", "2026-03-20")).toEqual({ from: "2026-03-01", to: "2026-03-21" });
    expect(clampRange("bad", "2026-03-20")).toBeNull();
  });

  it("jobs et genres : noms stables, ordre des dépendances, délais de reprise croissants et plafonnés", () => {
    expect(jobs.map((j) => j.name)).toEqual(["analytics.process-refreshes", "analytics.nightly-rebuild"]);
    expect(Object.keys(KIND_ORDER).sort()).toEqual([...REFRESH_KINDS].sort());
    expect(KIND_ORDER.CALENDAR).toBeLessThan(KIND_ORDER.ENROLLMENT);
    expect([1, 2, 3, 4, 5, 6, 7].map(retryDelayMs)).toEqual([15_000, 30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });
});

describe("mesures pures", () => {
  it("rateBps : demi-supérieur, null si non mesurable", () => {
    expect(rateBps(1, 3)).toBe(3333);
    expect(rateBps(2, 3)).toBe(6667);
    expect(rateBps(0, 5)).toBe(0);
    expect(rateBps(5, 0)).toBeNull();
    expect(rateBps(1, -1)).toBeNull();
    expect(rateBps(Number.NaN, 4)).toBeNull();
  });

  it("readingStatus : neutre sans valeur ou sans seuil, jamais une couleur inventée", () => {
    const t = { goodBps: 8000, warningBps: 6000 };
    expect(readingStatus(8000, t)).toBe("good");
    expect(readingStatus(7999, t)).toBe("warning");
    expect(readingStatus(5999, t)).toBe("critical");
    expect(readingStatus(null, t)).toBe("neutral");
    expect(readingStatus(9000, { goodBps: null, warningBps: 6000 })).toBe("neutral");
  });

  it("histogramme : classes bornées, la dernière contient le maximum", () => {
    expect(binCount(20, 2)).toBe(10);
    expect(binCount(20, 3)).toBe(7);
    expect(binCount(0, 2)).toBe(0);
    expect(binIndex(0, 20, 2)).toBe(0);
    expect(binIndex(9.99, 20, 2)).toBe(4);
    expect(binIndex(10, 20, 2)).toBe(5);
    expect(binIndex(20, 20, 2)).toBe(9);
    expect(binIndex(25, 20, 2)).toBe(9);
    expect(binIndex(-3, 20, 2)).toBe(0);
    const bins = buildBins(new Map([[0, 2], [9, 1]]), 20, 2);
    expect(bins).toHaveLength(10);
    expect(bins[0]).toEqual({ index: 0, from: 0, to: 2, count: 2 });
    expect(bins[9]).toEqual({ index: 9, from: 18, to: 20, count: 1 });
  });

  it("empreinte : indépendante de l'ordre des clés, sensible au contenu", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});

describe("export CSV", () => {
  it("BOM, séparateur point-virgule, guillemets, nombres négatifs intacts, injection de formule neutralisée", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+33")).toBe("'+33");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-1 + 1")).toBe("'-1 + 1");
    expect(csvCell(-5000)).toBe("-5000");
    expect(csvCell('dit "oui"; non')).toBe('"dit ""oui""; non"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(true)).toBe("oui");
    const csv = toCsv([{ header: "Nom", value: (r: { n: string; v: number }) => r.n }, { header: "Montant", value: (r) => r.v }], [{ n: "Awa", v: -1500 }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿Nom;Montant\r\nAwa;-1500\r\n");
  });
});

describe("ports sources en mémoire", () => {
  it("lisent le monde, comptent les appels et simulent une panne", async () => {
    const world = new InMemoryAnalyticsWorld();
    world.years = [{ id: "y", institutionId: "i", code: "2025-2026", label: "A", startsOn: "2025-09-01", endsOn: "2026-07-01", status: "OPEN", isCurrent: true }];
    const ports = world.ports();
    expect(await ports.calendar.listYears(ctx)).toHaveLength(1);
    expect(world.calls["calendar.listYears"]).toBe(1);
    world.failing.add("payroll.readMass");
    await expect(ports.payroll.readMass(ctx)).rejects.toThrow(/en panne/);
    const none = await ports.results.readClassPeriod(ctx, { classroomId: "c", periodId: "p" });
    expect(none.state).toBe("NOT_FINAL");
  });
});

describe("module analytics : plugin chargé par le registre", () => {
  let app: FastifyInstance | undefined;
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined, child: () => quiet } as never;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    resetRegistryForTests();
  });

  async function boot(grant: string[] = [], features: string[] = [ANALYTICS_FEATURES.direction, ANALYTICS_FEATURES.payroll]) {
    const fake = makeFakeDb();
    const guarded: string[] = [];
    const runtime = {
      tenantDb: fake.db,
      clock: systemClock,
      logger: quiet,
      auditPort: { record: fake.audit.record, recordPlatform: async () => undefined },
      resolveContext: (request: { ctx?: unknown }) => request.ctx as RequestContext,
      requirePermission: (permission: string) => async () => {
        guarded.push(permission);
        if (!grant.includes(permission)) throw new ForbiddenError("Action non autorisée.", { details: { permission } });
      },
      entitlements: {
        requireFeature: (feature: string) => async () => {
          if (!features.includes(feature)) throw new ForbiddenError("Fonctionnalité non disponible.", { code: "entitlements.feature_not_available", details: { feature } });
        },
      },
    } as unknown as ModuleRuntime;

    app = Fastify({ logger: false });
    app.decorate("v2", {} as never);
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-tenant"]) (request as unknown as { ctx: RequestContext }).ctx = ctx;
    });
    const dir = resolve(__dirname, "..");
    const discovered: DiscoveredModule = { key: "analytics", dir, manifestPath: resolve(dir, "manifest.ts"), manifest, pluginPath: resolve(dir, "http", "plugin.ts"), migrationsDir: resolve(dir, "migrations") };
    const loaded = await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    return { app, fake, guarded, loaded };
  }

  it("monte les routes sous /api/v1/analytics avec la signature (app, runtime)", async () => {
    const { app: instance, loaded } = await boot([ANALYTICS_PERMISSIONS.charges]);
    expect(loaded.map((m) => m.prefix)).toEqual(["/api/v1/analytics"]);
    const res = await instance.inject({ method: "GET", url: "/api/v1/analytics/charges", headers: { "x-tenant": TENANT } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ available: false, reason: "MODULE_MISSING" });
    expect(res.json().meta.gaps.map((g: { reason: string }) => g.reason)).toContain("MODULE_MISSING");
    expect(res.headers["cache-control"]).toBe("private, max-age=15, must-revalidate");
    expect(res.headers.etag).toMatch(/^W\/"/);
    expect((await instance.inject({ method: "GET", url: "/charges", headers: { "x-tenant": TENANT } })).statusCode).toBe(404); // pas de double préfixe
  });

  it("répond 304 quand le contenu n'a pas changé (ETag)", async () => {
    const { app: instance } = await boot([ANALYTICS_PERMISSIONS.charges]);
    const first = await instance.inject({ method: "GET", url: "/api/v1/analytics/charges", headers: { "x-tenant": TENANT } });
    const again = await instance.inject({ method: "GET", url: "/api/v1/analytics/charges", headers: { "x-tenant": TENANT, "if-none-match": first.headers.etag as string } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe("");
  });

  it("refuse sans contexte (401), sans permission (403) et sans feature (403), avec des permissions du manifeste", async () => {
    const { app: instance, guarded } = await boot([ANALYTICS_PERMISSIONS.read], [ANALYTICS_FEATURES.direction]);
    expect((await instance.inject({ method: "GET", url: "/api/v1/analytics/overview" })).statusCode).toBe(401);
    const noPermission = await instance.inject({ method: "GET", url: "/api/v1/analytics/finance/summary", headers: { "x-tenant": TENANT } });
    expect(noPermission.statusCode).toBe(403);
    const noFeature = await instance.inject({ method: "GET", url: "/api/v1/analytics/payroll/mass", headers: { "x-tenant": TENANT } });
    expect(noFeature.statusCode).toBe(403);
    expect(guarded).toEqual(expect.arrayContaining([ANALYTICS_PERMISSIONS.finance, ANALYTICS_PERMISSIONS.payroll]));
    for (const permission of guarded) expect(manifest.permissions.map((p) => p.key)).toContain(permission);
  });

  it("l'export exige la permission du jeu de données ET analytics.export", async () => {
    const { app: instance, guarded } = await boot([ANALYTICS_PERMISSIONS.finance]);
    const denied = await instance.inject({ method: "GET", url: "/api/v1/analytics/export/receivables-by-learner.csv", headers: { "x-tenant": TENANT } });
    expect(denied.statusCode).toBe(403);
    expect(guarded[0]).toBe(ANALYTICS_PERMISSIONS.export);
    const { app: second, guarded: g2 } = await boot([ANALYTICS_PERMISSIONS.export]);
    const alsoDenied = await second.inject({ method: "GET", url: "/api/v1/analytics/export/payroll-mass.csv", headers: { "x-tenant": TENANT } });
    expect(alsoDenied.statusCode).toBe(403);
    expect(g2).toEqual([ANALYTICS_PERMISSIONS.export, ANALYTICS_PERMISSIONS.payroll]);
  });

  it("valide les paramètres (400) et les réglages", async () => {
    const { app: instance } = await boot([ANALYTICS_PERMISSIONS.read, ANALYTICS_PERMISSIONS.settings, ANALYTICS_PERMISSIONS.attendance]);
    const badYear = await instance.inject({ method: "GET", url: "/api/v1/analytics/enrollment?yearId=pas-un-uuid", headers: { "x-tenant": TENANT } });
    expect(badYear.statusCode).toBe(400);
    const badDate = await instance.inject({ method: "GET", url: "/api/v1/analytics/attendance?from=hier", headers: { "x-tenant": TENANT } });
    expect(badDate.statusCode).toBe(400);
    const empty = await instance.inject({ method: "PUT", url: "/api/v1/analytics/settings", headers: { "x-tenant": TENANT }, payload: {} });
    expect(empty.statusCode).toBe(400);
    const outOfRange = await instance.inject({ method: "PUT", url: "/api/v1/analytics/settings", headers: { "x-tenant": TENANT }, payload: { collectionGoodBps: 12000 } });
    expect(outOfRange.statusCode).toBe(400);
  });

  it("les événements publiés portent la clé du module", () => {
    expect(Object.values(AnalyticsEvents).every((e) => e.startsWith("analytics."))).toBe(true);
  });
});
