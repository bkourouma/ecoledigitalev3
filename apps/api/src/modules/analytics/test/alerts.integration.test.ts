/**
 * Intégration (Postgres réel, rôle applicatif soumis à la RLS). S'ignore sans TEST_DATABASE_URL.
 *
 * Alertes configurables de direction et indicateurs transverses (spec v2/025, partie B), sur l'année simulée :
 *  - règle -> évaluation -> alerte -> événement `analytics.alert.raised` (livré par `notifications`) ;
 *  - anti-doublon (créneau de fréquence, évaluations simultanées), rappel, accusé de réception, montée en gravité, résolution,
 *    historique ;
 *  - jamais d'alerte (ni de résolution) sur une donnée absente, périmée, en échec ou non officielle (règles de démonstration) ;
 *  - isolation A/B, périmètre campus, permission de données par indicateur, 404 uniforme ;
 *  - entonnoir d'admission, vie scolaire agrégée (comptages), comparaisons entre années et périodes, export CSV neutralisé.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import { ManualClock, createRequestContext, createSystemContext, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { ANALYTICS_ALERT_METRICS, analyticsAlertRuleCreateSchema, analyticsAlertsQuerySchema, analyticsAlertRaisedPayloadSchema, type AnalyticsAlertRuleCreate } from "@ecoledigitale/contracts/src/v2/analytics";
import allowlist from "../../isolation-allowlist.analytics";
import * as alerts from "../application/alerts";
import { createAnalyticsDeps } from "../application/deps";
import { exportDataset } from "../application/exports";
import * as indicators from "../application/indicators";
import { setAnalyticsWorkerPorts, resetAnalyticsWorkerPorts } from "../application/port-registry";
import * as q from "../application/queries";
import { rebuildTenant } from "../application/rebuild";
import type { AuditEntry } from "../application/ports";
import jobs from "../jobs";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "./support/db";
import { IDS, simulateYear, TODAY, type Simulation } from "./support/world";

const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const USER_B = "0192f0a4-7b1e-7c3a-8d2e-0000000000b2";
const ALL_METRICS: readonly string[] = ANALYTICS_ALERT_METRICS;
const NO_FINANCE = ALL_METRICS.filter((m) => m !== "COLLECTION_RATE" && m !== "OVERDUE_AMOUNT");
const day = (n: number): string => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describeIntegration("analytics : alertes de direction et indicateurs transverses (base réelle)", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;
  let sim: Simulation;
  const clock = new ManualClock(`${TODAY}T10:00:00.000Z`);
  const audits: AuditEntry[] = [];
  const sys = (tenant: string) => createSystemContext(tenant);
  const owner = (tenant: string, extra: { campusId?: string; institutionId?: string; userId?: string } = {}): RequestContext => createRequestContext({ tenantId: tenant, userId: extra.userId ?? USER, roles: ["owner"], mfa: true, ...extra });
  let deps: ReturnType<typeof createAnalyticsDeps>;
  const q1 = <T = Record<string, any>>(sql: string, params: unknown[] = []) => db.admin.query(sql, params).then((r) => r.rows as T[]);
  const events = (tenant: string, type: string) => q1<{ payload: Record<string, any> }>(`SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = $2 ORDER BY id`, [tenant, type]);
  const rule = (over: Partial<AnalyticsAlertRuleCreate> = {}): AnalyticsAlertRuleCreate =>
    analyticsAlertRuleCreateSchema.parse({ label: "Présence trop basse", metric: "ATTENDANCE_RATE", warningValue: 8500, criticalValue: 7000, recipientRoles: ["directeur", "owner"], frequency: "DAILY", ...over });

  /** Remplace les présences de la source simulée par un taux contrôlé, puis rafraîchit les read-models (reconstruction). */
  async function setAttendanceRate(rateBps: number | null, tenant = tenantA): Promise<void> {
    sim.world.attendance =
      rateBps === null
        ? []
        : [IDS.classA, IDS.classB].flatMap((classroomId) =>
            [-5, -4, -3, -2, -1, 0].map((d) => ({ day: day(d), classroomId, yearId: IDS.yearNow, institutionId: IDS.institution, campusId: classroomId === IDS.classA ? IDS.campusA : IDS.campusA, sessionsCount: 1, recordsCount: 100, presentCount: rateBps / 100, absentCount: 100 - rateBps / 100, excusedCount: 0, lateCount: 0, absentMinutes: 0 })),
          );
    await rebuildTenant(deps, sys(tenant));
  }
  /** Avance l'horloge d'un jour et relit les sources (la fraîcheur est exigée à l'évaluation). */
  async function nextDay(tenant = tenantA): Promise<void> {
    clock.advance(86_400_000 + 60_000);
    await rebuildTenant(deps, sys(tenant));
  }
  const alertOf = async (tenant: string, ruleId: string) => (await q1<Record<string, any>>(`SELECT * FROM analytics.alert_events WHERE tenant_id = $1 AND rule_id = $2 ORDER BY raised_at, id`, [tenant, ruleId]));

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("ecole-a");
    tenantB = await db.createTenant("ecole-b");
    sim = simulateYear();
    deps = createAnalyticsDeps({ db: db.tenantDb, clock, portsProvider: () => sim.world.ports(), audit: { async record(_tx, entry) { audits.push(entry); } } });
    await rebuildTenant(deps, sys(tenantA));
    await rebuildTenant(deps, sys(tenantB));
  });
  afterAll(async () => {
    resetAnalyticsWorkerPorts();
    await db?.drop();
  });

  it("assertTenantIsolation : les tables d'alertes et d'indicateurs sont isolées par tenant (RLS forcée)", async () => {
    const report = await assertTenantIsolation({ pool: db.appPool, schemas: ["analytics"], allowlist: allowlist.map((e) => e.table) });
    expect(report.violations).toEqual([]);
    const tables = (await q1<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'analytics'`)).map((t) => t.tablename);
    for (const t of ["alert_rules", "alert_events", "alert_notifications", "admissions_campaign_facts", "admissions_stage_facts", "schoollife_facts"]) expect(tables, t).toContain(t);
  });

  describe("cycle de vie d'une alerte : notification, anti-doublon, rappel, accusé de réception, gravité, résolution", () => {
    let ruleId: string;
    let alertId: string;

    it("crée la règle (audit), puis une évaluation sous le seuil critique ouvre UNE alerte et publie UN événement sans donnée personnelle", async () => {
      await setAttendanceRate(6000);
      const created = unwrap(await alerts.createRule(deps, owner(tenantA), rule(), ALL_METRICS));
      ruleId = created.id;
      expect(created).toMatchObject({ metric: "ATTENDANCE_RATE", comparator: "BELOW", unit: "BPS", warningValue: 8500, criticalValue: 7000, windowDays: 30, frequency: "DAILY", enabled: true, rowVersion: 1, recipientRoles: ["directeur", "owner"] });
      expect(audits.map((a) => a.action)).toContain("analytics.alert_rule.create");

      const r = await alerts.evaluateRule(deps, sys(tenantA), ruleId);
      expect(r).toMatchObject({ outcome: "CRITICAL", value: 6000, raised: true, notified: true });
      const rows = await alertOf(tenantA, ruleId);
      expect(rows).toHaveLength(1);
      alertId = rows[0]!.id as string;
      expect(rows[0]).toMatchObject({ severity: "CRITICAL", status: "OPEN", notify_count: 1, metric: "ATTENDANCE_RATE" });
      expect(Number(rows[0]!.value)).toBe(6000);
      expect(Number(rows[0]!.threshold)).toBe(7000);

      const raised = await events(tenantA, "analytics.alert.raised");
      expect(raised).toHaveLength(1);
      const payload = raised[0]!.payload;
      expect(analyticsAlertRaisedPayloadSchema.safeParse(payload).success).toBe(true);
      expect(payload).toMatchObject({ alertId, ruleId, metric: "ATTENDANCE_RATE", metricLabel: "Taux de présence des élèves", severity: "CRITICAL", reason: "RAISED", unit: "BPS", comparator: "BELOW", value: 6000, threshold: 7000, recipientRoles: ["directeur", "owner"] });
      expect(payload.dedupeKey).toBe(`${ruleId}:CRITICAL:${TODAY}`);
      expect(JSON.stringify(payload)).not.toMatch(/student|learner|nom|name|email|phone/i);
      const rule1 = (await q1(`SELECT last_outcome, last_value::text AS v FROM analytics.alert_rules WHERE id = $1`, [ruleId]))[0]!;
      expect(rule1).toMatchObject({ last_outcome: "CRITICAL", v: "6000" });
    });

    it("anti-doublon : réévaluer le même jour, ou évaluer 5 fois EN PARALLÈLE, n'émet jamais un second événement", async () => {
      expect(await alerts.evaluateRule(deps, sys(tenantA), ruleId)).toMatchObject({ outcome: "CRITICAL", raised: false, notified: false });
      clock.advance(3_600_000);
      await Promise.all([1, 2, 3, 4, 5].map(() => alerts.evaluateRule(deps, sys(tenantA), ruleId)));
      expect((await events(tenantA, "analytics.alert.raised")).length).toBe(1);
      expect((await q1(`SELECT count(*)::int AS n FROM analytics.alert_notifications WHERE tenant_id = $1`, [tenantA]))[0]!.n).toBe(1);
      expect(await alertOf(tenantA, ruleId)).toHaveLength(1); // une seule alerte active par règle
    });

    it("le créneau suivant (lendemain) émet un RAPPEL pour la même alerte, avec les mêmes destinataires", async () => {
      await nextDay();
      const r = await alerts.evaluateRule(deps, sys(tenantA), ruleId);
      expect(r).toMatchObject({ outcome: "CRITICAL", raised: false, notified: true });
      const raised = await events(tenantA, "analytics.alert.raised");
      expect(raised).toHaveLength(2);
      expect(raised[1]!.payload).toMatchObject({ alertId, reason: "REMINDER", recipientRoles: ["directeur", "owner"] });
      expect((await alertOf(tenantA, ruleId))[0]).toMatchObject({ notify_count: 2 });
    });

    it("accusé de réception : tracé (qui, quand, note), audité, publié ; les rappels s'arrêtent", async () => {
      const detail = unwrap(await alerts.acknowledgeAlert(deps, owner(tenantA), alertId, { note: "Pris en charge par la vie scolaire" }, ALL_METRICS));
      expect(detail).toMatchObject({ id: alertId, status: "ACKNOWLEDGED", acknowledgementNote: "Pris en charge par la vie scolaire" });
      expect(detail.acknowledgedAt).not.toBeNull();
      expect(audits.map((a) => a.action)).toContain("analytics.alert.acknowledge");
      expect((await events(tenantA, "analytics.alert.acknowledged"))[0]!.payload).toMatchObject({ alertId, acknowledgedBy: USER });
      expect((await q1(`SELECT acknowledged_by FROM analytics.alert_events WHERE id = $1`, [alertId]))[0]!.acknowledged_by).toBe(USER);
      // Idempotent : un second accusé ne republie rien.
      unwrap(await alerts.acknowledgeAlert(deps, owner(tenantA), alertId, {}, ALL_METRICS));
      expect((await events(tenantA, "analytics.alert.acknowledged")).length).toBe(1);

      await nextDay();
      expect(await alerts.evaluateRule(deps, sys(tenantA), ruleId)).toMatchObject({ outcome: "CRITICAL", notified: false });
      expect((await events(tenantA, "analytics.alert.raised")).length).toBe(2);
      expect(unwrap(await alerts.getAlert(deps, owner(tenantA), alertId, ALL_METRICS)).notifications.map((n) => n.reason)).toEqual(["RAISED", "REMINDER"]);
    });

    it("retour au niveau d'attention : la gravité baisse en silence ; une nouvelle chute sous le seuil critique ROUVRE l'alerte acquittée et notifie", async () => {
      await setAttendanceRate(8000);
      expect(await alerts.evaluateRule(deps, sys(tenantA), ruleId)).toMatchObject({ outcome: "WARNING", notified: false });
      expect((await alertOf(tenantA, ruleId))[0]).toMatchObject({ severity: "WARNING", status: "ACKNOWLEDGED" });
      await setAttendanceRate(5000);
      expect(await alerts.evaluateRule(deps, sys(tenantA), ruleId)).toMatchObject({ outcome: "CRITICAL", notified: true });
      expect((await alertOf(tenantA, ruleId))[0]).toMatchObject({ severity: "CRITICAL", status: "OPEN", acknowledged_at: null });
      expect((await events(tenantA, "analytics.alert.raised")).length).toBe(3);
    });

    it("retour à la normale : l'alerte est RÉSOLUE (événement, historique conservé) ; une rechute ouvre une NOUVELLE alerte", async () => {
      await setAttendanceRate(9500);
      expect(await alerts.evaluateRule(deps, sys(tenantA), ruleId)).toMatchObject({ outcome: "OK", resolved: true });
      expect((await alertOf(tenantA, ruleId))[0]).toMatchObject({ status: "RESOLVED" });
      expect(Number((await alertOf(tenantA, ruleId))[0]!.resolved_value)).toBe(9500);
      expect((await events(tenantA, "analytics.alert.resolved"))[0]!.payload).toMatchObject({ alertId, ruleId, resolvedValue: 9500 });

      const history = unwrap(await alerts.listAlerts(deps, owner(tenantA), analyticsAlertsQuerySchema.parse({ ruleId }), ALL_METRICS));
      expect(history.counts).toEqual({ open: 0, acknowledged: 0, resolved: 1 });
      expect(history.alerts[0]).toMatchObject({ id: alertId, status: "RESOLVED", ruleLabel: "Présence trop basse" });

      await nextDay();
      await setAttendanceRate(6500);
      expect(await alerts.evaluateRule(deps, sys(tenantA), ruleId)).toMatchObject({ outcome: "CRITICAL", raised: true, notified: true });
      const all = await alertOf(tenantA, ruleId);
      expect(all).toHaveLength(2);
      expect(all[1]!.id).not.toBe(alertId);
      const listed = unwrap(await alerts.listAlerts(deps, owner(tenantA), analyticsAlertsQuerySchema.parse({}), ALL_METRICS));
      expect(listed.total).toBe(2);
      expect(listed.alerts[0]!.status).toBe("OPEN"); // les alertes actives d'abord
      expect(listed.alerts[1]!.status).toBe("RESOLVED");
    });

    it("on ne peut plus accuser réception d'une alerte résolue (409)", async () => {
      const r = await alerts.acknowledgeAlert(deps, owner(tenantA), alertId, {}, ALL_METRICS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("conflict");
    });
  });

  describe("jamais d'alerte (ni de résolution) sur une donnée qui n'est pas une mesure fiable", () => {
    let ruleId: string;
    it("donnée périmée : évaluation SOURCE_UNAVAILABLE, l'alerte active n'est PAS résolue et rien n'est publié", async () => {
      await setAttendanceRate(6000);
      ruleId = unwrap(await alerts.createRule(deps, owner(tenantA), rule({ label: "Présence (périmée)", frequency: "HOURLY" }), ALL_METRICS)).id;
      expect(await alerts.evaluateRule(deps, sys(tenantA), ruleId)).toMatchObject({ outcome: "CRITICAL", raised: true });
      const before = (await events(tenantA, "analytics.alert.raised")).length;
      clock.advance(3 * 86_400_000); // 3 jours sans aucune relecture des sources
      const stale = await alerts.evaluateRule(deps, sys(tenantA), ruleId);
      expect(stale).toMatchObject({ outcome: "SOURCE_UNAVAILABLE", notified: false, resolved: false });
      expect((await alertOf(tenantA, ruleId))[0]).toMatchObject({ status: "OPEN" });
      expect((await events(tenantA, "analytics.alert.raised")).length).toBe(before);
      expect((await q1(`SELECT last_outcome FROM analytics.alert_rules WHERE id = $1`, [ruleId]))[0]!.last_outcome).toBe("SOURCE_UNAVAILABLE");
    });

    it("lecture en échec : manque déclaré (FAILED) => pas d'évaluation", async () => {
      await rebuildTenant(deps, sys(tenantA));
      sim.world.failing.add("attendance.readDays");
      clock.advance(60_000);
      await rebuildTenant(deps, sys(tenantA)); // la relecture des présences échoue : état FAILED
      sim.world.failing.delete("attendance.readDays");
      expect(await alerts.evaluateRule(deps, sys(tenantA), ruleId)).toMatchObject({ outcome: "SOURCE_UNAVAILABLE" });
      await rebuildTenant(deps, sys(tenantA));
      expect(await alerts.evaluateRule(deps, sys(tenantA), ruleId)).toMatchObject({ outcome: "CRITICAL" }); // rétablie
    });

    it("aucune mesure (aucun pointage) : NOT_MEASURED, jamais un zéro qui déclencherait ou résoudrait", async () => {
      await setAttendanceRate(null);
      const r = await alerts.evaluateRule(deps, sys(tenantA), ruleId);
      expect(r).toMatchObject({ outcome: "NOT_MEASURED", value: null, resolved: false, notified: false });
      expect((await alertOf(tenantA, ruleId))[0]).toMatchObject({ status: "OPEN" });
      await setAttendanceRate(6000);
    });

    it("règles de démonstration (source placeholder) : le taux de validation n'est pas mesuré et aucune alerte n'en dérive", async () => {
      for (const [key, cp] of sim.world.classPeriods) sim.world.classPeriods.set(key, { ...cp, rulesSourceKind: "placeholder" });
      await rebuildTenant(deps, sys(tenantA));
      const vr = unwrap(await alerts.createRule(deps, owner(tenantA), rule({ label: "Validation basse", metric: "VALIDATION_RATE", warningValue: 9999, criticalValue: 9000, windowDays: null, recipientRoles: ["directeur"] }), ALL_METRICS));
      expect(await alerts.evaluateRule(deps, sys(tenantA), vr.id)).toMatchObject({ outcome: "NOT_MEASURED", notified: false });
      expect(await alertOf(tenantA, vr.id)).toHaveLength(0);

      // Source officielle : le même taux est mesuré et l'alerte peut naître.
      for (const [key, cp] of sim.world.classPeriods) sim.world.classPeriods.set(key, { ...cp, rulesSourceKind: "regulation" });
      await rebuildTenant(deps, sys(tenantA));
      expect(await alerts.evaluateRule(deps, sys(tenantA), vr.id)).toMatchObject({ raised: true });
    });
  });

  describe("provenance des règles : bandeau « règles de démonstration »", () => {
    it("résultats, vue d'ensemble et comparaison portent le drapeau tant qu'une période repose sur des règles placeholder", async () => {
      const key = `${IDS.classA}|${IDS.p2}`;
      const first = sim.world.classPeriods.get(key)!;
      expect(first.state).toBe("FINAL");
      sim.world.classPeriods.set(key, { ...first, rulesSourceKind: "placeholder" });
      await rebuildTenant(deps, sys(tenantA));
      const results = unwrap(await q.getResults(deps, owner(tenantA), {})).data;
      expect(results.rulesSource.demonstration).toBe(true);
      expect(results.rulesSource.placeholderClassPeriods).toBeGreaterThanOrEqual(1);
      expect(results.byPeriod.some((p) => p.demonstration)).toBe(true);
      expect(results.byPeriod.some((p) => !p.demonstration)).toBe(true);
      const overview = unwrap(await q.getOverview(deps, owner(tenantA))).data;
      expect(overview.results.demonstration).toBe(true); // la dernière période clôturée repose sur des règles de démonstration
      const p1Only = unwrap(await q.getResults(deps, owner(tenantA), { periodId: IDS.p1 })).data;
      expect(p1Only.rulesSource.demonstration).toBe(false); // la période 1 repose sur des règles officielles
      const cmp = unwrap(await indicators.compareResults(deps, owner(tenantA), { baselinePeriodId: IDS.p1, targetPeriodId: IDS.p2 })).data;
      expect(cmp.baseline.demonstration || cmp.target.demonstration).toBe(true);

      for (const [key, cp] of sim.world.classPeriods) sim.world.classPeriods.set(key, { ...cp, rulesSourceKind: "regulation" });
      await rebuildTenant(deps, sys(tenantA));
      expect(unwrap(await q.getResults(deps, owner(tenantA), {})).data.rulesSource).toMatchObject({ demonstration: false, placeholderClassPeriods: 0, unknownClassPeriods: 0 });
      // Provenance illisible : jamais présentée comme officielle.
      for (const [key, cp] of sim.world.classPeriods) sim.world.classPeriods.set(key, { ...cp, rulesSourceKind: null });
      await rebuildTenant(deps, sys(tenantA));
      expect(unwrap(await q.getResults(deps, owner(tenantA), {})).data.rulesSource.unknownClassPeriods).toBeGreaterThan(0);
      for (const [key, cp] of sim.world.classPeriods) sim.world.classPeriods.set(key, { ...cp, rulesSourceKind: "regulation" });
      await rebuildTenant(deps, sys(tenantA));
    });
  });

  describe("isolation A/B, périmètre, permissions de données, 404 uniforme", () => {
    let aRule: string;
    let aAlert: string;
    beforeAll(async () => {
      await setAttendanceRate(6000);
      aRule = unwrap(await alerts.createRule(deps, owner(tenantA), rule({ label: "Présence A (isolation)", metric: "ATTENDANCE_RATE" }), ALL_METRICS)).id;
      await alerts.evaluateRule(deps, sys(tenantA), aRule);
      aAlert = (await alertOf(tenantA, aRule))[0]!.id as string;
    });

    it("le tenant B ne voit, ne lit, n'acquitte ni ne modifie rien du tenant A (404 uniforme)", async () => {
      const ctxB = owner(tenantB, { userId: USER_B });
      expect(unwrap(await alerts.listAlerts(deps, ctxB, analyticsAlertsQuerySchema.parse({}), ALL_METRICS)).total).toBe(0);
      expect(unwrap(await alerts.listRules(deps, ctxB, ALL_METRICS)).rules).toEqual([]);
      const missing = await alerts.getAlert(deps, ctxB, "0192f0a4-7b1e-7c3a-8d2e-00000000ffff", ALL_METRICS);
      const foreign = await alerts.getAlert(deps, ctxB, aAlert, ALL_METRICS);
      expect(!foreign.ok && !missing.ok && foreign.error.kind === "not_found" && missing.error.kind === "not_found").toBe(true);
      if (!foreign.ok && !missing.ok) {
        expect(foreign.error.message).toBe(missing.error.message);
        expect(foreign.error.code).toBe(missing.error.code);
      }
      const ack = await alerts.acknowledgeAlert(deps, ctxB, aAlert, {}, ALL_METRICS);
      expect(!ack.ok && ack.error.kind === "not_found").toBe(true);
      const upd = await alerts.updateRule(deps, ctxB, aRule, { ...rule(), rowVersion: 1 }, ALL_METRICS);
      expect(!upd.ok && upd.error.kind === "not_found").toBe(true);
      // La base elle-même (rôle applicatif, RLS) ne renvoie rien de A depuis le contexte B.
      const rows = await db.tenantDb.run(ctxB, (tx) => tx.many(`SELECT id FROM analytics.alert_events UNION ALL SELECT id FROM analytics.alert_rules UNION ALL SELECT id FROM analytics.alert_notifications`), { readOnly: true });
      expect(rows).toEqual([]);
      // Et l'évaluation de B ne touche pas A.
      const report = await alerts.evaluateTenant(deps, sys(tenantB));
      expect(report.rules).toBe(0);
    });

    it("l'écriture croisée est refusée par la base : une ligne d'alerte d'un autre tenant ne peut pas être insérée", async () => {
      await expect(
        db.tenantDb.run(owner(tenantB, { userId: USER_B }), (tx) =>
          tx.query(`INSERT INTO analytics.alert_rules (tenant_id, id, label, metric, warning_value, recipient_roles, frequency, created_at, updated_at) VALUES ($1, gen_random_uuid(), 'x y z', 'ATTENDANCE_RATE', 1, ARRAY['directeur'], 'DAILY', now(), now())`, [tenantA]),
        ),
      ).rejects.toThrow();
    });

    it("sans la permission de données d'un indicateur, ses alertes n'existent pas : même 404 qu'une alerte inconnue", async () => {
      const finance = unwrap(await alerts.createRule(deps, owner(tenantA), rule({ label: "Recouvrement bas", metric: "COLLECTION_RATE", warningValue: 9999, criticalValue: null, windowDays: null, campusId: IDS.campusA, recipientRoles: ["econome"] }), ALL_METRICS));
      expect(await alerts.evaluateRule(deps, sys(tenantA), finance.id)).toMatchObject({ raised: true });
      const financeAlert = (await alertOf(tenantA, finance.id))[0]!.id as string;

      const listed = unwrap(await alerts.listAlerts(deps, owner(tenantA), analyticsAlertsQuerySchema.parse({}), NO_FINANCE));
      expect(listed.alerts.some((a) => a.metric === "COLLECTION_RATE")).toBe(false);
      expect(unwrap(await alerts.listRules(deps, owner(tenantA), NO_FINANCE)).rules.some((r) => r.metric === "COLLECTION_RATE")).toBe(false);
      const hidden = await alerts.getAlert(deps, owner(tenantA), financeAlert, NO_FINANCE);
      const unknown = await alerts.getAlert(deps, owner(tenantA), "0192f0a4-7b1e-7c3a-8d2e-00000000fffe", NO_FINANCE);
      expect(!hidden.ok && !unknown.ok && hidden.error.code === unknown.error.code && hidden.error.message === unknown.error.message).toBe(true);
      expect((await alerts.acknowledgeAlert(deps, owner(tenantA), financeAlert, {}, NO_FINANCE)).ok).toBe(false);
      // Ni créer ni modifier une règle sur un indicateur hors des droits.
      const create = await alerts.createRule(deps, owner(tenantA), rule({ metric: "COLLECTION_RATE", windowDays: null, campusId: IDS.campusA }), NO_FINANCE);
      expect(!create.ok && create.error.kind === "forbidden").toBe(true);
      const upd = await alerts.updateRule(deps, owner(tenantA), finance.id, { ...rule({ metric: "COLLECTION_RATE", windowDays: null, campusId: IDS.campusA }), rowVersion: finance.rowVersion }, NO_FINANCE);
      expect(!upd.ok).toBe(true);
      expect(alerts.listMetrics(NO_FINANCE).metrics.map((m) => m.metric)).not.toContain("COLLECTION_RATE");
    });

    it("un utilisateur limité à un campus : règle forcée sur SON campus, alertes du tenant entier invisibles, autre campus refusé", async () => {
      const campusUser = owner(tenantA, { campusId: IDS.campusA, institutionId: IDS.institution });
      const mine = unwrap(await alerts.createRule(deps, campusUser, rule({ label: "Présence campus A" }), ALL_METRICS));
      expect(mine).toMatchObject({ campusId: IDS.campusA, institutionId: IDS.institution });
      const other = await alerts.createRule(deps, campusUser, rule({ campusId: IDS.campusB }), ALL_METRICS);
      expect(!other.ok && other.error.kind === "forbidden").toBe(true);
      const otherInstitution = await alerts.createRule(deps, campusUser, rule({ institutionId: IDS.yearNow }), ALL_METRICS);
      expect(otherInstitution.ok).toBe(false);

      const rules = unwrap(await alerts.listRules(deps, campusUser, ALL_METRICS)).rules;
      expect(rules.map((r) => r.id)).toContain(mine.id);
      expect(rules.every((r) => r.campusId === IDS.campusA)).toBe(true);
      expect(rules.some((r) => r.id === aRule)).toBe(false); // la règle sans périmètre (établissement entier) lui est invisible
      await alerts.evaluateRule(deps, sys(tenantA), mine.id);
      const seen = unwrap(await alerts.listAlerts(deps, campusUser, analyticsAlertsQuerySchema.parse({}), ALL_METRICS));
      expect(seen.alerts.every((a) => a.campusId === IDS.campusA)).toBe(true);
      expect(seen.alerts.length).toBeGreaterThanOrEqual(1);
      const wide = await alerts.getAlert(deps, campusUser, aAlert, ALL_METRICS); // alerte sans périmètre : hors de portée
      expect(!wide.ok && wide.error.kind === "not_found").toBe(true);
      // Les mêmes bornes que partout ailleurs sur les indicateurs de direction.
      expect((await indicators.getAdmissionsFunnel(deps, owner(tenantA, { campusId: IDS.campusA }))).ok).toBe(false);
      expect((await indicators.getSchoolLife(deps, owner(tenantA, { campusId: IDS.campusA }))).ok).toBe(false);
    });
  });

  describe("validation et configuration des règles", () => {
    it("refuse : seuils incohérents, fenêtre sur un indicateur sans fenêtre, campus inconnu, campus d'un autre établissement, campus requis pour la facturation", async () => {
      const bad = async (over: Partial<AnalyticsAlertRuleCreate>) => alerts.createRule(deps, owner(tenantA), rule(over), ALL_METRICS);
      const inverted = await bad({ warningValue: 5000, criticalValue: 7000 });
      expect(!inverted.ok && inverted.error.kind === "validation").toBe(true);
      const over100 = await bad({ warningValue: 12_000, criticalValue: null });
      expect(!over100.ok && over100.error.kind === "validation").toBe(true);
      const window = await bad({ metric: "ENROLLMENT_IN_SCHOOLING", warningValue: 100, criticalValue: 50, windowDays: 10 });
      expect(!window.ok && window.error.kind === "validation").toBe(true);
      const unknownCampus = await bad({ campusId: "0192f0a4-7b1e-7c3a-8d2e-00000000eeee" });
      expect(!unknownCampus.ok && unknownCampus.error.kind === "validation").toBe(true);
      const needsCampus = await bad({ metric: "COLLECTION_RATE", windowDays: null, institutionId: IDS.institution, warningValue: 7000, criticalValue: 5000 });
      expect(!needsCampus.ok && needsCampus.error.kind === "validation").toBe(true);
      if (!needsCampus.ok) expect(JSON.stringify(needsCampus.error)).toContain("campus_required");
    });

    it("mise à jour sous contrôle de version ; désactiver une règle résout son alerte active", async () => {
      const created = unwrap(await alerts.createRule(deps, owner(tenantA), rule({ label: "Présence (mise à jour)", frequency: "WEEKLY" }), ALL_METRICS));
      await setAttendanceRate(6000);
      await alerts.evaluateRule(deps, sys(tenantA), created.id);
      expect((await alertOf(tenantA, created.id))[0]).toMatchObject({ status: "OPEN" });

      const renamed = unwrap(await alerts.updateRule(deps, owner(tenantA), created.id, { ...rule({ label: "Présence (renommée)", frequency: "WEEKLY" }), rowVersion: 1 }, ALL_METRICS));
      expect(renamed).toMatchObject({ label: "Présence (renommée)", rowVersion: 2 });
      expect((await alertOf(tenantA, created.id))[0]).toMatchObject({ status: "OPEN" }); // contexte inchangé : l'alerte continue
      const stale = await alerts.updateRule(deps, owner(tenantA), created.id, { ...rule(), rowVersion: 1 }, ALL_METRICS);
      expect(!stale.ok && stale.error.kind === "conflict").toBe(true);

      const disabled = unwrap(await alerts.updateRule(deps, owner(tenantA), created.id, { ...rule({ label: "Présence (renommée)", frequency: "WEEKLY", enabled: false }), rowVersion: 2 }, ALL_METRICS));
      expect(disabled.enabled).toBe(false);
      expect((await alertOf(tenantA, created.id))[0]).toMatchObject({ status: "RESOLVED" });
      expect(await alerts.evaluateRule(deps, sys(tenantA), created.id)).toMatchObject({ outcome: "SKIPPED" }); // une règle désactivée n'est pas évaluée
      expect(audits.filter((a) => a.action === "analytics.alert_rule.update").length).toBeGreaterThanOrEqual(2);
    });

    it("fréquence : HEURE / JOUR / SEMAINE / MOIS délimitent bien les rappels", async () => {
      await setAttendanceRate(6000);
      const make = async (label: string, frequency: AnalyticsAlertRuleCreate["frequency"]) => unwrap(await alerts.createRule(deps, owner(tenantA), rule({ label, frequency, metric: "SCHOOLLIFE_OPEN_INCIDENTS", warningValue: 0, criticalValue: null, windowDays: null, recipientRoles: ["directeur"] }), ALL_METRICS));
      sim.world.schoolLife = [{ institutionKey: "*", values: { OPEN_INCIDENTS: 7, MEASURES_TO_VALIDATE: 2, ACTIVE_EXCLUSIONS: 1, CONVOCATIONS_TO_HOLD: 3 } }];
      await rebuildTenant(deps, sys(tenantA));
      const hourly = await make("Incidents (heure)", "HOURLY");
      const weekly = await make("Incidents (semaine)", "WEEKLY");
      const monthly = await make("Incidents (mois)", "MONTHLY");
      const emitted = async (id: string) => (await q1<{ n: number }>(`SELECT count(*)::int AS n FROM analytics.alert_notifications n JOIN analytics.alert_events e ON e.id = n.alert_id WHERE e.rule_id = $1`, [id]))[0]!.n;
      const evalAll = async () => {
        for (const id of [hourly.id, weekly.id, monthly.id]) await alerts.evaluateRule(deps, sys(tenantA), id);
      };
      await evalAll();
      expect([await emitted(hourly.id), await emitted(weekly.id), await emitted(monthly.id)]).toEqual([1, 1, 1]);
      clock.advance(2 * 3_600_000);
      await rebuildTenant(deps, sys(tenantA));
      await evalAll();
      expect([await emitted(hourly.id), await emitted(weekly.id), await emitted(monthly.id)]).toEqual([2, 1, 1]); // deux heures plus tard : seule la règle horaire rappelle
      await nextDay();
      await evalAll();
      const [h, w, m] = [await emitted(hourly.id), await emitted(weekly.id), await emitted(monthly.id)];
      expect(h).toBe(3);
      expect(w).toBeLessThanOrEqual(2);
      expect(m).toBeLessThanOrEqual(2);
      clock.advance(8 * 86_400_000);
      await rebuildTenant(deps, sys(tenantA));
      await evalAll();
      expect(await emitted(weekly.id)).toBeGreaterThan(w - 1);
      expect(await emitted(weekly.id)).toBeGreaterThanOrEqual(2);
    });
  });

  describe("indicateurs de direction : entonnoir d'admission, vie scolaire agrégée, comparaisons", () => {
    beforeAll(async () => {
      sim.world.admissions = [
        {
          campaignId: "0192f0a4-7b1e-7c3a-8d2e-00000000a001",
          institutionId: IDS.institution,
          yearId: IDS.yearNow,
          code: "ADM-2026",
          label: "Campagne 2026-2027",
          status: "OPEN",
          seats: 120,
          seatsLeft: 70,
          stages: [
            { code: "DEPOSE", label: "Déposé", canonicalStatus: "SUBMITTED", ordinal: 1, isTerminal: false, applications: 40 },
            { code: "ETUDE", label: "En étude", canonicalStatus: "UNDER_REVIEW", ordinal: 2, isTerminal: false, applications: 25 },
            { code: "ACCEPTE", label: "Accepté", canonicalStatus: "ACCEPTED", ordinal: 3, isTerminal: false, applications: 20 },
            { code: "INSCRIT", label: "Inscrit", canonicalStatus: "ENROLLED", ordinal: 4, isTerminal: true, applications: 30 },
            { code: "REFUSE", label: "Refusé", canonicalStatus: "REJECTED", ordinal: 5, isTerminal: true, applications: 10 },
            { code: "BROUILLON", label: "Brouillon", canonicalStatus: "DRAFT", ordinal: 0, isTerminal: false, applications: 5 },
          ],
        },
      ];
      sim.world.schoolLife = [
        { institutionKey: "*", values: { OPEN_INCIDENTS: 7, MEASURES_TO_VALIDATE: 2, ACTIVE_EXCLUSIONS: 1, CONVOCATIONS_TO_HOLD: 3 } },
        { institutionKey: IDS.institution, values: { OPEN_INCIDENTS: 7, MEASURES_TO_VALIDATE: 2, ACTIVE_EXCLUSIONS: 1, CONVOCATIONS_TO_HOLD: 3 } },
      ];
      await rebuildTenant(deps, sys(tenantA));
    });

    it("entonnoir : répartition par statut canonique, taux d'acceptation et d'inscription, places ; des COMPTAGES, jamais un candidat", async () => {
      const r = unwrap(await indicators.getAdmissionsFunnel(deps, owner(tenantA)));
      expect(r.data.totals).toMatchObject({ applications: 130, submitted: 125, accepted: 50, enrolled: 30, rejected: 10, seats: 120, seatsLeft: 70, acceptanceRateBps: 4000, enrollmentRateBps: 6000 });
      expect(r.data.byStatus.find((s) => s.status === "DRAFT")?.count).toBe(5);
      expect(r.data.campaigns[0]!.stages.map((s) => s.code)).toEqual(["BROUILLON", "DEPOSE", "ETUDE", "ACCEPTE", "INSCRIT", "REFUSE"]);
      expect(r.meta.gaps).toEqual([]);
      expect(r.meta.sources.ADMISSIONS).not.toBeNull();
      const cols = (await q1<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'analytics' AND table_name IN ('admissions_campaign_facts','admissions_stage_facts','schoollife_facts')`)).map((c) => c.column_name);
      for (const personal of ["student_id", "applicant_id", "application_id", "name", "email", "phone", "first_name", "last_name", "birth_date"]) expect(cols, personal).not.toContain(personal);
      // Filtre par année : une autre année ne montre rien.
      expect(unwrap(await indicators.getAdmissionsFunnel(deps, owner(tenantA), { yearId: IDS.yearPrev })).data.campaigns).toEqual([]);
      // Isolation : le tenant B n'a rien lu d'admissions.
      const b = unwrap(await indicators.getAdmissionsFunnel(deps, owner(tenantB)));
      expect(b.data.campaigns).toEqual([]);
    });

    it("vie scolaire : quatre comptages STANDARD, aucune clé individuelle ; non mesuré tant que non lu", async () => {
      const r = unwrap(await indicators.getSchoolLife(deps, owner(tenantA)));
      expect(r.data.scopeConfidentiality).toBe("STANDARD");
      expect(Object.fromEntries(r.data.indicators.map((i) => [i.indicator, i.value]))).toEqual({ OPEN_INCIDENTS: 7, MEASURES_TO_VALIDATE: 2, ACTIVE_EXCLUSIONS: 1, CONVOCATIONS_TO_HOLD: 3 });
      expect(Object.keys(r.data).sort()).toEqual(["indicators", "institutionId", "scopeConfidentiality"]);
      const none = unwrap(await indicators.getSchoolLife(deps, owner(tenantB)));
      expect(none.data.indicators.every((i) => i.value === null && i.measured === false)).toBe(true);
    });

    it("comparaison de deux années (effectifs) : valeurs des deux côtés, écart, variation relative ; un côté non mesuré donne null", async () => {
      const c = unwrap(await indicators.compareEnrollment(deps, owner(tenantA), { baselineYearId: IDS.yearPrev, targetYearId: IDS.yearNow })).data;
      const inSchooling = c.metrics.find((m) => m.key === "inSchooling")!;
      const direct = sim.enrollments.filter((e) => e.yearId === IDS.yearNow && e.inSchooling).length;
      expect(inSchooling.target).toBe(direct);
      expect(inSchooling.baseline).toBe(0); // l'inscription de l'année précédente est « terminée » : 0 en scolarité mais l'année est mesurée
      expect(inSchooling.delta).toBe(direct);
      expect(inSchooling.changeBps).toBeNull(); // référence nulle : pas de variation relative inventée
    });

    it("comparaison d'inscriptions : année inconnue refusée ; paramètres manquants refusés", async () => {
      const unknown = await indicators.compareEnrollment(deps, owner(tenantA), { baselineYearId: "0192f0a4-7b1e-7c3a-8d2e-00000000dddd", targetYearId: IDS.yearNow });
      expect(unknown.ok).toBe(false);
      const missing = await indicators.compareEnrollment(deps, owner(tenantA), { targetYearId: IDS.yearNow });
      expect(!missing.ok && missing.error.kind === "validation").toBe(true);
    });

    it("comparaison de deux fenêtres de présence et de deux périodes de résultats : calcul direct sur la source", async () => {
      await setAttendanceRate(9000);
      const att = unwrap(await indicators.compareAttendance(deps, owner(tenantA), { baselineFrom: day(-30), baselineTo: day(-10), targetFrom: day(-5), targetTo: day(0) })).data;
      const rate = att.metrics.find((m) => m.key === "rateBps")!;
      expect(rate.baseline).toBeNull(); // aucune donnée avant J-9 : non mesuré (pas 0 %)
      expect(rate.target).toBe(9000);
      expect(rate.delta).toBeNull();
      const same = unwrap(await indicators.compareAttendance(deps, owner(tenantA), { baselineFrom: day(-5), baselineTo: day(-3), targetFrom: day(-2), targetTo: day(0) })).data;
      expect(same.metrics.find((m) => m.key === "rateBps")).toMatchObject({ baseline: 9000, target: 9000, delta: 0, changeBps: 0 });
      const inverted = await indicators.compareAttendance(deps, owner(tenantA), { baselineFrom: day(0), baselineTo: day(-5), targetFrom: day(-2), targetTo: day(0) });
      expect(inverted.ok).toBe(false);

      const res = unwrap(await indicators.compareResults(deps, owner(tenantA), { baselinePeriodId: IDS.p1, targetPeriodId: IDS.p2 })).data;
      const mean = (period: string) => {
        const rows = [IDS.classA, IDS.classB, IDS.classC, IDS.classD].flatMap((c) => sim.world.classPeriods.get(`${c}|${period}`)?.results ?? []);
        return rows.length;
      };
      expect(res.metrics.find((m) => m.key === "count")).toMatchObject({ baseline: mean(IDS.p1), target: mean(IDS.p2) });
      const fin = unwrap(await indicators.compareFinance(deps, owner(tenantA, { campusId: IDS.campusA }), { baselineYearId: IDS.yearPrev, targetYearId: IDS.yearNow })).data;
      expect(fin.metrics.find((m) => m.key === "collected")!.baseline).toBeNull(); // pas de facturation pour l'année précédente : non mesuré
      expect(fin.metrics.find((m) => m.key === "collected")!.target).toBe(sim.world.finance.get(`${"2025-2026"}|${IDS.campusA}`)!.summary.collected);
    });
  });

  describe("export CSV : neutralisation des formules et droits", () => {
    it("l'historique d'alertes exporte les libellés et notes sans formule exécutable ; l'export est audité", async () => {
      await setAttendanceRate(6000);
      const evil = unwrap(await alerts.createRule(deps, owner(tenantA), rule({ label: '=HYPERLINK("http://evil.example";"clic")', frequency: "DAILY" }), ALL_METRICS));
      await alerts.evaluateRule(deps, sys(tenantA), evil.id);
      const evilAlert = (await alertOf(tenantA, evil.id))[0]!.id as string;
      unwrap(await alerts.acknowledgeAlert(deps, owner(tenantA), evilAlert, { note: "@SUM(A1:A9)+cmd|' /C calc'!A0" }, ALL_METRICS));
      const before = audits.length;
      const out = unwrap(await exportDataset(deps, owner(tenantA), "alerts-history", { alertMetrics: ALL_METRICS }));
      expect(out.csv.startsWith("﻿")).toBe(true);
      expect(out.csv).toContain(`"'=HYPERLINK(""http://evil.example"";""clic"")"`);
      expect(out.csv).toContain("'@SUM(A1:A9)+cmd|' /C calc'!A0");
      for (const line of out.csv.split("\r\n").slice(1)) for (const cell of line.split(";")) expect(cell).not.toMatch(/^[=+@]/);
      expect(out.rows).toBeGreaterThan(3);
      expect(audits.length).toBe(before + 1);
      expect(audits.at(-1)).toMatchObject({ action: "analytics.export.download", entityId: "alerts-history" });
    });

    it("l'export respecte la visibilité : sans l'indicateur, ses alertes sont absentes du fichier", async () => {
      const finance = unwrap(await alerts.createRule(deps, owner(tenantA), rule({ label: "Impayés (export)", metric: "OVERDUE_AMOUNT", warningValue: 1, criticalValue: null, windowDays: null, campusId: IDS.campusA, recipientRoles: ["econome"] }), ALL_METRICS));
      await alerts.evaluateRule(deps, sys(tenantA), finance.id);
      const all = unwrap(await exportDataset(deps, owner(tenantA), "alerts-history", { alertMetrics: ALL_METRICS })).csv;
      const hidden = unwrap(await exportDataset(deps, owner(tenantA), "alerts-history", { alertMetrics: NO_FINANCE })).csv;
      expect(all).toContain("Impayés (export)");
      expect(hidden).not.toContain("Impayés (export)");
    });

    it("entonnoir et vie scolaire s'exportent en CSV (BOM, point-virgule)", async () => {
      const funnel = unwrap(await exportDataset(deps, owner(tenantA), "admissions-funnel", {}));
      expect(funnel.csv).toContain("Campagne 2026-2027;OPEN;120;Déposé;SUBMITTED;40");
      const life = unwrap(await exportDataset(deps, owner(tenantA), "schoollife-summary", {}));
      expect(life.csv).toContain("OPEN_INCIDENTS;7;oui");
    });
  });

  describe("job du worker : analytics.evaluate-alerts", () => {
    it("évalue chaque tenant, publie les alertes dues et ne plante pas sur un tenant sans règle", async () => {
      const job = jobs.find((j) => j.name === "analytics.evaluate-alerts");
      expect(job).toBeDefined();
      expect(job).toMatchObject({ cron: "*/15 * * * *" });
      setAnalyticsWorkerPorts(sim.world.ports());
      const logs: string[] = [];
      const logger = { info: (_o: unknown, m: string) => logs.push(m), error: (_o: unknown, m: string) => logs.push(m), warn: () => undefined, debug: () => undefined, child: () => logger } as never;
      const systemDb = {
        forEachTenant: async (_name: string, fn: (tx: never, tenant: { id: string }) => Promise<unknown>) => {
          const succeeded: Array<{ tenantId: string; result: unknown }> = [];
          const failed: Array<{ tenantId: string; error: unknown }> = [];
          for (const id of [tenantA, tenantB]) {
            try {
              succeeded.push({ tenantId: id, result: await fn(undefined as never, { id }) });
            } catch (error) {
              failed.push({ tenantId: id, error });
            }
          }
          return { succeeded, failed };
        },
      } as never;
      await rebuildTenant(deps, sys(tenantA));
      await rebuildTenant(deps, sys(tenantB));
      const before = (await events(tenantA, "analytics.alert.raised")).length;
      clock.advance(86_400_000 + 60_000);
      await rebuildTenant(deps, sys(tenantA));
      await rebuildTenant(deps, sys(tenantB));
      // Le job lit l'horloge système : on la fige sur celle du scénario (la fraîcheur des sources en dépend).
      vi.useFakeTimers({ toFake: ["Date"], now: clock.now() });
      try {
        await (job as unknown as { handler: (ctx: unknown) => Promise<void> }).handler({ systemDb, tenantDb: db.tenantDb, logger });
      } finally {
        vi.useRealTimers();
      }
      expect((await events(tenantA, "analytics.alert.raised")).length).toBeGreaterThan(before);
      expect((await events(tenantB, "analytics.alert.raised")).length).toBe(0);
      expect(logs.some((m) => m.includes("alertes évaluées"))).toBe(true);
    });
  });
});
