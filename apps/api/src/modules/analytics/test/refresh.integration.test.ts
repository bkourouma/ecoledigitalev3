/**
 * Intégration (Postgres réel, rôle applicatif soumis à la RLS). S'ignore sans TEST_DATABASE_URL.
 *
 * Preuve du module : une ANNÉE SIMULÉE (ports en mémoire) est reconstruite dans les read-models, puis chaque agrégat de
 * l'API est comparé au calcul DIRECT sur la source (cohérence read-model / source) ; la reconstruction est idempotente ;
 * le flux événement -> demande coalescée -> rafraîchissement est exercé, avec échec, reprise, source absente, période
 * rouverte et isolation entre tenants.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation } from "@ecoledigitale/database";
import { ManualClock, createRequestContext, createSystemContext, unwrap } from "@ecoledigitale/kernel";
import allowlist from "../../isolation-allowlist.analytics";
import { createAnalyticsDeps } from "../application/deps";
import { rebuildTenant, summarize } from "../application/rebuild";
import { enqueueFromEvent, processDueRefreshes } from "../application/requests";
import { refreshLeaf } from "../application/refresh";
import * as q from "../application/queries";
import { binIndex, rateBps } from "../domain/metrics";
import { createModuleTestDb, describeIntegration, type ModuleTestDb } from "./support/db";
import { count, IDS, mean, round2, simulateYear, sum, TODAY, YEAR_CODE, uuid, type Simulation } from "./support/world";

const USER = "0192f0a4-7b1e-7c3a-8d2e-0000000000b1";
const FACT_TABLES = [
  "dim_scope", "dim_year", "dim_period", "dim_classroom", "enrollment_facts", "result_facts", "result_line_facts", "result_scopes",
  "attendance_daily", "staff_presence_facts", "finance_summary", "finance_by_group", "finance_by_learner", "finance_aged",
  "finance_aged_learner", "collections_daily", "cash_session_facts", "payroll_status_facts", "teaching_load_facts",
] as const;

describeIntegration("analytics : année simulée, rafraîchissement et cohérence read-model / source", () => {
  let db: ModuleTestDb;
  let tenantA: string;
  let tenantB: string;
  let sim: Simulation;
  const clock = new ManualClock("2026-03-20T10:00:00.000Z");
  const sys = (tenant: string) => createSystemContext(tenant);
  const owner = (tenant: string, extra: { campusId?: string; institutionId?: string } = {}) => createRequestContext({ tenantId: tenant, userId: USER, roles: ["owner"], mfa: true, ...extra });
  const depsOf = (ports: () => ReturnType<Simulation["world"]["ports"]> | Record<string, never> = () => sim.world.ports()) => createAnalyticsDeps({ db: db.tenantDb, clock, portsProvider: ports });
  let deps: ReturnType<typeof depsOf>;

  async function dump(tenant: string): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const t of FACT_TABLES) {
      const r = await db.admin.query(`SELECT (to_jsonb(x) - 'refreshed_at' - 'computed_at')::text AS j FROM analytics.${t} x WHERE tenant_id = $1 ORDER BY 1`, [tenant]);
      out[t] = r.rows.map((row) => row.j as string);
    }
    return out;
  }

  beforeAll(async () => {
    db = await createModuleTestDb();
    tenantA = await db.createTenant("ecole-a");
    tenantB = await db.createTenant("ecole-b");
    sim = simulateYear();
    deps = depsOf();
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("assertTenantIsolation : chaque table du schéma analytics est isolée par tenant (RLS forcée)", async () => {
    const report = await assertTenantIsolation({ pool: db.appPool, schemas: ["analytics"], allowlist: allowlist.map((e) => e.table) });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    expect(report.behavioural.length).toBeGreaterThanOrEqual(5);
  });

  describe("reconstruction depuis les sources", () => {
    it("reconstruit tous les genres, déclare l'état de fraîcheur de chacun et publie les instantanés", async () => {
      const outcomes = await rebuildTenant(deps, sys(tenantA));
      const report = summarize(tenantA, outcomes);
      expect(report.failed).toBe(0);
      expect(report.unavailable).toBe(0);
      expect(report.ok).toBe(outcomes.length);

      const fresh = unwrap(await q.getFreshness(deps, owner(tenantA))).data;
      const kinds = new Set(fresh.states.map((s) => s.kind));
      for (const k of ["CALENDAR", "ENROLLMENT", "RESULTS", "ATTENDANCE", "STAFF_PRESENCE", "FINANCE", "COLLECTIONS", "CASH", "PAYROLL", "TEACHING_LOAD"]) expect(kinds.has(k as never), k).toBe(true);
      expect(fresh.states.every((s) => s.lastStatus === "OK" && s.lastSuccessAt !== null)).toBe(true);

      const events = await db.admin.query(`SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'analytics.snapshot.refreshed'`, [tenantA]);
      expect(events.rows[0].n).toBeGreaterThan(5);
    });

    it("est idempotente : une seconde reconstruction donne EXACTEMENT les mêmes read-models, sans nouvel événement", async () => {
      const before = await dump(tenantA);
      const eventsBefore = (await db.admin.query(`SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'analytics.snapshot.refreshed'`, [tenantA])).rows[0].n as number;
      clock.advance(60_000);
      const outcomes = await rebuildTenant(deps, sys(tenantA));
      expect(outcomes.every((o) => o.status === "OK")).toBe(true);
      expect(outcomes.some((o) => o.changed)).toBe(false);
      expect(await dump(tenantA)).toEqual(before);
      const eventsAfter = (await db.admin.query(`SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'analytics.snapshot.refreshed'`, [tenantA])).rows[0].n as number;
      expect(eventsAfter).toBe(eventsBefore);
    });

    it("un simple rafraîchissement sans changement n'écrit rien mais avance l'horodatage de vérification (asOf)", async () => {
      const before = unwrap(await q.getEnrollment(deps, owner(tenantA))).meta.sources.ENROLLMENT as string;
      clock.advance(120_000);
      const r = await refreshLeaf(deps, sys(tenantA), { kind: "ENROLLMENT", scopeKey: "*" });
      expect(r).toMatchObject({ status: "OK", changed: false });
      const after = unwrap(await q.getEnrollment(deps, owner(tenantA))).meta.sources.ENROLLMENT as string;
      expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
    });
  });

  describe("cohérence des agrégats avec la source simulée", () => {
    const yearEnrollments = () => sim.enrollments.filter((e) => e.yearId === IDS.yearNow);

    it("vue d'ensemble : effectif, présence du jour, moyenne générale de la dernière période FINAL, enseignants présents", async () => {
      const { data, meta } = unwrap(await q.getOverview(deps, owner(tenantA)));
      const inSchooling = yearEnrollments().filter((e) => e.inSchooling);
      expect(data.headcount).toEqual({ inSchooling: inSchooling.length, total: yearEnrollments().length, classrooms: new Set(inSchooling.map((e) => e.classroomId)).size });

      const today = sim.world.attendance.filter((a) => a.day === TODAY);
      expect(data.attendanceToday).toMatchObject({ day: TODAY, recordsCount: sum(today.map((a) => a.recordsCount)), presentCount: sum(today.map((a) => a.presentCount)), absentCount: sum(today.map((a) => a.absentCount)), measured: true });
      expect(data.attendanceToday.rateBps).toBe(rateBps(sum(today.map((a) => a.presentCount)), sum(today.map((a) => a.recordsCount))));

      const p2 = [IDS.classA, IDS.classB].flatMap((c) => sim.world.classPeriods.get(`${c}|${IDS.p2}`)?.results ?? []);
      expect(data.results.periodId).toBe(IDS.p2);
      expect(data.results.cohortSize).toBe(p2.length);
      expect(data.results.generalAverage).toBeCloseTo(round2(mean(p2.map((r) => Number(r.average)))), 1);
      expect(data.results.validatedCount).toBe(count(p2, (r) => r.validated === true));
      expect(data.results.validationRateBps).toBe(rateBps(count(p2, (r) => r.validated === true), count(p2, (r) => r.validated !== null)));

      const staffToday = sim.world.staffPresence.filter((s) => s.day === TODAY);
      expect(data.staffToday).toMatchObject({ present: count(staffToday, (s) => s.present), absent: count(staffToday, (s) => s.absent && !s.onLeave), onLeave: count(staffToday, (s) => s.onLeave), measured: true });
      expect(meta.asOf).not.toBeNull();
      expect(meta.gaps).toEqual([]);
      expect(meta.scope.yearId).toBe(IDS.yearNow);
    });

    it("effectifs et répartitions : statut, sexe, niveau, financement, campus, classe, redoublants, admissions", async () => {
      const { data } = unwrap(await q.getEnrollment(deps, owner(tenantA)));
      const all = yearEnrollments();
      const cnt = (rows: Array<{ key: string; count: number }>, key: string) => rows.find((r) => r.key === key)?.count ?? 0;
      expect(data.totals.total).toBe(all.length);
      expect(data.totals.inSchooling).toBe(count(all, (e) => e.inSchooling));
      expect(data.totals.repeaters).toBe(count(all, (e) => e.inSchooling && e.isRepeating));
      expect(data.totals.repeaterRateBps).toBe(rateBps(count(all, (e) => e.inSchooling && e.isRepeating), count(all, (e) => e.inSchooling)));
      for (const status of new Set(all.map((e) => e.status))) expect(cnt(data.byStatus, status), status).toBe(count(all, (e) => e.status === status));
      expect(cnt(data.bySex, "M")).toBe(count(all, (e) => e.sex === "M"));
      expect(cnt(data.bySex, "F")).toBe(count(all, (e) => e.sex === "F"));
      expect(cnt(data.byFunding, "STATE_ASSIGNED")).toBe(count(all, (e) => e.fundingType === "STATE_ASSIGNED"));
      expect(cnt(data.byGradeLevel, "6E")).toBe(count(all, (e) => sim.classrooms.find((c) => c.id === e.classroomId)?.gradeLevelCode === "6E"));
      expect(cnt(data.byCampus, IDS.campusA)).toBe(count(all, (e) => e.campusId === IDS.campusA));
      expect(data.byClassroom).toHaveLength(4);
      for (const row of data.byClassroom) {
        const members = all.filter((e) => e.classroomId === row.classroomId);
        expect(row.count).toBe(members.length);
        expect(row.male + row.female).toBe(count(members, (e) => e.inSchooling && e.sex !== null));
      }
      expect(data.admissions.created).toBe(all.length);
      expect(data.admissions.confirmed).toBe(count(all, (e) => e.confirmedAt !== null));
      expect(data.admissions.cancelled).toBe(count(all, (e) => e.cancelledAt !== null));
      expect(data.admissions.bySource.find((s) => s.sourceKind === "ADMISSION")?.created).toBe(count(all, (e) => e.sourceKind === "ADMISSION"));
      expect(sum(data.admissions.monthly.map((m) => m.created))).toBe(all.length);
    });

    it("présences : totaux, jours, classes — et fenêtre explicite", async () => {
      const { data } = unwrap(await q.getAttendance(deps, owner(tenantA)));
      const rows = sim.world.attendance;
      expect(data.totals.recordsCount).toBe(sum(rows.map((r) => r.recordsCount)));
      expect(data.totals.presentCount).toBe(sum(rows.map((r) => r.presentCount)));
      expect(data.totals.absentMinutes).toBe(sum(rows.map((r) => r.absentMinutes)));
      expect(data.totals.rateBps).toBe(rateBps(sum(rows.map((r) => r.presentCount)), sum(rows.map((r) => r.recordsCount))));
      expect(data.byDay).toHaveLength(10);
      expect(data.byClassroom).toHaveLength(4);
      expect(data.staff.measured).toBe(true);
      expect(sum(data.staff.byDay.map((d) => d.present))).toBe(count(sim.world.staffPresence, (s) => s.present));
      const one = unwrap(await q.getAttendance(deps, owner(tenantA), { from: TODAY, to: TODAY })).data;
      expect(one.byDay).toHaveLength(1);
      expect(one.range).toEqual({ from: TODAY, to: TODAY });
      const bad = await q.getAttendance(deps, owner(tenantA), { from: "2026-03-10", to: "2026-03-01" });
      expect(bad.ok).toBe(false);
    });

    it("résultats : moyennes, validation, distribution, matières, périodes, décisions — tous issus des FINAL", async () => {
      const { data, meta } = unwrap(await q.getResults(deps, owner(tenantA), { periodId: IDS.p1 }));
      const p1 = [IDS.classA, IDS.classB, IDS.classC, IDS.classD].flatMap((c) => sim.world.classPeriods.get(`${c}|${IDS.p1}`)?.results ?? []);
      expect(meta.scope.periodId).toBe(IDS.p1);
      expect(data.totals.count).toBe(p1.length);
      expect(data.totals.average).toBeCloseTo(round2(mean(p1.map((r) => Number(r.average)))), 1);
      expect(data.totals.min).toBeCloseTo(Math.min(...p1.map((r) => Number(r.average))), 2);
      expect(data.totals.max).toBeCloseTo(Math.max(...p1.map((r) => Number(r.average))), 2);
      expect(data.totals.validatedCount).toBe(count(p1, (r) => r.validated === true));
      expect(data.totals.classPeriodsFinal).toBe(4);
      expect(data.byClassroom).toHaveLength(4);
      for (const row of data.byClassroom) {
        const results = sim.world.classPeriods.get(`${row.classroomId}|${IDS.p1}`)?.results ?? [];
        expect(row.count).toBe(results.length);
        expect(row.average).toBeCloseTo(round2(mean(results.map((r) => Number(r.average)))), 1);
      }
      // distribution : même classement que la fonction pure sur la source, toutes classes confondues
      const expectedBins = new Map<number, number>();
      for (const r of p1) expectedBins.set(binIndex(Number(r.average), 20, 2), (expectedBins.get(binIndex(Number(r.average), 20, 2)) ?? 0) + 1);
      expect(data.distribution.bins.map((b) => b.count)).toEqual(Array.from({ length: 10 }, (_, i) => expectedBins.get(i) ?? 0));
      expect(sum(data.distribution.bins.map((b) => b.count))).toBe(p1.length);
      // matières
      expect(data.bySubject.map((s) => s.code).sort()).toEqual(["ANG", "FR", "MATH"]);
      const mathLines = [IDS.classA, IDS.classB, IDS.classC, IDS.classD].flatMap((c) => sim.world.classPeriods.get(`${c}|${IDS.p1}`)?.lines ?? []).filter((l) => l.nodeCode === "MATH");
      const math = data.bySubject.find((s) => s.code === "MATH");
      expect(math?.count).toBe(mathLines.length);
      expect(math?.session2Count).toBe(count(mathLines, (l) => l.sessionObtained === 2));
      expect(math?.resitEligibleCount).toBe(count(mathLines, (l) => l.resitEligible === true));
      // périodes de l'année (indépendantes du filtre de période) et décisions
      expect(data.byPeriod.map((p) => p.periodId)).toEqual([IDS.p1, IDS.p2]);
      expect(sum(data.decisions.period.map((d) => d.count))).toBe(p1.length);
      const p2 = unwrap(await q.getResults(deps, owner(tenantA), { periodId: IDS.p2 })).data;
      expect(p2.totals.classPeriodsFinal).toBe(2);
      expect(p2.totals.classPeriodsNotFinal).toBe(1);
      expect(sum(p2.decisions.year.map((d) => d.count))).toBe(p2.totals.count);
      // sans période demandée : la dernière période FINAL de l'année, déclarée dans le périmètre
      const dflt = unwrap(await q.getResults(deps, owner(tenantA)));
      expect(dflt.meta.scope.periodId).toBe(IDS.p2);
    });

    it("scolarité et créances : synthèse, par classe, par apprenant, trésorerie, créances âgées, caisse", async () => {
      const finance = sim.world.finance.get(`${YEAR_CODE}|*`)!;
      const summary = unwrap(await q.getFinanceSummary(deps, owner(tenantA)));
      expect(summary.data.currency).toBe("XOF");
      expect(summary.data.summary).toMatchObject({ billed: finance.summary.billed, credited: finance.summary.credited, collected: finance.summary.collected, outstanding: finance.summary.outstanding, overdue: finance.summary.overdue, collectionRateBps: finance.summary.collectionRateBps });
      expect(summary.data.summary?.status).toBe(finance.summary.collectionRateBps! >= 8000 ? "good" : finance.summary.collectionRateBps! >= 6000 ? "warning" : "critical");
      expect(summary.data.byClassroom).toHaveLength(4);

      const byClass = unwrap(await q.getReceivables(deps, owner(tenantA), { by: "class", onlyOutstanding: true, limit: 50, offset: 0 })).data;
      expect(sum(byClass.rows.map((r) => r.outstanding))).toBe(sum(finance.byGroup.filter((g) => g.outstanding > 0).map((g) => g.outstanding)));
      expect(byClass.rows[0]!.outstanding).toBeGreaterThanOrEqual(byClass.rows[byClass.rows.length - 1]!.outstanding);
      const byLearner = unwrap(await q.getReceivables(deps, owner(tenantA), { by: "learner", onlyOutstanding: true, limit: 2, offset: 0 })).data;
      expect(byLearner.total).toBe(count(finance.byLearner, (l) => l.outstanding > 0));
      expect(byLearner.rows).toHaveLength(2);
      expect(byLearner.rows[0]!.label).toMatch(/^Élève /);

      const aged = unwrap(await q.getAged(deps, owner(tenantA))).data;
      expect(aged.total).toBe(sum(Object.values(finance.aged.buckets).map((b) => b.amount)));
      expect(aged.buckets.map((b) => b.bucket)).toEqual(["NOT_DUE", "D1_30", "D31_60", "D61_90", "D91_PLUS"]);
      expect(aged.learners[0]).toMatchObject({ total: 300_000, d1_30: 300_000 });

      const cash = unwrap(await q.getCash(deps, owner(tenantA))).data;
      expect(cash.totals).toMatchObject({ sessions: 3, closed: 2, withVariance: 1, netVariance: -5_000, absoluteVariance: 5_000 });

      const monthly = unwrap(await q.getCollections(deps, owner(tenantA), { granularity: "month" })).data;
      expect(monthly.totals.collected).toBe(sum(sim.world.collections.map((c) => c.collected)));
      expect(monthly.totals.refunded).toBe(sum(sim.world.collections.map((c) => c.refunded)));
      expect(monthly.totals.paymentCount).toBe(sum(sim.world.collections.map((c) => c.paymentCount)));
      expect(monthly.points.every((p) => p.bucket.endsWith("-01"))).toBe(true);
      const daily = unwrap(await q.getCollections(deps, owner(tenantA), { granularity: "day", from: "2026-03-01", to: "2026-03-20" })).data;
      expect(daily.points).toHaveLength(20);
    });

    it("masse salariale, charge d'enseignement, charges (manque déclaré)", async () => {
      const payroll = unwrap(await q.getPayroll(deps, owner(tenantA))).data;
      expect(payroll.periods).toHaveLength(2);
      const feb = payroll.periods.find((p) => p.name === "Février 2026")!;
      expect(feb.counted).toEqual({ payslips: 9, total: 3_000_000 });
      expect(feb.cancelled).toEqual({ payslips: 1, total: 120_000 });
      expect(feb.disputed).toEqual({ payslips: 1, total: 200_000 });
      expect(payroll.counted.total).toBe(6_100_000);

      const load = unwrap(await q.getTeachingLoad(deps, owner(tenantA))).data;
      expect(load.rows).toHaveLength(6);
      expect(load.totals.plannedHours).toBe(97.5);

      const charges = unwrap(await q.getCharges(deps, owner(tenantA)));
      expect(charges.data).toMatchObject({ available: false, reason: "MODULE_MISSING" });
      expect(charges.meta.gaps.map((g) => g.reason)).toContain("MODULE_MISSING");
    });
  });

  describe("flux d'événements", () => {
    it("coalesce une rafale d'événements en UNE demande, exécutée après son échéance, qui relit la source", async () => {
      const ctx = sys(tenantA);
      const ev = (n: number) => ({ id: uuid(5000 + n), type: "attendance.session.submitted", payload: { v: 1, date: TODAY, classroomId: IDS.classA }, occurredAt: clock.now().toISOString() });
      for (let i = 0; i < 3; i += 1) expect(await enqueueFromEvent(deps, ctx, ev(i))).toBe(1);
      const pending = await db.admin.query(`SELECT kind, scope_key, jsonb_array_length(causes) AS causes, status FROM analytics.refresh_requests WHERE tenant_id = $1 AND status = 'PENDING'`, [tenantA]);
      expect(pending.rows).toEqual([{ kind: "ATTENDANCE", scope_key: `${TODAY}..${TODAY}`, causes: 3, status: "PENDING" }]);

      expect((await processDueRefreshes(deps, ctx)).leased).toBe(0); // pas encore échu

      // La source change entre-temps : la passe lit l'état COURANT de la source.
      const today = sim.world.attendance.filter((a) => a.day === TODAY);
      today[0]!.absentCount += 3;
      today[0]!.presentCount -= 3;
      const callsBefore = sim.world.calls["attendance.readDays"] ?? 0;
      clock.advance(60_000);
      const report = await processDueRefreshes(deps, ctx);
      expect(report).toMatchObject({ leased: 1, ok: 1, failed: 0, unavailable: 0 });
      expect((sim.world.calls["attendance.readDays"] ?? 0) - callsBefore).toBe(1); // trois événements, UNE lecture
      const overview = unwrap(await q.getOverview(deps, owner(tenantA))).data;
      expect(overview.attendanceToday.absentCount).toBe(sum(today.map((a) => a.absentCount)));
      const done = await db.admin.query(`SELECT status FROM analytics.refresh_requests WHERE tenant_id = $1 AND kind = 'ATTENDANCE'`, [tenantA]);
      expect(done.rows).toEqual([{ status: "DONE" }]);
    });

    it("période rouverte : les faits FINAL de la classe disparaissent et la clôture est consignée NOT_FINAL", async () => {
      const ctx = sys(tenantA);
      const key = `${IDS.classA}|${IDS.p1}`;
      const before = unwrap(await q.getResults(deps, owner(tenantA), { periodId: IDS.p1 })).data;
      const classA = before.byClassroom.find((c) => c.classroomId === IDS.classA)!;
      expect(classA.count).toBeGreaterThan(0);

      const original = sim.world.classPeriods.get(key)!;
      sim.world.putClassPeriod({ ...original, state: "NOT_FINAL", results: [], lines: [] });
      await enqueueFromEvent(deps, ctx, { id: uuid(5100), type: "results.period.reopened", payload: { v: 1, classroomId: IDS.classA, academicPeriodId: IDS.p1 }, occurredAt: clock.now().toISOString() });
      clock.advance(60_000);
      expect(await processDueRefreshes(deps, ctx)).toMatchObject({ leased: 1, ok: 1 });

      const after = unwrap(await q.getResults(deps, owner(tenantA), { periodId: IDS.p1 })).data;
      expect(after.byClassroom.find((c) => c.classroomId === IDS.classA)).toBeUndefined();
      expect(after.totals.count).toBe(before.totals.count - classA.count);
      expect(after.totals.classPeriodsNotFinal).toBe(1);

      // la clôture revient (période reclôturée) : les faits reviennent à l'identique
      sim.world.putClassPeriod(original);
      await enqueueFromEvent(deps, ctx, { id: uuid(5101), type: "results.period.closed", payload: { v: 1, classroomId: IDS.classA, academicPeriodId: IDS.p1 }, occurredAt: clock.now().toISOString() });
      clock.advance(60_000);
      await processDueRefreshes(deps, ctx);
      const restored = unwrap(await q.getResults(deps, owner(tenantA), { periodId: IDS.p1 })).data;
      expect(restored.totals).toEqual(before.totals);
    });

    it("événement de décision : toutes les classes de la période sont relues", async () => {
      const ctx = sys(tenantA);
      await enqueueFromEvent(deps, ctx, { id: uuid(5200), type: "results.decision.confirmed", payload: { v: 1, academicPeriodId: IDS.p2, enrollmentId: uuid(1) }, occurredAt: clock.now().toISOString() });
      const callsBefore = sim.world.calls["results.readClassPeriod"] ?? 0;
      clock.advance(60_000);
      expect(await processDueRefreshes(deps, ctx)).toMatchObject({ leased: 1, ok: 1 });
      expect((sim.world.calls["results.readClassPeriod"] ?? 0) - callsBefore).toBe(3); // A, B (FINAL) et C (NOT_FINAL) de P2
    });

    it("source en panne : reprise avec délai, dernière lecture réussie conservée avec son ancien asOf, puis rétablissement", async () => {
      const ctx = sys(tenantA);
      const before = unwrap(await q.getPayroll(deps, owner(tenantA)));
      sim.world.failing.add("payroll.readMass");
      await enqueueFromEvent(deps, ctx, { id: uuid(5300), type: "payroll.payslip.paid", payload: { v: 1 }, occurredAt: clock.now().toISOString() });
      clock.advance(120_000);
      const first = await processDueRefreshes(deps, ctx);
      expect(first).toMatchObject({ leased: 1, retried: 1, failed: 0 });

      const during = unwrap(await q.getPayroll(deps, owner(tenantA)));
      expect(during.data.counted.total).toBe(before.data.counted.total); // les chiffres précédents restent affichés
      expect(during.meta.asOf).toBe(before.meta.asOf); // ... avec leur ancien asOf
      expect(during.meta.gaps.map((g) => g.reason)).toContain("FAILED");

      expect((await processDueRefreshes(deps, ctx)).leased).toBe(0); // délai de reprise non écoulé
      sim.world.failing.delete("payroll.readMass");
      clock.advance(10 * 60_000);
      expect(await processDueRefreshes(deps, ctx)).toMatchObject({ leased: 1, ok: 1, retried: 0 });
      const after = unwrap(await q.getPayroll(deps, owner(tenantA)));
      expect(after.meta.gaps).toEqual([]);
      expect(Date.parse(after.meta.asOf!)).toBeGreaterThan(Date.parse(before.meta.asOf!));
    });

    it("source non branchée : demande UNAVAILABLE (jamais d'erreur) et manque déclaré dans la réponse", async () => {
      const tenantC = await db.createTenant("ecole-c");
      const bare = depsOf(() => ({}));
      const ctx = sys(tenantC);
      await enqueueFromEvent(bare, ctx, { id: uuid(5400), type: "finance.payment.completed", payload: { v: 1, confirmedAt: clock.now().toISOString() }, occurredAt: clock.now().toISOString() });
      clock.advance(60_000);
      const report = await processDueRefreshes(bare, ctx);
      expect(report).toMatchObject({ leased: 2, unavailable: 2, failed: 0 }); // FINANCE et COLLECTIONS
      const o = unwrap(await q.getFinanceSummary(bare, owner(tenantC)));
      expect(o.data.summary).toBeNull();
      expect(o.meta.asOf).toBeNull();
      expect(o.meta.stale).toBe(true);
      expect(o.meta.gaps.map((g) => g.reason)).toContain("NOT_WIRED");
      // jamais lu : NEVER_COMPUTED, pas un zéro
      const enrollment = unwrap(await q.getEnrollment(bare, owner(tenantC)));
      expect(enrollment.meta.gaps.map((g) => g.reason)).toContain("NEVER_COMPUTED");
    });
  });

  describe("périmètre et isolation", () => {
    it("un tenant ne voit jamais les données d'un autre tenant", async () => {
      const overview = unwrap(await q.getOverview(deps, owner(tenantB)));
      expect(overview.data.headcount).toEqual({ inSchooling: 0, total: 0, classrooms: 0 });
      expect(overview.data.attendanceToday.measured).toBe(false);
      expect(overview.data.results.measured).toBe(false);
      expect(unwrap(await q.getPayroll(deps, owner(tenantB))).data.periods).toEqual([]);
      expect(unwrap(await q.getScopes(deps, owner(tenantB))).data.years).toEqual([]);
    });

    it("un utilisateur limité à un campus ne voit que ce campus et ne peut pas en demander un autre", async () => {
      const ctx = owner(tenantA, { institutionId: IDS.institution, campusId: IDS.campusA });
      const { data } = unwrap(await q.getEnrollment(deps, ctx));
      expect(data.byClassroom.map((c) => c.classroomId).sort()).toEqual([IDS.classA, IDS.classB].sort());
      expect(data.byCampus.map((c) => c.key)).toEqual([IDS.campusA]);
      const refused = await q.getEnrollment(deps, ctx, { campusId: IDS.campusB });
      expect(refused.ok).toBe(false);
      const scopes = unwrap(await q.getScopes(deps, ctx)).data;
      expect(scopes.campuses.map((c) => c.id)).toEqual([IDS.campusA]);
      expect(scopes.classrooms.every((c) => c.campusId === IDS.campusA)).toBe(true);
      // la finance est suivie par campus : le campus de l'utilisateur est utilisé (clé de campus)
      const fin = unwrap(await q.getFinanceSummary(deps, ctx));
      expect(fin.data.byClassroom).toHaveLength(2);
    });

    it("filtre par établissement, année et classe", async () => {
      const byClass = unwrap(await q.getEnrollment(deps, owner(tenantA), { classroomId: IDS.classC })).data;
      expect(byClass.byClassroom.map((c) => c.classroomId)).toEqual([IDS.classC]);
      const prev = unwrap(await q.getEnrollment(deps, owner(tenantA), { yearId: IDS.yearPrev })).data;
      expect(prev.totals.total).toBe(1);
      const unknownYear = await q.getEnrollment(deps, owner(tenantA), { yearId: uuid(99999) });
      expect(unknownYear.ok).toBe(false);
    });
  });
});

describe("analytics : reconstruction d'un tenant sans port (sans base)", () => {
  it("les genres déclarent leurs ports requis", async () => {
    const { REQUIRED_PORTS } = await import("../application/refresh");
    expect(REQUIRED_PORTS.RESULTS).toEqual(["results"]);
    expect(REQUIRED_PORTS.REBUILD).toEqual([]);
  });
});
