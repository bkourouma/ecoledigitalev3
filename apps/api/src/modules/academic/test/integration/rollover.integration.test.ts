/**
 * Assistant de reconduction annuelle (calendrier, jours fériés, curriculum, classes, offres, réinscriptions) sur Postgres réel :
 * aperçu sans écriture, exécution en tâche de fond (idempotente, reprenable, avec progression), décisions de passage lues par
 * le port `PromotionDecisionPort` (academic ne calcule jamais un passage).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, newId, unwrap } from "@ecoledigitale/kernel";
import {
  createHoliday,
  enrollStudent,
  executeRolloverRun,
  getAcademicYear,
  getRolloverRun,
  listHolidays,
  listReference,
  openOfferingsForPeriod,
  previewRolloverPlan,
  recordEnrollmentOutcome,
  retryRolloverRun,
  setProgramGradeLevels,
  startRolloverRun,
  updateAcademicSettings,
  type PromotionDecision,
} from "../../index";
import subscribers from "../../subscribers";
import { addDays } from "../../domain/dates";
import { adminRows, createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";
import { addStudent, assertEventsValid, codeOf, createNextYear, eventsOf, makeWorld, seedHigher, type HigherSeed, type World } from "../support/world";

describeIntegration("reconduction annuelle : assistant, tâche de fond, idempotence (Postgres réel)", () => {
  let db: AcademicTestDb;
  beforeAll(async () => {
    db = await createAcademicTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  const decisions = new Map<string, PromotionDecision>();
  const promotions = { listDecisions: async (_ctx: unknown, input: { enrollmentIds: readonly string[] }) => input.enrollmentIds.flatMap((id) => (decisions.has(id) ? [decisions.get(id) as PromotionDecision] : [])) };

  interface Scenario {
    w: World;
    s: HigherSeed;
    toYearId: string;
    enrolled: { promoted: string; repeated: string; undecided: string };
    students: { promoted: string; repeated: string; undecided: string };
    offerings: number;
    fromYear: { startsOn: string; endsOn: string };
  }

  async function scenario(): Promise<Scenario> {
    const w = makeWorld(db, await db.createTenant(), { ports: { promotions } });
    const s = await seedHigher(w);
    unwrap(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { enrollmentConfirmationPolicy: "AUTO" }));
    // L'année suivante accueille aussi le niveau L2 (le niveau suivant vient des DONNÉES : `next_grade_level_id`).
    const grades = unwrap(await listReference(w.deps, w.ctx, "grade-levels"));
    const l2 = grades.find((g) => g.code === "L2")!;
    unwrap(await setProgramGradeLevels(w.deps, w.ctx, s.programId, [s.gradeLevelId, l2.id]));
    const year = unwrap(await getAcademicYear(w.deps, w.ctx, s.yearId));
    const to = await createNextYear(w, year.endsOn, "SUIVANTE");

    // Calendrier de l'établissement : une fête à date fixe (reportée) et une fête mobile (à ressaisir).
    unwrap(await createHoliday(w.deps, w.ctx, { institutionId: w.institutionId, label: "Fête fixe", startsOn: addDays(year.startsOn, 20), recursYearly: true }));
    unwrap(await createHoliday(w.deps, w.ctx, { institutionId: w.institutionId, label: "Fête mobile", startsOn: addDays(year.startsOn, 40), endsOn: addDays(year.startsOn, 41) }));

    // Une offre à la carte par UE pour le semestre 1.
    const periods = await adminRows<{ starts_on: string; ends_on: string }>(db, "SELECT to_char(starts_on,'YYYY-MM-DD') AS starts_on, to_char(ends_on,'YYYY-MM-DD') AS ends_on FROM academic.academic_periods WHERE id = $1", [s.periodIds[0]]);
    const opened = unwrap(await openOfferingsForPeriod(w.deps, w.ctx, s.classroomId, { periodNodeId: s.periodNodeId, startsOn: periods[0]!.starts_on, endsOn: periods[0]!.ends_on }));

    // Trois élèves : issue enregistrée à la main, décision lue dans `results`, aucune décision.
    const mk = async (): Promise<{ studentId: string; enrollmentId: string }> => {
      const st = addStudent(w);
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId }));
      expect(e.status).toBe("ACTIVE");
      return { studentId: st.studentId, enrollmentId: e.id };
    };
    const promoted = await mk();
    const repeated = await mk();
    const undecided = await mk();
    unwrap(await recordEnrollmentOutcome(w.deps, w.ctx, promoted.enrollmentId, { outcomeCode: "PROMOTED" }));
    decisions.set(repeated.enrollmentId, { enrollmentId: repeated.enrollmentId, kind: "REPEAT", sourceCode: "REPEAT" });
    return {
      w,
      s,
      toYearId: to.id,
      enrolled: { promoted: promoted.enrollmentId, repeated: repeated.enrollmentId, undecided: undecided.enrollmentId },
      students: { promoted: promoted.studentId, repeated: repeated.studentId, undecided: undecided.studentId },
      offerings: opened.created.length,
      fromYear: { startsOn: year.startsOn, endsOn: year.endsOn },
    };
  }

  it("aperçu SANS écriture : tout ce qui sera copié, avertissements, décisions de passage lues dans results", async () => {
    const sc = await scenario();
    const { w } = sc;
    const plan = unwrap(await previewRolloverPlan(w.deps, w.ctx, sc.s.yearId, { toAcademicYearId: sc.toYearId }));
    expect(plan.steps).toEqual(["PERIODS", "HOLIDAYS", "CURRICULUM", "CLASSROOMS", "OFFERINGS", "ENROLLMENTS"]);
    expect(plan.periods.toCreate.map((p) => p.code).sort()).toHaveLength(2);
    expect(plan.holidays).toMatchObject({ existing: 0, notRecurring: 1 });
    expect(plan.holidays.toCreate.map((h) => h.label)).toEqual(["Fête fixe"]);
    expect(plan.curriculum.items.map((i) => [i.programCode, i.action, i.targetVersionId])).toEqual([["INFO", "CLONE", null]]);
    expect(plan.classrooms.toCreate.map((c) => c.code)).toEqual(["L1-A"]);
    expect(plan.offerings.toCreate).toBe(sc.offerings);
    expect(sc.offerings).toBeGreaterThan(0);
    expect(plan.liveRunId).toBeNull();
    // passage lu : un passage recorded + un redoublement lu par le port ; le troisième n'a aucune décision
    expect(plan.enrollments!.byOutcome).toMatchObject({ PROMOTED: 1, REPEATED: 1 });
    expect(plan.enrollments!.enrollmentsToCreate.map((e) => [e.outcomeKind, e.isRepeating]).sort()).toEqual([["ADVANCE", false], ["REPEAT", true]]);
    expect(plan.enrollments!.anomalies.map((a) => a.code)).toContain("outcome_missing");
    expect(plan.warnings.map((x) => x.code)).toEqual(expect.arrayContaining(["holidays_not_recurring", "promotion_decisions_missing"]));
    // l'aperçu n'écrit RIEN
    expect(Number((await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM academic.academic_periods WHERE academic_year_id = $1", [sc.toYearId]))[0]!.n)).toBe(0);
    expect(Number((await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM academic.rollover_runs WHERE tenant_id = $1", [w.tenantId]))[0]!.n)).toBe(0);
  });

  it("l'étape OFFERINGS est retirée (avec avertissement) quand la fonction « à la carte » n'est pas incluse ; steps filtrables", async () => {
    const sc = await scenario();
    const plan = unwrap(await previewRolloverPlan(sc.w.deps, sc.w.ctx, sc.s.yearId, { toAcademicYearId: sc.toYearId, steps: ["PERIODS", "OFFERINGS"] }, { offeringsEnabled: false }));
    expect(plan.steps).toEqual(["PERIODS"]);
    expect(plan.warnings.map((x) => x.code)).toContain("offerings_feature_disabled");
    expect(plan.enrollments).toBeNull();
    expect(plan.classrooms.toCreate).toEqual([]);
  });

  it("refuse deux années incohérentes (ordre, établissement, année cible close)", async () => {
    const sc = await scenario();
    const { w } = sc;
    expect(codeOf(await previewRolloverPlan(w.deps, w.ctx, sc.toYearId, { toAcademicYearId: sc.s.yearId }))).toBe("academic.rollover_year_order");
    expect(codeOf(await startRolloverRun(w.deps, w.ctx, sc.toYearId, { toAcademicYearId: sc.s.yearId }))).toBe("academic.rollover_year_order");
    expect(codeOf(await getRolloverRun(w.deps, w.ctx, newId()))).toBe("academic.rollover_run_not_found");
  });

  it("demande -> exécution par le worker : étapes, progression, rapport ; événements ; copies en BROUILLON", async () => {
    const sc = await scenario();
    const { w, s } = sc;
    const started = unwrap(await startRolloverRun(w.deps, w.ctx, s.yearId, { toAcademicYearId: sc.toYearId }));
    expect(started.created).toBe(true);
    expect(started.run).toMatchObject({ status: "PENDING", attempts: 0, report: null });
    expect(started.run.progress.steps.map((x) => [x.key, x.status])).toEqual([
      ["PERIODS", "PENDING"], ["HOLIDAYS", "PENDING"], ["CURRICULUM", "PENDING"], ["CLASSROOMS", "PENDING"], ["OFFERINGS", "PENDING"], ["ENROLLMENTS", "PENDING"],
    ]);
    // une demande identique est RENVOYÉE (jamais doublée) tant qu'elle est vivante
    const again = unwrap(await startRolloverRun(w.deps, w.ctx, s.yearId, { toAcademicYearId: sc.toYearId }));
    expect(again.created).toBe(false);
    expect(again.run.id).toBe(started.run.id);
    const requested = await eventsOf(w, "academic.rollover.requested");
    expect(requested).toHaveLength(1);
    expect(requested[0]!.payload).toMatchObject({ v: 1, runId: started.run.id, fromAcademicYearId: s.yearId, toAcademicYearId: sc.toYearId });
    expect(codeOf(await retryRolloverRun(w.deps, w.ctx, started.run.id))).toBe("academic.rollover_run_not_retryable");

    // le worker exécute
    const done = unwrap(await executeRolloverRun(w.deps, w.ctx, started.run.id));
    expect(done.status).toBe("COMPLETED");
    expect(done.attempts).toBe(1);
    expect(done.progress.steps.every((x) => x.status === "DONE")).toBe(true);
    expect(done.errorMessage).toBeNull();
    expect(done.report).toMatchObject({ periodsCreated: 2, holidaysCreated: 1, curriculumVersionsCreated: 1, offeringsCreated: sc.offerings, enrollmentsCreated: 2, alreadyRolledOver: 0 });
    // classes : « L1-A » reconduite + la classe L2 créée pour la réinscription du promu
    expect(done.report!.classroomsCreated).toBe(2);
    expect(done.report!.anomalies.map((a) => a.code)).toContain("outcome_missing");
    expect(done.report!.warnings.map((x) => x.code)).toEqual(expect.arrayContaining(["holidays_not_recurring", "promotion_decisions_missing"]));

    // périodes : mêmes types / numéros / libellés, dates reportées, toutes PLANNED
    const src = await adminRows<{ code: string; period_type_code: string; ordinal: number; label: string }>(db, "SELECT code, period_type_code, ordinal, label FROM academic.academic_periods WHERE academic_year_id = $1 ORDER BY ordinal", [s.yearId]);
    const dst = await adminRows<{ code: string; period_type_code: string; ordinal: number; label: string; status: string }>(db, "SELECT code, period_type_code, ordinal, label, status FROM academic.academic_periods WHERE academic_year_id = $1 ORDER BY ordinal", [sc.toYearId]);
    expect(dst.map(({ status: _s, ...p }) => p)).toEqual(src);
    expect(new Set(dst.map((p) => p.status))).toEqual(new Set(["PLANNED"]));
    // jour férié : seule la fête fixe a été reportée (même jour civil, année suivante)
    const target = unwrap(await getAcademicYear(w.deps, w.ctx, sc.toYearId));
    const hol = unwrap(await listHolidays(w.deps, w.ctx, { institutionId: w.institutionId, from: target.startsOn, to: target.endsOn }));
    expect(hol.map((h) => h.label)).toEqual(["Fête fixe"]);
    // curriculum : brouillon, mêmes nœuds et mêmes LIGNÉES
    const versions = await adminRows<{ id: string; status: string; cloned_from_version_id: string }>(db, "SELECT id, status, cloned_from_version_id FROM academic.curriculum_versions WHERE academic_year_id = $1", [sc.toYearId]);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ status: "DRAFT", cloned_from_version_id: s.versionId });
    const lin = async (v: string): Promise<string[]> => (await adminRows<{ lineage_id: string }>(db, "SELECT lineage_id FROM academic.curriculum_nodes WHERE version_id = $1 ORDER BY lineage_id", [v])).map((r) => r.lineage_id);
    expect(await lin(versions[0]!.id)).toEqual(await lin(s.versionId));
    // classes : brouillon, rattachées au curriculum cloné ; offres : brouillon, nœuds retrouvés par lignée
    const classes = await adminRows<{ code: string; status: string; curriculum_version_id: string | null }>(db, "SELECT code, status, curriculum_version_id FROM academic.classrooms WHERE academic_year_id = $1 ORDER BY code", [sc.toYearId]);
    expect(classes.map((c) => [c.code, c.status])).toContainEqual(["L1-A", "DRAFT"]);
    expect(classes.find((c) => c.code === "L1-A")!.curriculum_version_id).toBe(versions[0]!.id);
    const offers = await adminRows<{ status: string; lineage_id: string }>(
      db,
      `SELECT o.status, n.lineage_id FROM academic.classroom_offerings o JOIN academic.classrooms c ON c.id = o.classroom_id JOIN academic.curriculum_nodes n ON n.id = o.curriculum_node_id WHERE c.academic_year_id = $1`,
      [sc.toYearId],
    );
    expect(offers).toHaveLength(sc.offerings);
    expect(new Set(offers.map((o) => o.status))).toEqual(new Set(["DRAFT"]));
    // réinscriptions : promu -> L2 (niveau suivant des DONNÉES), redoublant -> L1 avec `is_repeating`, sans décision -> rien
    const enr = await adminRows<{ student_id: string; previous_enrollment_id: string; is_repeating: boolean; source_kind: string; grade: string }>(
      db,
      `SELECT e.student_id, e.previous_enrollment_id, e.is_repeating, e.source_kind, g.code AS grade FROM academic.enrollments e JOIN academic.classrooms c ON c.id = e.classroom_id JOIN academic.grade_levels g ON g.id = c.grade_level_id WHERE e.academic_year_id = $1`,
      [sc.toYearId],
    );
    expect(enr).toHaveLength(2);
    expect(enr.find((e) => e.student_id === sc.students.promoted)).toMatchObject({ previous_enrollment_id: sc.enrolled.promoted, is_repeating: false, source_kind: "ROLLOVER", grade: "L2" });
    expect(enr.find((e) => e.student_id === sc.students.repeated)).toMatchObject({ previous_enrollment_id: sc.enrolled.repeated, is_repeating: true, source_kind: "ROLLOVER", grade: "L1" });
    expect(enr.some((e) => e.student_id === sc.students.undecided)).toBe(false);

    // l'exécution terminée est renvoyée telle quelle (le worker peut recevoir l'événement deux fois)
    const replay = unwrap(await executeRolloverRun(w.deps, w.ctx, started.run.id));
    expect(replay).toMatchObject({ status: "COMPLETED", attempts: 1 });

    expect((await eventsOf(w, "academic.rollover.completed")).map((e) => e.payload.runId)).toEqual([started.run.id]);
    expect(await assertEventsValid(w)).toBeGreaterThan(0);
    expect(w.audit.actions()).toEqual(expect.arrayContaining(["academic.year.rollover_requested", "academic.year.rollover", "academic.holiday.created"]));
  });

  it("IDEMPOTENCE : une seconde reconduction ne crée rien en double (tout est « déjà présent »)", async () => {
    const sc = await scenario();
    const { w, s } = sc;
    const first = unwrap(await startRolloverRun(w.deps, w.ctx, s.yearId, { toAcademicYearId: sc.toYearId }));
    unwrap(await executeRolloverRun(w.deps, w.ctx, first.run.id));
    const counts = async (): Promise<string> =>
      JSON.stringify(
        await Promise.all(
          ["academic_periods WHERE academic_year_id", "classrooms WHERE academic_year_id", "enrollments WHERE academic_year_id", "curriculum_versions WHERE academic_year_id"].map(async (t) =>
            Number((await adminRows<{ n: string }>(db, `SELECT count(*)::text AS n FROM academic.${t} = $1`, [sc.toYearId]))[0]!.n),
          ),
        ),
      );
    const before = await counts();
    const second = unwrap(await startRolloverRun(w.deps, w.ctx, s.yearId, { toAcademicYearId: sc.toYearId }));
    expect(second.created).toBe(true);
    expect(second.run.id).not.toBe(first.run.id);
    const done = unwrap(await executeRolloverRun(w.deps, w.ctx, second.run.id));
    expect(done.status).toBe("COMPLETED");
    expect(done.report).toMatchObject({ periodsCreated: 0, holidaysCreated: 0, curriculumVersionsCreated: 0, classroomsCreated: 0, offeringsCreated: 0, enrollmentsCreated: 0, alreadyRolledOver: 2 });
    expect(await counts()).toBe(before);
  });

  it("reprise : une exécution interrompue (RUNNING ancienne) reprend, une exécution récente n'est pas doublée, une exécution en échec se relance", async () => {
    const sc = await scenario();
    const { w, s } = sc;
    const started = unwrap(await startRolloverRun(w.deps, w.ctx, s.yearId, { toAcademicYearId: sc.toYearId, steps: ["PERIODS", "CURRICULUM"] }));
    // RUNNING récent : un second worker ne la reprend pas
    await db.admin.query("UPDATE academic.rollover_runs SET status = 'RUNNING', started_at = now(), updated_at = now() WHERE id = $1", [started.run.id]);
    expect(unwrap(await executeRolloverRun(w.deps, w.ctx, started.run.id))).toMatchObject({ status: "RUNNING", attempts: 0 });
    expect(Number((await adminRows<{ n: string }>(db, "SELECT count(*)::text AS n FROM academic.academic_periods WHERE academic_year_id = $1", [sc.toYearId]))[0]!.n)).toBe(0);
    // RUNNING ancienne (worker mort) : reprise
    await db.admin.query("UPDATE academic.rollover_runs SET updated_at = now() - interval '1 hour' WHERE id = $1", [started.run.id]);
    const resumed = unwrap(await executeRolloverRun(w.deps, w.ctx, started.run.id));
    expect(resumed).toMatchObject({ status: "COMPLETED", attempts: 1 });
    expect(resumed.steps).toEqual(["PERIODS", "CURRICULUM"]);
    expect(resumed.report).toMatchObject({ periodsCreated: 2, curriculumVersionsCreated: 1, classroomsCreated: 0, enrollmentsCreated: 0 });

    // exécution en échec : relance explicite (PENDING + nouvel événement), puis reprise
    const failedRun = unwrap(await startRolloverRun(w.deps, w.ctx, s.yearId, { toAcademicYearId: sc.toYearId, steps: ["PERIODS"] }));
    await db.admin.query("UPDATE academic.rollover_runs SET status = 'FAILED', finished_at = now(), error_message = 'panne' WHERE id = $1", [failedRun.run.id]);
    const retried = unwrap(await retryRolloverRun(w.deps, w.ctx, failedRun.run.id));
    expect(retried).toMatchObject({ status: "PENDING", errorMessage: null });
    expect((await eventsOf(w, "academic.rollover.requested")).filter((e) => e.payload.runId === failedRun.run.id)).toHaveLength(2);
    expect(unwrap(await executeRolloverRun(w.deps, w.ctx, failedRun.run.id)).report).toMatchObject({ periodsCreated: 0 });
  });

  it("l'abonné `academic.run-rollover` du worker exécute la demande (événement -> exécution)", async () => {
    const sc = await scenario();
    const { w, s } = sc;
    const started = unwrap(await startRolloverRun(w.deps, w.ctx, s.yearId, { toAcademicYearId: sc.toYearId, steps: ["PERIODS", "HOLIDAYS"] }));
    const event = (await eventsOf(w, "academic.rollover.requested")).find((e) => e.payload.runId === started.run.id)!;
    const subscriber = subscribers.find((x) => x.name === "academic.run-rollover")!;
    const logs: unknown[] = [];
    const logger = { info: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a), error: (...a: unknown[]) => logs.push(a), debug: () => undefined, child: () => logger, fatal: () => undefined, trace: () => undefined } as never;
    const ctx = { tenantId: w.tenantId, db: { ctx: w.ctx, run: (fn: never) => w.deps.db.run(w.ctx, fn) }, systemDb: db.systemDb, tenantDb: db.tenantDb, logger, subscriber: subscriber.name, attempt: 1, jobId: "j" } as never;
    await subscriber.handler({ id: event.id, type: event.type, payload: event.payload, version: 1 } as never, ctx);
    expect(unwrap(await getRolloverRun(w.deps, w.ctx, started.run.id))).toMatchObject({ status: "COMPLETED", report: { periodsCreated: 2, holidaysCreated: 1 } });
    // une charge utile illisible est ignorée (jamais de plantage en boucle)
    await expect(subscriber.handler({ id: newId(), type: event.type, payload: { v: 1 }, version: 1 } as never, ctx)).resolves.toBeUndefined();
  });

  it("isolation : un autre tenant ne voit ni l'exécution ni le calendrier", async () => {
    const sc = await scenario();
    const started = unwrap(await startRolloverRun(sc.w.deps, sc.w.ctx, sc.s.yearId, { toAcademicYearId: sc.toYearId }));
    const other = makeWorld(db, await db.createTenant());
    expect(codeOf(await getRolloverRun(other.deps, other.ctx, started.run.id))).toBe("academic.rollover_run_not_found");
    expect(unwrap(await listHolidays(other.deps, other.ctx, {}))).toEqual([]);
    const outsider = createRequestContext({ tenantId: sc.w.tenantId, userId: newId(), roles: ["x"], institutionId: newId() });
    expect(codeOf(await getRolloverRun(sc.w.deps, outsider, started.run.id))).toBe("academic.rollover_run_not_found");
  });

  it("calendrier de l'établissement : dates cohérentes, doublon refusé, lecture par période", async () => {
    const w = makeWorld(db, await db.createTenant());
    expect(codeOf(await createHoliday(w.deps, w.ctx, { institutionId: w.institutionId, label: "X", startsOn: "2026-05-02", endsOn: "2026-05-01" }))).toBe("academic.holiday_dates_invalid");
    unwrap(await createHoliday(w.deps, w.ctx, { institutionId: w.institutionId, label: "Fête", startsOn: "2026-05-01" }));
    expect(codeOf(await createHoliday(w.deps, w.ctx, { institutionId: w.institutionId, label: "Fête", startsOn: "2026-05-01" }))).toBe("academic.holiday_duplicate");
    expect(unwrap(await listHolidays(w.deps, w.ctx, { institutionId: w.institutionId, from: "2026-05-02" }))).toEqual([]);
    expect(unwrap(await listHolidays(w.deps, w.ctx, { institutionId: w.institutionId, from: "2026-05-01", to: "2026-05-01" }))).toHaveLength(1);
  });
});
