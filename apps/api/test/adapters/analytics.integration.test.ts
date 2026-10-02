/**
 * analytics sur les VRAIS modules (aucun port en mémoire) : une école supérieure complète (people, academic, assess, results avec
 * les règles nationales, finance, scheduling, attendance) est lue par les adaptateurs de `platform/adapters/analytics-sources.ts`,
 * reconstruite dans les read-models d'`analytics`, puis chaque chiffre est comparé à un SQL DIRECT sur le schéma de la source
 * (vérité du fournisseur, lue ICI par le test uniquement — jamais par le module).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Money, createRequestContext, createSystemContext, newId, unwrap } from "@ecoledigitale/kernel";
import { analyticsIndicators as indicatorsModule, analyticsQueries as q, createAnalyticsDeps, processDueRefreshes, enqueueFromEvent, rebuildTenant } from "../../src/modules/analytics";
import { markStaffAttendance, markStudentRecords, openAttendanceSession, submitAttendanceSession } from "../../src/modules/attendance";
import { createFinanceDeps, createInvoice, recordManualPayment, type FinanceDeps } from "../../src/modules/finance";
import { createOccurrence, seedReference } from "../../src/modules/scheduling";
import { createAnalyticsSources } from "../../src/platform/adapters/analytics-sources";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, bindCreditRules, closeSemester, createAssemblyWorld, publishAssessment, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const xof = (n: number): Money => Money.of(n, "XOF");
const dayOffset = (w: AssemblyWorld, days: number): string => new Date(w.clock.now().getTime() + days * 86_400_000).toISOString().slice(0, 10);

describeIntegration("analytics : read-models alimentés par les VRAIS modules (adaptateurs réels)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let fin: FinanceDeps;
  let yearCode: string;
  let lessonDate: string;
  let sys: ReturnType<typeof createSystemContext>;
  let owner: ReturnType<typeof createRequestContext>;
  let deps: ReturnType<typeof createAnalyticsDeps>;

  beforeAll(async () => {
    w = await createAssemblyWorld();
    await bindCreditRules(w);
    school = await seedHigherSchool(w, { pupils: 3 });
    const { ue1, ue2 } = school.seed;
    const grid: Array<[string, Array<string | null>, Array<string | null>]> = [
      [ue1.ecueIds[0]!, ["14", "12", "9"], ["15", "11", null]],
      [ue1.ecueIds[1]!, ["10", "13", "8"], ["12", "14", "7"]],
      [ue2.ecueIds[0]!, ["16", "9", "11"], ["13", "10", "12"]],
      [ue2.ecueIds[1]!, ["8", "12", "10"], ["9", "15", "11"]],
    ];
    for (const [node, devoir, examen] of grid) {
      await publishAssessment(w, school, { typeCode: "DEVOIR", nodeId: node, scores: devoir });
      await publishAssessment(w, school, { typeCode: "EXAMEN", nodeId: node, scores: examen });
    }
    await closeSemester(w, school);

    // Finance : une facture par élève (échue), le 1er solde, le 2e paie en partie, le 3e rien.
    yearCode = (await adminRows<{ code: string }>(w, "SELECT code FROM academic.academic_years WHERE id = $1", [school.seed.yearId]))[0]!.code;
    fin = createFinanceDeps({ db: w.tenantDb, clock: w.clock, logger: w.kit.logger, portsProvider: () => w.ports.finance });
    const invoiceIds: string[] = [];
    for (const p of school.pupils) {
      const created = unwrap(await createInvoice(fin, w.director, { learnerId: p.studentId, enrollmentId: p.enrollmentId, lines: [{ category: "TUITION", description: "Scolarité", unitAmount: xof(100_000) }], dueDate: dayOffset(w, -10), issue: true }));
      invoiceIds.push(created.invoices[0]!.invoice.id);
    }
    unwrap(await recordManualPayment(fin, w.director, { idempotencyKey: `pay-${newId()}`, learnerId: school.pupils[0]!.studentId, amount: xof(100_000), method: "TRANSFER", reference: "VIR-A", allocation: { mode: "AUTO", invoiceIds: [invoiceIds[0]!] } }));
    unwrap(await recordManualPayment(fin, w.director, { idempotencyKey: `pay-${newId()}`, learnerId: school.pupils[1]!.studentId, amount: xof(40_000), method: "TRANSFER", reference: "VIR-B", allocation: { mode: "AUTO", invoiceIds: [invoiceIds[1]!] } }));

    // Présences : une séance réelle, un appel soumis (présent, absent, en retard), et un pointage du personnel.
    w.clock.advance(86_400_000);
    unwrap(await seedReference(w.kit.scheduling, w.director));
    lessonDate = dayOffset(w, -1);
    const occ = unwrap(await createOccurrence(w.kit.scheduling, w.director, { kind: "LESSON", classroomId: school.seed.classroomId, curriculumNodeId: school.seed.levelNodeId, date: lessonDate, startTime: "08:00", endTime: "10:00", staff: [{ staffId: school.teacher.staffId }] }));
    const opened = unwrap(await openAttendanceSession(w.kit.attendance, school.teacher.ctx, { kind: "occurrence", occurrenceId: occ.occurrence.id, caps: {} }));
    const [p1, p2, p3] = school.pupils;
    unwrap(await markStudentRecords(w.kit.attendance, school.teacher.ctx, { sessionId: opened.session.id, entries: [{ studentId: p1!.studentId, statusCode: "PRESENT" }, { studentId: p2!.studentId, statusCode: "ABSENT" }, { studentId: p3!.studentId, statusCode: "LATE", minutesLate: 10 }], caps: {} }));
    unwrap(await submitAttendanceSession(w.kit.attendance, school.teacher.ctx, { sessionId: opened.session.id, defaultStatus: "PRESENT", caps: {} }));
    unwrap(await markStaffAttendance(w.kit.attendance, w.director, { staffId: school.teacher.staffId, workDate: lessonDate, statusCode: "PRESENT", checkInAt: new Date(`${lessonDate}T08:00:00.000Z`), checkOutAt: new Date(`${lessonDate}T12:30:00.000Z`), caps: { staffRecord: true, staffRead: true } }));

    sys = createSystemContext(w.tenantId);
    owner = createRequestContext({ tenantId: w.tenantId, userId: newId(), roles: ["owner"], mfa: true });
    const sources = createAnalyticsSources(w.kit);
    deps = createAnalyticsDeps({ db: w.tenantDb, clock: w.clock, portsProvider: () => sources });
  }, 600_000);
  afterAll(async () => {
    await w?.drop();
  });

  it("la reconstruction lit tous les modules sans échec, sans port manquant", async () => {
    const outcomes = await rebuildTenant(deps, sys);
    const bad = outcomes.filter((o) => o.status !== "OK");
    expect(bad.map((o) => `${o.kind}:${o.scopeKey}:${o.status}:${o.error}`)).toEqual([]);
    expect(outcomes.some((o) => o.kind === "RESULTS" && o.rows > 0)).toBe(true);
  });

  it("calendrier et effectifs : mêmes classes, mêmes inscriptions, sexe lu dans people, effectif = inscriptions en scolarité d'academic", async () => {
    const scopes = unwrap(await q.getScopes(deps, owner)).data;
    expect(scopes.years.map((y) => y.id)).toContain(school.seed.yearId);
    expect(scopes.periods.filter((p) => p.yearId === school.seed.yearId).length).toBeGreaterThanOrEqual(2);
    expect(scopes.classrooms.find((c) => c.id === school.seed.classroomId)).toMatchObject({ name: "Licence 1 A", gradeLevelLabel: "Licence 1" });

    const source = await adminRows<{ n: string; active: string; f: string; m: string }>(
      w,
      `SELECT count(*)::text AS n, count(*) FILTER (WHERE e.status IN ('ACTIVE','COMPLETED'))::text AS active,
              count(*) FILTER (WHERE p.sex = 'F')::text AS f, count(*) FILTER (WHERE p.sex = 'M')::text AS m
         FROM academic.enrollments e JOIN people.students s ON s.id = e.student_id JOIN people.persons p ON p.id = s.person_id
        WHERE e.tenant_id = $1 AND e.academic_year_id = $2`,
      [w.tenantId, school.seed.yearId],
    );
    const { data } = unwrap(await q.getEnrollment(deps, owner, { yearId: school.seed.yearId }));
    expect(data.totals.total).toBe(Number(source[0]!.n));
    expect(data.totals.total).toBe(3);
    expect(data.bySex.find((s) => s.key === "F")?.count).toBe(Number(source[0]!.f));
    expect(data.bySex.find((s) => s.key === "M")?.count).toBe(Number(source[0]!.m));
    expect(data.byClassroom).toHaveLength(1);
    expect(data.byClassroom[0]).toMatchObject({ classroomId: school.seed.classroomId, count: 3 });
    expect(data.totals.inSchooling).toBeGreaterThan(0); // la classification vient d'academic (opensSchooling), pas d'un libellé
  });

  it("résultats : chaque fait d'analytics est EXACTEMENT celui du FINAL de results (moyenne, rang, validation, lignes)", async () => {
    const source = await adminRows<{ enrollment_id: string; average: string | null; rank: number | null; validated: boolean | null; decision_code: string | null; id: string }>(
      w,
      `SELECT id, enrollment_id, average::text AS average, rank, validated, decision_code
         FROM results.period_results WHERE tenant_id = $1 AND scope = 'PERIOD' AND academic_period_id = $2 AND status = 'FINAL'`,
      [w.tenantId, school.ref.academicPeriodId],
    );
    expect(source).toHaveLength(3);
    const mirrored = await adminRows<{ enrollment_id: string; average: string | null; rank: number | null; validated: boolean | null; decision_code: string | null }>(
      w,
      `SELECT enrollment_id, average::text AS average, rank, validated, decision_code FROM analytics.result_facts WHERE tenant_id = $1 AND period_id = $2`,
      [w.tenantId, school.ref.academicPeriodId],
    );
    const key = (r: { enrollment_id: string }) => r.enrollment_id;
    expect([...mirrored].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(source.map(({ id: _id, ...r }) => r).sort((a, b) => key(a).localeCompare(key(b))));

    const srcLines = await adminRows<{ n: string; s: string }>(
      w,
      `SELECT count(*)::text AS n, COALESCE(sum(l.value), 0)::text AS s FROM results.line_results l JOIN results.period_results h ON h.id = l.period_result_id
        WHERE h.tenant_id = $1 AND h.status = 'FINAL' AND h.academic_period_id = $2 AND l.level IN ('ECUE','SUBJECT','UE')`,
      [w.tenantId, school.ref.academicPeriodId],
    );
    const dstLines = await adminRows<{ n: string; s: string }>(w, `SELECT count(*)::text AS n, COALESCE(sum(value), 0)::text AS s FROM analytics.result_line_facts WHERE tenant_id = $1 AND period_id = $2`, [w.tenantId, school.ref.academicPeriodId]);
    expect(dstLines[0]).toEqual(srcLines[0]);
    const labels = await adminRows<{ node_code: string; node_label: string; level: string }>(w, `SELECT DISTINCT node_code, node_label, level FROM analytics.result_line_facts WHERE tenant_id = $1 ORDER BY 1`, [w.tenantId]);
    expect(labels.map((l) => l.node_code)).toEqual(expect.arrayContaining(["E11", "E12", "E21", "E22", "UE1", "UE2"]));

    const { data } = unwrap(await q.getResults(deps, owner, { yearId: school.seed.yearId, periodId: school.ref.academicPeriodId }));
    expect(data.totals.count).toBe(3);
    expect(data.totals.classPeriodsFinal).toBe(1);
    expect(data.totals.average).toBeCloseTo(source.reduce((n, r) => n + Number(r.average), 0) / 3, 1);
    expect(data.totals.validatedCount).toBe(source.filter((r) => r.validated === true).length);
    expect(data.bySubject.map((s) => s.code)).toEqual(expect.arrayContaining(["E11", "UE1"]));
  });

  it("scolarité : facturé, encaissé, restant dû et retard = SQL direct sur les factures de finance ; créances par apprenant nommées", async () => {
    const source = await adminRows<{ billed: string; collected: string; outstanding: string }>(
      w,
      `SELECT sum(total_amount)::text AS billed, sum(paid_amount)::text AS collected, sum(total_amount - credited_amount - paid_amount)::text AS outstanding
         FROM finance.invoices WHERE tenant_id = $1 AND status IN ('ISSUED','PARTIALLY_PAID','PAID','OVERDUE','CREDITED') AND academic_year = $2`,
      [w.tenantId, yearCode],
    );
    const { data } = unwrap(await q.getFinanceSummary(deps, owner, { yearId: school.seed.yearId }));
    expect(data.summary).toMatchObject({ billed: Number(source[0]!.billed), collected: Number(source[0]!.collected), outstanding: Number(source[0]!.outstanding), invoiceCount: 3 });
    expect(data.summary!.billed).toBe(300_000);
    expect(data.summary!.collected).toBe(140_000);
    expect(data.summary!.collectionRateBps).toBe(4667);
    expect(data.byClassroom).toHaveLength(1);
    expect(data.byClassroom[0]).toMatchObject({ groupKey: school.seed.classroomId, outstanding: 160_000 });

    const learners = unwrap(await q.getReceivables(deps, owner, { yearId: school.seed.yearId, by: "learner", onlyOutstanding: true, limit: 10, offset: 0 })).data;
    expect(learners.total).toBe(2);
    expect(learners.rows[0]).toMatchObject({ outstanding: 100_000 });
    expect(learners.rows[0]!.label).toMatch(/ETUDIANT/);

    const aged = unwrap(await q.getAged(deps, owner, { yearId: school.seed.yearId })).data;
    expect(aged.total).toBe(160_000);
    expect(aged.buckets.find((b) => b.bucket === "D1_30")?.amount).toBe(160_000);
    const trend = unwrap(await q.getCollections(deps, owner, { granularity: "month" })).data;
    expect(trend.totals.collected).toBe(140_000);
  });

  it("présences : pointages d'élèves (statuts d'attendance) et présence du personnel", async () => {
    const source = await adminRows<{ records: string; present: string; absent: string; late: string }>(
      w,
      `SELECT count(*)::text AS records, count(*) FILTER (WHERE d.counts_as_present)::text AS present, count(*) FILTER (WHERE d.counts_as_absence)::text AS absent, count(*) FILTER (WHERE d.counts_as_late)::text AS late
         FROM attendance.student_records r JOIN attendance.sessions s ON s.id = r.session_id
         JOIN attendance.status_definitions d ON d.tenant_id = r.tenant_id AND d.subject_kind = 'STUDENT' AND d.code = r.status_code
        WHERE r.tenant_id = $1 AND s.status IN ('SUBMITTED','VALIDATED') AND s.session_date = $2`,
      [w.tenantId, lessonDate],
    );
    const { data } = unwrap(await q.getAttendance(deps, owner, { from: lessonDate, to: lessonDate }));
    expect(data.totals).toMatchObject({ recordsCount: Number(source[0]!.records), presentCount: Number(source[0]!.present), absentCount: Number(source[0]!.absent), lateCount: Number(source[0]!.late), sessionsCount: 1 });
    expect(data.totals.recordsCount).toBe(3);
    expect(data.totals.absentCount).toBe(1);
    expect(data.byClassroom[0]).toMatchObject({ classroomId: school.seed.classroomId, name: "Licence 1 A" });
    expect(data.staff.measured).toBe(true);
    expect(data.staff.byDay[0]).toMatchObject({ day: lessonDate, present: 1 });
  });

  it("charge d'enseignement : l'enseignant affecté à la classe (people) ; masse salariale : aucune paie => aucune ligne, sans manque", async () => {
    const load = unwrap(await q.getTeachingLoad(deps, owner, { yearId: school.seed.yearId })).data;
    expect(load.rows.map((r) => r.displayName).join(" ")).toMatch(/ENSEIGNANT/);
    const payroll = unwrap(await q.getPayroll(deps, owner));
    expect(payroll.data.periods).toEqual([]);
    expect(payroll.meta.gaps.filter((g) => g.source === "PAYROLL")).toEqual([]);
  });

  it("provenance des règles : celle du jeu épinglé par results (lue dans rules), jamais déduite ; le drapeau « démonstration » suit exactement les jeux placeholder", async () => {
    const pins = await adminRows<{ classroom_id: string; academic_period_id: string; rule_version_id: string }>(
      w,
      `SELECT classroom_id, academic_period_id, rule_version_id FROM results.period_states WHERE tenant_id = $1 AND scope = 'PERIOD'`,
      [w.tenantId],
    );
    expect(pins.length).toBeGreaterThan(0);
    const scopes = await adminRows<{ classroom_id: string; period_id: string; state: string; rules_source_kind: string | null }>(w, `SELECT classroom_id, period_id, state, rules_source_kind FROM analytics.result_scopes WHERE tenant_id = $1 AND state = 'FINAL'`, [w.tenantId]);
    expect(scopes.length).toBeGreaterThan(0);
    for (const s of scopes) {
      const pin = pins.find((p) => p.classroom_id === s.classroom_id && p.academic_period_id === s.period_id)!;
      const loaded = await w.kit.rules.loadVersion(sys, pin.rule_version_id);
      expect(loaded.ok).toBe(true);
      expect(s.rules_source_kind).toBe(loaded.ok ? loaded.value.version.source.kind : "illisible");
    }
    const { data } = unwrap(await q.getResults(deps, owner, { yearId: school.seed.yearId, periodId: school.ref.academicPeriodId }));
    expect(data.rulesSource.finalClassPeriods).toBe(scopes.length);
    expect(data.rulesSource.placeholderClassPeriods).toBe(scopes.filter((s) => s.rules_source_kind === "placeholder").length);
    expect(data.rulesSource.demonstration).toBe(scopes.some((s) => s.rules_source_kind === "placeholder"));
    expect(data.rulesSource.unknownClassPeriods).toBe(scopes.filter((s) => s.rules_source_kind === null).length);
  });

  it("admissions et vie scolaire : lus par les API publiques des vrais modules (comptages), aucun candidat ni élève dans les faits", async () => {
    const funnel = unwrap(await indicatorsModule.getAdmissionsFunnel(deps, owner));
    expect(funnel.meta.gaps.filter((g) => g.source === "ADMISSIONS")).toEqual([]); // la source est branchée et lue sans échec
    expect(funnel.meta.sources.ADMISSIONS).not.toBeNull();
    const life = unwrap(await indicatorsModule.getSchoolLife(deps, owner));
    expect(life.meta.gaps.filter((g) => g.source === "SCHOOLLIFE")).toEqual([]);
    expect(life.data.indicators.every((i) => i.measured && i.value === 0)).toBe(true); // aucune vie scolaire saisie : zéros MESURÉS (la source a répondu)
    const cols = await adminRows<{ column_name: string }>(w, `SELECT column_name FROM information_schema.columns WHERE table_schema = 'analytics' AND table_name IN ('admissions_campaign_facts','admissions_stage_facts','schoollife_facts')`);
    expect(cols.map((c) => c.column_name).filter((c) => /student|applicant|application_id|_name|email|phone|birth/i.test(c))).toEqual([]);
  });

  it("la reconstruction est idempotente sur les vrais modules, et le flux d'événements réels remet un périmètre à jour", async () => {
    const dump = async () => adminRows(w, `SELECT (to_jsonb(x) - 'refreshed_at' - 'computed_at')::text AS j FROM analytics.result_facts x UNION ALL SELECT (to_jsonb(y) - 'refreshed_at')::text FROM analytics.enrollment_facts y ORDER BY 1`);
    const before = await dump();
    const again = await rebuildTenant(deps, sys);
    expect(again.every((o) => o.status === "OK")).toBe(true);
    expect(again.some((o) => o.changed)).toBe(false);
    expect(await dump()).toEqual(before);

    // Un événement RÉEL de l'outbox (publié par attendance) donne une demande, exécutée avec les vrais ports.
    const ev = await adminRows<{ id: string; type: string; payload: Record<string, unknown>; occurred_at: Date }>(w, `SELECT id, type, payload, occurred_at FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'attendance.session.submitted' ORDER BY occurred_at DESC LIMIT 1`, [w.tenantId]);
    expect(ev).toHaveLength(1);
    expect(await enqueueFromEvent(deps, sys, { id: ev[0]!.id, type: ev[0]!.type, payload: ev[0]!.payload, occurredAt: ev[0]!.occurred_at.toISOString() })).toBe(1);
    w.clock.advance(120_000);
    expect(await processDueRefreshes(deps, sys)).toMatchObject({ leased: 1, ok: 1, failed: 0, unavailable: 0 });
  });
});
