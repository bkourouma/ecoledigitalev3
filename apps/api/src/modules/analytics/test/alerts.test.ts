/**
 * Tests unitaires (sans base) des alertes et indicateurs transverses de direction (spec v2/025, partie B) :
 * règles pures (gravité, seuils, créneaux de fréquence, formatage), catalogue des indicateurs, contrats, garde-fous HTTP
 * (permissions, 404 uniforme, validation) et neutralisation CSV. Les scénarios Postgres sont dans `alerts.integration.test.ts`.
 */
import { resolve } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, createRequestContext, systemClock, type RequestContext } from "@ecoledigitale/kernel";
import {
  ANALYTICS_ALERT_METRICS,
  ANALYTICS_FEATURES,
  ANALYTICS_PERMISSIONS as P,
  analyticsAlertRaisedPayloadSchema,
  analyticsAlertRuleCreateSchema,
  analyticsEventPayloadSchemas,
} from "@ecoledigitale/contracts/src/v2/analytics";
import { registerModules, resetRegistryForTests, type DiscoveredModule } from "../../registry";
import type { ModuleRuntime } from "../../../platform/runtime";
import { ALERT_METRICS, alertMetricDef } from "../domain/alert-metrics";
import { formatAlertValue, frequencyBucket, isoWeek, notificationKey, reasonOf, severityOf, thresholdIssues } from "../domain/alerts";
import { AnalyticsEvents } from "../domain/events";
import { toCsv } from "../domain/csv";
import manifest from "../manifest";
import { makeFakeDb } from "./support/fakes";

const TENANT = "0192f0a4-7b1e-7c3a-8d2e-0000000000a1";
const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const ctx: RequestContext = createRequestContext({ tenantId: TENANT, userId: USER });
const UUID = "0192f0a4-7b1e-7c3a-8d2e-0000000000c1";

describe("alertes : gravité d'une valeur (franchissement strict)", () => {
  it("BELOW : sous le seuil critique, sous le seuil d'attention, ou rien", () => {
    const t = { warning: 8000, critical: 6000 };
    expect(severityOf("BELOW", 5999, t)).toEqual({ severity: "CRITICAL", threshold: 6000 });
    expect(severityOf("BELOW", 6000, t)).toEqual({ severity: "WARNING", threshold: 8000 }); // égal au critique : pas critique (strict), mais sous l'attention
    expect(severityOf("BELOW", 7999, t)).toEqual({ severity: "WARNING", threshold: 8000 });
    expect(severityOf("BELOW", 8000, t)).toBeNull(); // égal au seuil : pas de dépassement
    expect(severityOf("BELOW", 9000, t)).toBeNull();
  });

  it("ABOVE : au-dessus du seuil critique, au-dessus de l'attention, ou rien", () => {
    const t = { warning: 100, critical: 500 };
    expect(severityOf("ABOVE", 501, t)).toEqual({ severity: "CRITICAL", threshold: 500 });
    expect(severityOf("ABOVE", 500, t)).toEqual({ severity: "WARNING", threshold: 100 });
    expect(severityOf("ABOVE", 100, t)).toBeNull();
  });

  it("un seul seuil suffit ; aucun seuil ne déclenche jamais", () => {
    expect(severityOf("BELOW", 10, { warning: null, critical: 20 })).toEqual({ severity: "CRITICAL", threshold: 20 });
    expect(severityOf("ABOVE", 10, { warning: 5, critical: null })).toEqual({ severity: "WARNING", threshold: 5 });
    expect(severityOf("BELOW", 0, { warning: null, critical: null })).toBeNull();
  });

  it("zéro est une VALEUR (et pas « non mesuré ») : 0 % de présence franchit un seuil BELOW", () => {
    expect(severityOf("BELOW", 0, { warning: 7000, critical: null })).toEqual({ severity: "WARNING", threshold: 7000 });
  });
});

describe("alertes : cohérence des seuils", () => {
  const below = { unit: "BPS", comparator: "BELOW" } as const;
  const above = { unit: "AMOUNT", comparator: "ABOVE" } as const;

  it("exige au moins un seuil, des entiers positifs, un taux plafonné à 100 %", () => {
    expect(thresholdIssues(below, null, null)).toHaveLength(1);
    expect(thresholdIssues(below, 7000, 5000)).toEqual([]);
    expect(thresholdIssues(below, 10_001, null).join(" ")).toMatch(/100 %/);
    expect(thresholdIssues(below, -1, null).join(" ")).toMatch(/positif/);
    expect(thresholdIssues(above, 1.5, null).join(" ")).toMatch(/entier/);
  });

  it("le seuil critique est plus grave que l'attention (sens du dépassement)", () => {
    expect(thresholdIssues(below, 5000, 7000).join(" ")).toMatch(/critique doit être inférieur/);
    expect(thresholdIssues(above, 500_000, 100_000).join(" ")).toMatch(/critique doit être supérieur/);
    expect(thresholdIssues(above, 100_000, 500_000)).toEqual([]);
  });
});

describe("alertes : créneaux de fréquence (anti-doublon)", () => {
  const at = new Date("2026-03-20T10:15:00.000Z");
  it("HOURLY / DAILY / WEEKLY / MONTHLY", () => {
    expect(frequencyBucket("HOURLY", at)).toBe("2026-03-20T10");
    expect(frequencyBucket("DAILY", at)).toBe("2026-03-20");
    expect(frequencyBucket("WEEKLY", at)).toBe("2026-S12");
    expect(frequencyBucket("MONTHLY", at)).toBe("2026-03");
  });

  it("deux évaluations du même créneau donnent la même clé, un créneau suivant une autre", () => {
    const rule = UUID;
    const same = [new Date("2026-03-20T00:00:00.000Z"), new Date("2026-03-20T23:59:59.000Z")].map((d) => notificationKey(rule, "WARNING", frequencyBucket("DAILY", d)));
    expect(same[0]).toBe(same[1]);
    expect(notificationKey(rule, "WARNING", frequencyBucket("DAILY", new Date("2026-03-21T00:00:00.000Z")))).not.toBe(same[0]);
    expect(notificationKey(rule, "CRITICAL", "2026-03-20")).not.toBe(notificationKey(rule, "WARNING", "2026-03-20")); // la montée en gravité se notifie
  });

  it("semaine ISO : bornes d'année", () => {
    expect(isoWeek(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-S01");
    expect(isoWeek(new Date("2021-01-03T00:00:00.000Z"))).toBe("2020-S53");
    expect(isoWeek(new Date("2024-12-30T00:00:00.000Z"))).toBe("2025-S01");
  });

  it("raison de la notification : première, montée en gravité, rappel", () => {
    expect(reasonOf(null, "WARNING")).toBe("RAISED");
    expect(reasonOf("WARNING", "CRITICAL")).toBe("ESCALATED");
    expect(reasonOf("CRITICAL", "CRITICAL")).toBe("REMINDER");
    expect(reasonOf("CRITICAL", "WARNING")).toBe("REMINDER");
  });
});

describe("alertes : formatage neutre des valeurs", () => {
  it("taux, montants, comptages", () => {
    expect(formatAlertValue("BPS", 6250, null)).toBe("62,5 %");
    expect(formatAlertValue("BPS", 7000, null)).toBe("70 %");
    expect(formatAlertValue("AMOUNT", 1_250_000, "XOF")).toBe("1 250 000 XOF");
    expect(formatAlertValue("AMOUNT", 5000, null)).toBe("5 000");
    expect(formatAlertValue("COUNT", 12, null)).toBe("12");
  });
});

describe("alertes : catalogue des indicateurs", () => {
  it("couvre exactement les indicateurs des contrats, chacun avec une permission du manifeste", () => {
    expect(ALERT_METRICS.map((m) => m.metric).sort()).toEqual([...ANALYTICS_ALERT_METRICS].sort());
    const keys = manifest.permissions.map((p) => p.key);
    for (const m of ALERT_METRICS) {
      expect(keys, m.metric).toContain(m.permission);
      expect(m.kinds.length, m.metric).toBeGreaterThan(0);
      expect(m.label.length, m.metric).toBeGreaterThan(5);
    }
  });

  it("aucun indicateur ne porte de donnée d'élève ni de salaire : jamais de permission nominative ou de paie", () => {
    for (const m of ALERT_METRICS) {
      expect(m.permission, m.metric).not.toBe(P.payroll);
      expect(m.label, m.metric).not.toMatch(/nom|élève :|salaire/i);
    }
  });

  it("indicateurs fenêtrés : une fenêtre par défaut ; autres : aucune", () => {
    for (const m of ALERT_METRICS) expect(m.windowed ? m.defaultWindowDays !== null : m.defaultWindowDays === null, m.metric).toBe(true);
    expect(alertMetricDef("ATTENDANCE_RATE")?.comparator).toBe("BELOW");
    expect(alertMetricDef("OVERDUE_AMOUNT")?.comparator).toBe("ABOVE");
    expect(alertMetricDef("INCONNU")).toBeUndefined();
  });
});

describe("alertes : contrats", () => {
  const valid = { label: "Présence trop basse", metric: "ATTENDANCE_RATE", warningValue: 8500, criticalValue: 7000, recipientRoles: ["directeur", "owner"] };

  it("accepte une règle complète et applique les défauts (fréquence quotidienne, active)", () => {
    const parsed = analyticsAlertRuleCreateSchema.parse(valid);
    expect(parsed.frequency).toBe("DAILY");
    expect(parsed.enabled).toBe(true);
  });

  it("refuse : aucun seuil, aucun destinataire, trop de rôles, rôle mal formé, champ inconnu", () => {
    expect(analyticsAlertRuleCreateSchema.safeParse({ ...valid, warningValue: null, criticalValue: null }).success).toBe(false);
    expect(analyticsAlertRuleCreateSchema.safeParse({ ...valid, recipientRoles: [] }).success).toBe(false);
    expect(analyticsAlertRuleCreateSchema.safeParse({ ...valid, recipientRoles: Array.from({ length: 9 }, (_, i) => `role_${i}`) }).success).toBe(false);
    expect(analyticsAlertRuleCreateSchema.safeParse({ ...valid, recipientRoles: ["Directeur Général"] }).success).toBe(false);
    expect(analyticsAlertRuleCreateSchema.safeParse({ ...valid, metric: "SALAIRES" }).success).toBe(false);
    expect(analyticsAlertRuleCreateSchema.safeParse({ ...valid, tenantId: UUID }).success).toBe(false);
  });

  it("la charge de analytics.alert.raised est minimale : aucun nom, aucune donnée d'élève", () => {
    const shape = Object.keys(analyticsAlertRaisedPayloadSchema.shape);
    expect(shape).toEqual(expect.arrayContaining(["alertId", "metric", "metricLabel", "severity", "value", "threshold", "recipientRoles", "dedupeKey"]));
    for (const forbidden of ["studentId", "studentName", "learnerId", "name", "email", "phone"]) expect(shape).not.toContain(forbidden);
  });

  it("les charges d'événements publiés correspondent aux types déclarés par le manifeste", () => {
    expect(Object.keys(analyticsEventPayloadSchemas).sort()).toEqual([AnalyticsEvents.ALERT_ACKNOWLEDGED, AnalyticsEvents.ALERT_RAISED, AnalyticsEvents.ALERT_RESOLVED].sort());
    for (const type of Object.keys(analyticsEventPayloadSchemas)) expect(manifest.events.publishes).toContain(type);
  });
});

describe("alertes : export CSV neutralisé contre l'injection de formule", () => {
  it("un libellé de règle ou une note d'acquittement commençant par = + - @ est préfixé d'une apostrophe", () => {
    const rows = [{ ruleLabel: '=HYPERLINK("http://x";"clic")', note: "@SUM(1+1)", plus: "+33 1 23", minus: "-2+3", tab: "\tcmd", value: -1500 }];
    const csv = toCsv(
      [
        { header: "Règle", value: (r: (typeof rows)[number]) => r.ruleLabel },
        { header: "Note", value: (r) => r.note },
        { header: "Plus", value: (r) => r.plus },
        { header: "Moins", value: (r) => r.minus },
        { header: "Tab", value: (r) => r.tab },
        { header: "Valeur", value: (r) => r.value },
      ],
      rows,
    );
    const body = csv.split("\r\n")[1] as string;
    expect(body).toContain(`"'=HYPERLINK(""http://x"";""clic"")"`);
    expect(body).toContain("'@SUM(1+1)");
    expect(body).toContain("'+33 1 23");
    expect(body).toContain("'-2+3");
    expect(body).toContain("'\tcmd");
    expect(body.endsWith(";-1500")).toBe(true); // un nombre négatif reste un nombre
  });
});

describe("alertes et indicateurs : garde-fous HTTP (registre, permissions, 404 uniforme, validation)", () => {
  let app: FastifyInstance | undefined;
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined, child: () => quiet } as never;
  afterEach(async () => {
    await app?.close();
    app = undefined;
    resetRegistryForTests();
  });

  async function boot(grant: string[], features: string[] = [ANALYTICS_FEATURES.direction]) {
    if (app) {
      await app.close();
      resetRegistryForTests();
    }
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
    await registerModules(app, { enabled: true, discovered: [discovered], runtime, logger: quiet });
    return { app, fake, guarded };
  }
  const get = (url: string) => ({ method: "GET" as const, url: `/api/v1/analytics${url}`, headers: { "x-tenant": TENANT } });

  it("le catalogue d'alertes ne montre que les indicateurs dont l'appelant détient la permission de données", async () => {
    const { app: instance } = await boot([P.alertsRead, P.finance]);
    const res = await instance.inject(get("/alerts/metrics"));
    expect(res.statusCode).toBe(200);
    expect(res.json().metrics.map((m: { metric: string }) => m.metric).sort()).toEqual(["COLLECTION_RATE", "OVERDUE_AMOUNT"]);
  });

  it("chaque route est gardée par la permission du manifeste (lecture, acquittement, gestion) et la feature", async () => {
    const { app: instance, guarded } = await boot([P.alertsRead]);
    expect((await instance.inject(get("/alerts"))).statusCode).toBe(200);
    const denied = await instance.inject({ method: "POST", url: "/api/v1/analytics/alerts/rules", headers: { "x-tenant": TENANT }, payload: { label: "Test seuil", metric: "ATTENDANCE_RATE", warningValue: 8000, recipientRoles: ["directeur"] } });
    expect(denied.statusCode).toBe(403);
    const ack = await instance.inject({ method: "POST", url: `/api/v1/analytics/alerts/${UUID}/acknowledge`, headers: { "x-tenant": TENANT }, payload: {} });
    expect(ack.statusCode).toBe(403);
    const put = await instance.inject({ method: "PUT", url: `/api/v1/analytics/alerts/rules/${UUID}`, headers: { "x-tenant": TENANT }, payload: {} });
    expect(put.statusCode).toBe(403);
    expect(guarded).toEqual(expect.arrayContaining([P.alertsRead, P.alertsManage, P.alertsAcknowledge]));
    for (const permission of guarded) expect(manifest.permissions.map((p) => p.key)).toContain(permission);

    const { app: noFeature } = await boot([P.alertsRead], []);
    expect((await noFeature.inject(get("/alerts"))).statusCode).toBe(403);
    expect((await noFeature.inject({ method: "GET", url: "/api/v1/analytics/alerts" })).statusCode).toBe(401);
  });

  it("404 UNIFORME : alerte inexistante, identifiant mal formé et alerte d'un indicateur non permis se ressemblent", async () => {
    const { app: instance } = await boot([P.alertsRead]);
    const missing = await instance.inject(get(`/alerts/${UUID}`));
    const malformed = await instance.inject(get("/alerts/pas-un-uuid"));
    const ackMalformed = await instance.inject({ method: "POST", url: "/api/v1/analytics/alerts/xyz/acknowledge", headers: { "x-tenant": TENANT }, payload: {} });
    expect(missing.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
    expect(missing.json().message).toBe(malformed.json().message);
    expect(missing.json().code).toBe(malformed.json().code);
    expect(ackMalformed.statusCode).toBe(403); // sans permission d'acquittement : la garde passe avant
    const { app: acker } = await boot([P.alertsRead, P.alertsAcknowledge]);
    const ackMissing = await acker.inject({ method: "POST", url: `/api/v1/analytics/alerts/${UUID}/acknowledge`, headers: { "x-tenant": TENANT }, payload: {} });
    expect(ackMissing.statusCode).toBe(404);
    expect(ackMissing.json().code).toBe(missing.json().code);
  });

  it("refuse une règle sur un indicateur hors des droits de l'appelant (403) et valide le corps (400)", async () => {
    const { app: instance } = await boot([P.alertsManage, P.alertsRead, P.attendance]);
    const forbiddenMetric = await instance.inject({ method: "POST", url: "/api/v1/analytics/alerts/rules", headers: { "x-tenant": TENANT }, payload: { label: "Recouvrement bas", metric: "COLLECTION_RATE", warningValue: 6000, recipientRoles: ["econome"] } });
    expect(forbiddenMetric.statusCode).toBe(403);
    expect(forbiddenMetric.json().code).toBe("analytics.alert_metric_forbidden");
    for (const payload of [
      { label: "ab", metric: "ATTENDANCE_RATE", warningValue: 8000, recipientRoles: ["directeur"] },
      { label: "Sans seuil", metric: "ATTENDANCE_RATE", recipientRoles: ["directeur"] },
      { label: "Sans rôle", metric: "ATTENDANCE_RATE", warningValue: 8000, recipientRoles: [] },
      { label: "Champ en trop", metric: "ATTENDANCE_RATE", warningValue: 8000, recipientRoles: ["directeur"], tenantId: UUID },
    ]) {
      const res = await instance.inject({ method: "POST", url: "/api/v1/analytics/alerts/rules", headers: { "x-tenant": TENANT }, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const badQuery = await instance.inject(get("/alerts?status=INCONNU"));
    expect(badQuery.statusCode).toBe(400);
  });

  it("indicateurs transverses : admissions, vie scolaire et comparaisons exigent leur permission ; une comparaison incomplète est refusée (400)", async () => {
    const { app: instance, guarded } = await boot([P.read]);
    expect((await instance.inject(get("/admissions/funnel"))).statusCode).toBe(403);
    expect((await instance.inject(get("/schoollife/summary"))).statusCode).toBe(403);
    expect((await instance.inject(get("/compare/finance"))).statusCode).toBe(403);
    expect((await instance.inject(get("/compare/results"))).statusCode).toBe(403);
    expect((await instance.inject(get("/compare/attendance"))).statusCode).toBe(403);
    expect(guarded).toEqual(expect.arrayContaining([P.admissions, P.schoollife, P.finance, P.pedagogy, P.attendance]));
    const missing = await instance.inject(get("/compare/enrollment?baselineYearId=" + UUID));
    expect(missing.statusCode).toBe(400);
    const unknownField = await instance.inject(get("/compare/enrollment?foo=bar"));
    expect(unknownField.statusCode).toBe(400);
  });

  it("l'export de l'historique des alertes exige analytics.export ET analytics.alerts.read", async () => {
    const { app: instance, guarded } = await boot([P.export]);
    expect((await instance.inject(get("/export/alerts-history.csv"))).statusCode).toBe(403);
    expect(guarded).toEqual([P.export, P.alertsRead]);
    for (const dataset of ["admissions-funnel", "schoollife-summary"]) expect((await instance.inject(get(`/export/${dataset}.csv`))).statusCode).toBe(403);
  });
});
