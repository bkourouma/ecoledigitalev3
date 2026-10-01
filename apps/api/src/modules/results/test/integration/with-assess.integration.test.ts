/**
 * De bout en bout `assess` -> `results` avec l'adaptateur RÉEL du port de notes (aucun double en mémoire pour les notes) :
 * circuit de validation et publication par `assess`, événement `assess.grade.published` (sans note), abonné de `results`
 * (recalcul COALESCÉ), calcul par les VRAIES règles, verrou de période posé par `results` et imposé par les déclencheurs d'`assess`,
 * correction approuvée appliquée à la libération du verrou, clôture FINAL, réouverture, version n+1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemContext, newId, noopLogger, unwrap, type DomainEvent } from "@ecoledigitale/kernel";
import type { EventHandlerContext } from "@ecoledigitale/worker/sdk";
import {
  AssessRecordingAudit,
  approveRevision,
  cancelAssessment,
  createAssessDeps,
  createAssessment,
  inMemoryAssessPorts,
  instantiateAssessPack,
  listAssessmentTypes,
  requestRevision,
  saveGrades,
  transitionAssessment,
  type AssessCaps,
  type AssessDeps,
  type InMemoryAssessWorld,
} from "../../../assess";
import { createResultsDeps, type ResultsDeps } from "../../application/deps";
import { computePeriod } from "../../application/compute";
import { closePeriod, lockPeriod, reopenPeriod } from "../../application/lifecycle";
import { updateResultsSettings } from "../../application/governance";
import { processDueRecomputes } from "../../application/recompute";
import { getClassMatrix, getEnrollmentResult } from "../../application/reads";
import { assessPortFrom } from "../../infrastructure/assess-adapter";
import { rulesPortFrom } from "../../infrastructure/rules-adapter";
import { buildSubscribers } from "../../subscribers";
import type { EnrollmentRef } from "../../domain/types";
import { adminRows, createResultsTestDb, ctxFor, describeIntegration, type ResultsTestDb } from "../support/db";
import { CAPS_ALL, bind, creditStructure, makeWorld, period, type World } from "../support/world";

const ADMIN: AssessCaps = { manage: true, review: true, validate: true, publish: true, reviseRequest: true, reviseApprove: true, typeManage: true };
const TEACHER: AssessCaps = { reviseRequest: true };

describeIntegration("assess -> results de bout en bout (adaptateur réel, événements, verrou, correction, version n+1)", () => {
  let db: ResultsTestDb;
  let w: World;
  let aDeps: AssessDeps;
  let aw: InMemoryAssessWorld;
  let rdeps: ResultsDeps;
  const classroomId = newId();
  const yearId = newId();
  const p = period(newId());
  const built = creditStructure({ classroomId, yearId, period: p, ues: [{ code: "UE1", ecues: [{ code: "E1A", credits: "5" }, { code: "E1B", credits: "3" }] }, { code: "UE2", ecues: [{ code: "E2", credits: "6" }] }] });
  const node = (c: string): string => built.ids.get(c) as string;
  let students: EnrollmentRef[];
  let teacher: ReturnType<typeof ctxFor>;
  let director: ReturnType<typeof ctxFor>;
  let reviewer: ReturnType<typeof ctxFor>;
  let types: Record<string, string>;
  let draftId: string;
  let finalVersion: number;
  const ref = { classroomId, academicPeriodId: p.id };

  beforeAll(async () => {
    db = await createResultsTestDb({ withWorker: true });
    w = await makeWorld(db);
    await bind(w, "credit-semester@1", "CI-HIGHER-LMD");
    const { world, ports } = inMemoryAssessPorts();
    aw = world;
    aDeps = createAssessDeps({ db: db.tenantDb, clock: w.clock, audit: new AssessRecordingAudit(), ports, logger: noopLogger });
    rdeps = createResultsDeps({
      db: db.tenantDb,
      clock: w.clock,
      audit: w.audit,
      logger: noopLogger,
      ports: { curriculum: w.curriculum, roster: w.roster, assess: assessPortFrom(aDeps), rules: rulesPortFrom(w.rulesApi), guardianship: w.guardianship, names: w.names },
    });
    w.curriculum.set(built.structure);
    students = Array.from({ length: 4 }, () => ({ enrollmentId: newId(), studentId: newId() }));
    aw.roster.classrooms.set(classroomId, { id: classroomId, academicYearId: yearId });
    aw.periods.periods.set(p.id, { id: p.id, academicYearId: yearId });
    for (const s of students) {
      w.roster.entries.push({ ...s, active: true, classroomId });
      aw.roster.enrollments.push({ ...s, classroomId, active: true });
    }
    for (const c of ["E1A", "E1B", "E2"]) aw.curriculum.nodes.set(node(c), { id: node(c), resitAllowed: true });
    const person = (roles: string[], mfa: boolean) => {
      const userId = newId();
      const staffId = newId();
      aw.teaching.staffByUser.set(userId, staffId);
      for (const c of ["E1A", "E1B", "E2"]) aw.teaching.assign(staffId, node(c), classroomId);
      return ctxFor(w.tenantId, userId, roles, mfa);
    };
    teacher = person(["enseignant"], false);
    director = person(["directeur"], true);
    reviewer = person(["responsable_pedagogique"], true);
    unwrap(await instantiateAssessPack(aDeps, director, { pack: "HIGHER" }));
    types = Object.fromEntries(unwrap(await listAssessmentTypes(aDeps, director, { includeInactive: true })).map((t) => [t.code, t.id]));
    unwrap(await updateResultsSettings(rdeps, director, { requireDeliberation: false }));
  });
  afterAll(async () => {
    await db.drop();
  });

  const publish = async (typeCode: "DEVOIR" | "EXAMEN", ecue: string, scores: Array<string | null>, over: { sessionNo?: 1 | 2; title?: string } = {}) => {
    const a = unwrap(
      await createAssessment(aDeps, teacher, {
        typeId: types[typeCode] as string,
        classroomId,
        curriculumNodeId: node(ecue),
        academicPeriodId: p.id,
        title: over.title ?? `${typeCode} ${ecue}`,
        assessedOn: "2025-11-20",
        ...(over.sessionNo ? { sessionNo: over.sessionNo } : {}),
      }),
    );
    unwrap(
      await saveGrades(aDeps, teacher, {
        assessmentId: a.id,
        entries: students.map((s, i) => (scores[i] === null || scores[i] === undefined ? { enrollmentId: s.enrollmentId, entryStatus: "ABSENT_UNEXCUSED" as const } : { enrollmentId: s.enrollmentId, score: scores[i] })),
        caps: {},
      }),
    );
    const step = async (ctx: typeof teacher, to: "SUBMITTED" | "REVIEWED" | "APPROVED" | "PUBLISHED", caps: AssessCaps) => unwrap(await transitionAssessment(aDeps, ctx, { assessmentId: a.id, to, caps }));
    await step(teacher, "SUBMITTED", {});
    await step(reviewer, "REVIEWED", { review: true });
    await step(reviewer, "APPROVED", { review: true, validate: true });
    await step(director, "PUBLISHED", { review: true, validate: true, publish: true });
    return a;
  };

  const handlerContext = (name: string): EventHandlerContext => {
    const ctx = createSystemContext(w.tenantId);
    return { tenantId: w.tenantId, subscriber: name, attempt: 1, jobId: "j1", logger: noopLogger, systemDb: db.systemDb, tenantDb: db.tenantDb, db: { ctx, run: (fn, options) => db.tenantDb.run(ctx, fn, options) } } as EventHandlerContext;
  };
  const subscribers = buildSubscribers(() => rdeps);
  const deliverPublished = async (): Promise<number> => {
    const rows = await adminRows<{ id: string; type: string; payload: any }>(db, "SELECT id, type, payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'assess.grade.published' ORDER BY id", [w.tenantId]);
    const sub = subscribers.find((s) => s.name === "results.recompute-on-grade-published")!;
    for (const r of rows) {
      const event: DomainEvent = { id: r.id, type: r.type, version: 1, tenantId: w.tenantId, occurredAt: w.clock.now().toISOString(), payload: r.payload };
      await sub.handler(event, handlerContext(sub.name));
      await sub.handler(event, handlerContext(sub.name)); // livraison en double : sans effet
    }
    return rows.length;
  };
  const matrix = async () => unwrap(await getClassMatrix(rdeps, director, { ...ref, withLines: true, caps: CAPS_ALL }));
  const resultOf = async (e: EnrollmentRef) => unwrap(await getEnrollmentResult(rdeps, director, { enrollmentId: e.enrollmentId, academicPeriodId: p.id, caps: CAPS_ALL }));

  it("des notes NON publiées n'entrent jamais dans un calcul : aucune moyenne, jamais 0 (période sans évaluation publiée)", async () => {
    // une évaluation en brouillon (saisie en cours) existe, rien n'est publié
    const draft = unwrap(await createAssessment(aDeps, teacher, { typeId: types.DEVOIR as string, classroomId, curriculumNodeId: node("E1A"), academicPeriodId: p.id, title: "Brouillon", assessedOn: "2025-11-01" }));
    draftId = draft.id;
    unwrap(await saveGrades(aDeps, teacher, { assessmentId: draft.id, entries: students.map((s) => ({ enrollmentId: s.enrollmentId, score: "20" })), caps: {} }));
    const report = unwrap(await computePeriod(rdeps, director, ref));
    expect(report).toMatchObject({ computed: 4, errors: 0 });
    for (const s of students) expect((await resultOf(s)).header).toMatchObject({ average: null, decisionOutcome: "PENDING", validated: null });
  });

  it("publication par assess ⇒ événement SANS note ⇒ abonné ⇒ UNE demande coalescée ⇒ job ⇒ résultats calculés par les règles", async () => {
    // E1A : devoir 12, examen 14 → 13,2 ; E1B : 10/10 → 10 ; E2 : 14/14 → 14 (étudiant 1) ; l'étudiant 4 est absent à l'examen de E1A
    await publish("DEVOIR", "E1A", ["12", "9", "16", "15"]);
    await publish("EXAMEN", "E1A", ["14", "9", "16", null]);
    await publish("DEVOIR", "E1B", ["10", "12", "15", "14"]);
    await publish("EXAMEN", "E1B", ["10", "12", "15", "14"]);
    await publish("DEVOIR", "E2", ["14", "6", "13", "11"]);
    await publish("EXAMEN", "E2", ["14", "6", "13", "11"]);

    const events = await adminRows<{ payload: any }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'assess.grade.published' ORDER BY id", [w.tenantId]);
    expect(events).toHaveLength(6); // un par évaluation, pas un par note
    expect(JSON.stringify(events)).not.toMatch(/"score"|"12"|"14"/);
    expect(events[0]!.payload).toMatchObject({ v: 1, classroomId, academicPeriodId: p.id });

    expect(await deliverPublished()).toBe(6);
    const queue = await adminRows<{ status: string; causes: any }>(db, "SELECT status, causes FROM results.recompute_requests WHERE classroom_id = $1", [classroomId]);
    expect(queue).toHaveLength(1); // 6 publications, livraisons doublées ⇒ UNE demande
    expect(queue[0]!.status).toBe("PENDING");
    expect(await adminRows(db, "SELECT 1 FROM kernel.processed_events WHERE tenant_id = $1 AND subscriber = 'results.recompute-on-grade-published'", [w.tenantId])).toHaveLength(6);

    // pas encore échue : le job n'exécute rien ; échue : une exécution
    expect(unwrap(await processDueRecomputes(rdeps, createSystemContext(w.tenantId))).claimed).toBe(0);
    w.clock.advance(11_000);
    expect(unwrap(await processDueRecomputes(rdeps, createSystemContext(w.tenantId)))).toMatchObject({ claimed: 1, done: 1, failed: 0 });

    const a = await resultOf(students[0]!);
    // moyennes : étudiant 3 (14,5) > étudiant 1 (12,857…) > étudiant 4 (12,714…, absent à l'examen de E1A) > étudiant 2 (8,36…)
    expect(a.header).toMatchObject({ status: "DRAFT", decisionCode: "ADMITTED", validated: true, rank: 2, cohortSize: 4 });
    expect((await resultOf(students[2]!)).header.rank).toBe(1);
    expect(a.lines.find((l) => l.curriculumNodeId === node("E1A"))).toMatchObject({ value: "13.2", statusCode: "VALIDATED" });
    expect(a.lines.find((l) => l.level === "UE" && l.curriculumNodeId === node("UE1"))).toMatchObject({ value: "12", validated: true });
    // absence à l'examen ≠ 0 : l'étudiant 4 n'a pas de note d'E1A, son UE1 n'est pas validée, mais ses autres ECUE sont intactes
    const d = await resultOf(students[3]!);
    expect(d.lines.find((l) => l.curriculumNodeId === node("E1A"))).toMatchObject({ value: null, statusCode: "PENDING" });
    expect(d.lines.find((l) => l.curriculumNodeId === node("E1B"))).toMatchObject({ value: "14" });
    expect(d.lines.find((l) => l.level === "UE" && l.curriculumNodeId === node("UE1"))).toMatchObject({ validated: false });
    // étudiant 2 : E2 à 6 (UE2 non validée, rattrapable)
    expect((await resultOf(students[1]!)).lines.find((l) => l.level === "UE" && l.curriculumNodeId === node("UE2"))).toMatchObject({ validated: false, statusCode: "RESIT" });
  });

  it("verrouillage par results = verrou de notes d'assess (déclencheurs) : plus aucune saisie sur la classe et la période", async () => {
    // le brouillon oublié bloque le verrouillage : la liste vient du module assess (listPendingAssessments)
    const blocked = await lockPeriod(rdeps, director, { ...ref, caps: CAPS_ALL });
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.error.code).toBe("results.pending_assessments");
    expect(JSON.stringify(!blocked.ok && blocked.error.details)).toContain(draftId);
    unwrap(await cancelAssessment(aDeps, teacher, { assessmentId: draftId, reason: "Brouillon abandonné par l'enseignant.", caps: {} }));
    unwrap(await lockPeriod(rdeps, director, { ...ref, caps: CAPS_ALL }));
    const lockRows = await adminRows<{ locked_sessions: number[] }>(db, "SELECT locked_sessions FROM assess.period_locks WHERE classroom_id = $1", [classroomId]);
    expect(lockRows[0]?.locked_sessions).toEqual([1, 2]);
    const late = await createAssessment(aDeps, teacher, { typeId: types.DEVOIR as string, classroomId, curriculumNodeId: node("E1A"), academicPeriodId: p.id, title: "Tardif", assessedOn: "2026-01-05" });
    expect(late.ok).toBe(false);
    expect(!late.ok && late.error.code).toBe("assess.period_locked");
  });

  let revisionGradeId: string;
  it("correction d'une note publiée : demande → approbation ; période verrouillée ⇒ approuvée mais NON appliquée, résultats inchangés", async () => {
    const found = await adminRows<{ id: string }>(db, "SELECT g.id FROM assess.grades g JOIN assess.assessments a ON a.id = g.assessment_id WHERE a.curriculum_node_id = $1 AND g.enrollment_id = $2 AND a.title = 'EXAMEN E2'", [node("E2"), students[1]!.enrollmentId]);
    revisionGradeId = found[0]!.id;
    const req = unwrap(await requestRevision(aDeps, teacher, { gradeId: revisionGradeId, newScore: "12", reason: "Erreur de report sur la copie de l'étudiant.", caps: TEACHER }));
    const outcome = unwrap(await approveRevision(aDeps, director, { revisionId: req.id, comment: "Vérifié sur la copie.", caps: ADMIN }));
    expect(outcome.applied).toBe(false);
    const before = await resultOf(students[1]!);
    expect(before.lines.find((l) => l.curriculumNodeId === node("E2"))).toMatchObject({ value: "6" }); // devoir 6, examen 6 : inchangé tant que la correction n'est pas appliquée
  });

  it("clôture : résultats FINAL (version 1) + hash de clôture ; rien ne bouge malgré la correction approuvée en attente", async () => {
    const closed = unwrap(await closePeriod(rdeps, director, { ...ref, caps: CAPS_ALL }));
    expect(closed).toMatchObject({ resultsCount: 4, resultsVersion: 1 });
    expect(closed.closureHash).toMatch(/^[0-9a-f]{64}$/);
    const m = await matrix();
    expect(m.state.status).toBe("CLOSED");
    expect(m.rows.every((r) => r.header.status === "FINAL" && r.header.finalizedAt !== null)).toBe(true);
    expect(m.state.resultsVersion).toBe(1); // 1re clôture ; les versions d'en-tête comptent aussi les brouillons (v1 en attente, v2 publié, v3 FINAL)
    finalVersion = (await resultOf(students[1]!)).header.version;
    expect(finalVersion).toBe(3);
    expect((await resultOf(students[1]!)).lines.find((l) => l.curriculumNodeId === node("E2"))).toMatchObject({ value: "6", validated: false });
  });

  it("réouverture (CORRECTION) : le verrou tombe, la correction approuvée s'applique, le recalcul crée la version 2 ; la version 1 reste consultable", async () => {
    const reopened = unwrap(await reopenPeriod(rdeps, director, { ...ref, kind: "CORRECTION", reason: "Erreur de report constatée sur une copie d'examen.", caps: CAPS_ALL }));
    expect(reopened.status).toBe("OPEN");
    const applied = await adminRows<{ status: string }>(db, "SELECT status FROM assess.grade_revisions WHERE grade_id = $1", [revisionGradeId]);
    expect(applied.map((r) => r.status)).toEqual(["APPLIED"]);
    const scoreNow = await adminRows<{ score: string }>(db, "SELECT score::text FROM assess.grades WHERE id = $1", [revisionGradeId]);
    expect(Number(scoreNow[0]!.score)).toBe(12);

    unwrap(await computePeriod(rdeps, director, ref));
    const b = await resultOf(students[1]!);
    expect(b.header).toMatchObject({ status: "DRAFT", version: finalVersion + 1 });
    expect(b.lines.find((l) => l.curriculumNodeId === node("E2"))).toMatchObject({ value: "9.6", displayValue: "9.60", validated: false }); // 6×0,4 + 12×0,6 : valeur exacte, jamais arrondie avant le seuil
    unwrap(await lockPeriod(rdeps, director, { ...ref, caps: CAPS_ALL }));
    const closed2 = unwrap(await closePeriod(rdeps, director, { ...ref, caps: CAPS_ALL }));
    expect(closed2.resultsVersion).toBe(2);
    const versions = await adminRows<{ version: number; status: string }>(db, "SELECT version, status FROM results.period_results WHERE enrollment_id = $1 ORDER BY version", [students[1]!.enrollmentId]);
    expect(versions.map((v) => v.status)).toEqual(["SUPERSEDED", "SUPERSEDED", "SUPERSEDED", "SUPERSEDED", "FINAL"]);
    expect(versions.at(-1)?.version).toBe(finalVersion + 2); // v3 FINAL (1re clôture) → v4 brouillon de correction → v5 FINAL (2e clôture)
    expect(versions.find((v) => v.version === finalVersion)?.status).toBe("SUPERSEDED"); // l'ancien FINAL reste consultable, jamais effacé
  });
});
