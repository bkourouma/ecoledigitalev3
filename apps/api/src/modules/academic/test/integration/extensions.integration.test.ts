/**
 * Extensions Phase 4-5 d'academic (specs 005, 006, 007, 018), sur Postgres réel : garde d'activation de classe,
 * annulation d'une inscription en attente, faits d'éligibilité et redoublements du cycle, source `ADMISSION`,
 * transfert entre programmes d'un même niveau. Toutes additives : le comportement sans garde est celui d'avant.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { err, ok, newId, unwrap } from "@ecoledigitale/kernel";
import {
  activateClassroom,
  cancelEnrollment,
  changeEnrollmentFunding,
  classroomAction,
  countRepeatsInCycle,
  createClassroom,
  createProgram,
  enrollStudent,
  getAcademicYear,
  getClassroom,
  getEligibilityFacts,
  getEnrollment,
  getEnrollmentHistory,
  listReference,
  putReference,
  recordEnrollmentOutcome,
  transferEnrollment,
  transitionEnrollment,
  updateAcademicSettings,
  type ClassroomActivationGuard,
} from "../../index";
import { adminRows, createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";
import { addStudent, assertEventsValid, codeOf, createNextYear, eventsOf, makeWorld, seedHigher, type HigherSeed, type World } from "../support/world";

describeIntegration("extensions d'academic pour les modules de packs (Postgres réel)", () => {
  let db: AcademicTestDb;
  beforeAll(async () => {
    db = await createAcademicTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  const policy = (w: World, p: "AUTO" | "MANUAL") => updateAcademicSettings(w.deps, w.ctx, w.institutionId, { enrollmentConfirmationPolicy: p }).then(unwrap);

  describe("ClassroomActivationGuard (spec 005 T-P11)", () => {
    /** Une seconde classe en BROUILLON (curriculum publié de la graine) : prête à être activée. */
    async function draftClassroom(w: World, s: HigherSeed, code: string): Promise<string> {
      return unwrap(
        await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, curriculumVersionId: s.versionId, code, name: code }),
      ).id;
    }

    it("sans garde câblé : l'activation est inchangée (repli : aucun refus)", async () => {
      const w = makeWorld(db, await db.createTenant());
      const s = await seedHigher(w); // la graine active déjà une classe, sans aucun garde
      const id = await draftClassroom(w, s, "B");
      expect(unwrap(await activateClassroom(w.deps, w.ctx, id)).status).toBe("ACTIVE");
      expect(w.deps.ports.classroomActivation.check).toBeTypeOf("function");
    });

    it("avec un garde qui refuse : la classe reste en brouillon, l'erreur porte le code du garde, rien n'est publié", async () => {
      const seen: string[] = [];
      let refuse = true;
      const guard: ClassroomActivationGuard = {
        check: async (_ctx, classroomId) => {
          seen.push(classroomId);
          return refuse ? err({ code: "primary_school.homeroom_required", reason: "Un titulaire de classe est requis.", details: { missing: "HOMEROOM" } }) : ok(undefined);
        },
      };
      // le garde ne s'applique pas à la classe de la graine : on le câble après
      const w = makeWorld(db, await db.createTenant(), { ports: { classroomActivation: { check: async () => ok(undefined) } } });
      const s = await seedHigher(w);
      const guarded = makeWorld(db, w.tenantId, { ports: { classroomActivation: guard }, institutionId: w.institutionId, ctx: w.ctx });
      const id = await draftClassroom(w, s, "B");

      const refused = await activateClassroom(guarded.deps, guarded.ctx, id);
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code).toBe("primary_school.homeroom_required");
        expect(refused.error.kind).toBe("conflict");
        expect(refused.error.message).toBe("Un titulaire de classe est requis.");
        expect(refused.error.details).toMatchObject({ guardCode: "primary_school.homeroom_required", refusedBy: "classroomActivation", missing: "HOMEROOM" });
      }
      expect(seen).toEqual([id]);
      expect(unwrap(await getClassroom(w.deps, w.ctx, id)).status).toBe("DRAFT");
      expect((await eventsOf(w, "academic.classroom.activated")).filter((e) => e.payload.classroomId === id)).toHaveLength(0);

      // l'action générique passe par le même garde
      expect(codeOf(await classroomAction(guarded.deps, guarded.ctx, id, "activate"))).toBe("primary_school.homeroom_required");

      // le garde se ravise : la classe s'active
      refuse = false;
      expect(unwrap(await activateClassroom(guarded.deps, guarded.ctx, id)).status).toBe("ACTIVE");
      expect((await eventsOf(w, "academic.classroom.activated")).filter((e) => e.payload.classroomId === id)).toHaveLength(1);
    });

    it("un refus sans code reçoit le code du cœur ; le garde n'est appelé qu'APRÈS les contrôles du cœur (curriculum publié)", async () => {
      const calls: string[] = [];
      const guard: ClassroomActivationGuard = { check: async (_c, id) => (calls.push(id), err({ code: "" })) };
      const w = makeWorld(db, await db.createTenant());
      const s = await seedHigher(w);
      const guarded = makeWorld(db, w.tenantId, { ports: { classroomActivation: guard }, institutionId: w.institutionId, ctx: w.ctx });
      const noCurriculum = unwrap(await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, code: "SANS", name: "SANS" })).id;
      expect(codeOf(await activateClassroom(guarded.deps, guarded.ctx, noCurriculum))).toBe("academic.classroom_curriculum_required");
      expect(calls).toEqual([]);
      const ready = await draftClassroom(w, s, "C");
      expect(codeOf(await activateClassroom(guarded.deps, guarded.ctx, ready))).toBe("academic.classroom_activation_refused");
      expect(calls).toEqual([ready]);
    });
  });

  describe("cancelEnrollment : inscription EN ATTENTE (spec 007 §16)", () => {
    it("PENDING -> CANCELLED, événement `academic.enrollment.cancelled` sans donnée personnelle, audit, place libérée, idempotent", async () => {
      const w = makeWorld(db, await db.createTenant());
      const s = await seedHigher(w);
      await policy(w, "MANUAL"); // les inscriptions restent en attente
      const student = addStudent(w, { displayName: "Nom Secret" });
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: student.studentId, classroomId: s.classroomId }));
      expect(e.status).toBe("PENDING");
      expect(unwrap(await getClassroom(w.deps, w.ctx, s.classroomId)).enrolledCount).toBe(1);

      const cancelled = unwrap(await cancelEnrollment(w.deps, w.ctx, e.id, { reason: "Candidature retirée par la famille" }));
      expect(cancelled).toMatchObject({ id: e.id, status: "CANCELLED" });
      expect(cancelled.endedOn).not.toBeNull();
      expect(unwrap(await getClassroom(w.deps, w.ctx, s.classroomId)).enrolledCount).toBe(0);

      const events = (await eventsOf(w, "academic.enrollment.cancelled")).filter((x) => x.payload.enrollmentId === e.id);
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ v: 1, enrollmentId: e.id, studentId: student.studentId, status: "CANCELLED", previousStatus: "PENDING", reason: "Candidature retirée par la famille" });
      expect(JSON.stringify(events[0]!.payload)).not.toContain("Nom Secret");
      expect(w.audit.actions()).toContain("academic.enrollment.cancelled");
      await assertEventsValid(w);
      const history = unwrap(await getEnrollmentHistory(w.deps, w.ctx, e.id));
      expect(history.filter((h) => h.kind === "STATUS" && (h.toValue as { status?: string } | null)?.status === "CANCELLED")).toHaveLength(1);

      // idempotent : même résultat, ni nouvel événement, ni nouvelle ligne d'historique
      const again = unwrap(await cancelEnrollment(w.deps, w.ctx, e.id));
      expect(again).toMatchObject({ id: e.id, status: "CANCELLED" });
      expect((await eventsOf(w, "academic.enrollment.cancelled")).filter((x) => x.payload.enrollmentId === e.id)).toHaveLength(1);
      expect(unwrap(await getEnrollmentHistory(w.deps, w.ctx, e.id))).toHaveLength(history.length);

      // l'élève peut être ré-inscrit dans la même classe
      expect(unwrap(await enrollStudent(w.deps, w.ctx, { studentId: student.studentId, classroomId: s.classroomId })).status).toBe("PENDING");
    });

    it("motif facultatif (motif par défaut) ; motif trop court refusé ; refus si l'inscription n'est pas en attente (une inscription confirmée se retire)", async () => {
      const w = makeWorld(db, await db.createTenant());
      const s = await seedHigher(w);
      await policy(w, "MANUAL");
      const a = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
      expect(codeOf(await cancelEnrollment(w.deps, w.ctx, a.id, { reason: "non" }))).toBe("academic.enrollment_reason_required");
      expect(unwrap(await getEnrollment(w.deps, w.ctx, a.id)).status).toBe("PENDING");
      expect(unwrap(await cancelEnrollment(w.deps, w.ctx, a.id)).status).toBe("CANCELLED");
      const [ev] = await eventsOf(w, "academic.enrollment.cancelled");
      expect(ev!.payload.reason).toBe("Annulation d'une inscription en attente");

      const b = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
      unwrap(await transitionEnrollment(w.deps, w.ctx, b.id, "confirm"));
      expect(codeOf(await cancelEnrollment(w.deps, w.ctx, b.id, { reason: "Erreur de saisie" }))).toBe("academic.enrollment_not_pending");
      expect(unwrap(await getEnrollment(w.deps, w.ctx, b.id)).status).toBe("ACTIVE");
      unwrap(await transitionEnrollment(w.deps, w.ctx, b.id, "withdraw", "Départ de l'établissement"));
      expect(codeOf(await cancelEnrollment(w.deps, w.ctx, b.id))).toBe("academic.enrollment_not_pending");

      expect(codeOf(await cancelEnrollment(w.deps, w.ctx, newId()))).toBe("academic.enrollment_not_found");
    });

    it("isolation : un autre tenant ne voit pas l'inscription", async () => {
      const w = makeWorld(db, await db.createTenant());
      const s = await seedHigher(w);
      await policy(w, "MANUAL");
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
      const other = makeWorld(db, await db.createTenant());
      expect(codeOf(await cancelEnrollment(other.deps, other.ctx, e.id))).toBe("academic.enrollment_not_found");
      expect(unwrap(await getEnrollment(w.deps, w.ctx, e.id)).status).toBe("PENDING");
    });
  });

  describe("source ADMISSION (spec 007 §16) et événement de confirmation", () => {
    it("`sourceKind: ADMISSION` + `sourceRef = applicationId` sont conservés ; `academic.enrollment.confirmed` porte enrollmentId et studentId", async () => {
      const w = makeWorld(db, await db.createTenant());
      const s = await seedHigher(w);
      await policy(w, "AUTO");
      const applicationId = newId();
      const student = addStudent(w);
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: student.studentId, classroomId: s.classroomId, sourceKind: "ADMISSION", sourceRef: applicationId }));
      expect(e).toMatchObject({ sourceKind: "ADMISSION", sourceRef: applicationId, status: "ACTIVE" });
      const row = (await adminRows<{ source_kind: string; source_ref: string }>(db, "SELECT source_kind, source_ref FROM academic.enrollments WHERE id = $1", [e.id]))[0]!;
      expect(row).toEqual({ source_kind: "ADMISSION", source_ref: applicationId });
      const confirmed = (await eventsOf(w, "academic.enrollment.confirmed")).find((x) => x.payload.enrollmentId === e.id)!;
      expect(confirmed.payload).toMatchObject({ v: 1, enrollmentId: e.id, studentId: student.studentId });
    });

    it("un dossier d'élève INACTIF n'est inscriptible QUE par une admission (activé à la confirmation) ; les autres parcours le refusent", async () => {
      const w = makeWorld(db, await db.createTenant());
      const s = await seedHigher(w);
      await policy(w, "AUTO");
      const inactive = addStudent(w, { status: "INACTIVE" });
      expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: inactive.studentId, classroomId: s.classroomId }))).toBe("academic.student_not_enrollable");
      expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: inactive.studentId, classroomId: s.classroomId, sourceKind: "MANUAL" }))).toBe("academic.student_not_enrollable");
      const admitted = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: inactive.studentId, classroomId: s.classroomId, sourceKind: "ADMISSION", sourceRef: newId() }));
      expect(admitted.sourceKind).toBe("ADMISSION");
      // les autres statuts (suspendu, exclu, retiré, archivé) restent refusés même pour une admission
      for (const status of ["SUSPENDED", "EXCLUDED", "WITHDRAWN", "ARCHIVED"]) {
        const other = addStudent(w, { status });
        expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: other.studentId, classroomId: s.classroomId, sourceKind: "ADMISSION", sourceRef: newId() })), status).toBe("academic.student_not_enrollable");
      }
    });
  });

  describe("getEligibilityFacts et countRepeatsInCycle (specs 018 §16 et 005 `cas_deja_redoublant`)", () => {
    /** Trois années consécutives, une classe de L1 par année, mêmes programme et cycle. */
    async function threeYears(): Promise<{ w: World; s: HigherSeed; classrooms: string[]; years: string[] }> {
      const w = makeWorld(db, await db.createTenant());
      const s = await seedHigher(w);
      await policy(w, "AUTO");
      const y1 = unwrap(await getAcademicYear(w.deps, w.ctx, s.yearId));
      const y2 = await createNextYear(w, y1.endsOn, "Y2");
      const y3 = await createNextYear(w, y2.endsOn, "Y3");
      const mk = async (yearId: string, code: string): Promise<string> =>
        unwrap(await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, code, name: code })).id;
      return { w, s, classrooms: [s.classroomId, await mk(y2.id, "L1-Y2"), await mk(y3.id, "L1-Y3")], years: [s.yearId, y2.id, y3.id] };
    }

    it("niveau, cycle, drapeau informatif d'examen terminal, année, statut ; aucune donnée d'identité", async () => {
      const w = makeWorld(db, await db.createTenant());
      const s = await seedHigher(w);
      await policy(w, "AUTO");
      const student = addStudent(w, { displayName: "Identité Secrète" });
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: student.studentId, classroomId: s.classroomId }));
      const facts = unwrap(await getEligibilityFacts(w.deps, w.ctx, e.id));
      expect(facts).toMatchObject({
        enrollmentId: e.id,
        studentId: student.studentId,
        institutionId: w.institutionId,
        academicYearId: s.yearId,
        classroomId: s.classroomId,
        gradeLevelCode: "L1",
        educationLevelCode: "LICENCE",
        pack: "HIGHER",
        terminalExamRequired: false,
        status: "ACTIVE",
        mode: "CLASS",
        isRepeating: false,
        repeatsInCycle: 0,
        repeatsBeforeYear: 0,
      });
      expect(JSON.stringify(facts)).not.toContain("Identité Secrète");
      // le drapeau suit la donnée du niveau (jamais décisionnel)
      unwrap(await putReference(w.deps, w.ctx, "grade-levels", [{ code: "L1", label: "Licence 1", educationLevelCode: "LICENCE", ordinal: 1, terminalExamRequired: true }]));
      expect(unwrap(await getEligibilityFacts(w.deps, w.ctx, e.id)).terminalExamRequired).toBe(true);
      expect(unwrap(await listReference(w.deps, w.ctx, "grade-levels")).find((g) => g.code === "L1")?.terminalExamRequired).toBe(true);
      expect(codeOf(await getEligibilityFacts(w.deps, w.ctx, newId()))).toBe("academic.enrollment_not_found");
      const other = makeWorld(db, await db.createTenant());
      expect(codeOf(await getEligibilityFacts(other.deps, other.ctx, e.id))).toBe("academic.enrollment_not_found");
    });

    it("redoublements du cycle : marqués `is_repeating` OU consécutifs à une issue REPEAT, comptés une fois chacun ; annulés et en attente ignorés", async () => {
      const { w, classrooms, years } = await threeYears();
      const student = addStudent(w);
      const stranger = addStudent(w);
      const strangerEnrollment = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: stranger.studentId, classroomId: classrooms[0]! }));

      // Année 1 : première fois en L1 ; issue = redoublement (n'est PAS encore un redoublement subi)
      const e1 = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: student.studentId, classroomId: classrooms[0]! }));
      unwrap(await recordEnrollmentOutcome(w.deps, w.ctx, e1.id, { outcomeCode: "REPEATED" }));
      expect(unwrap(await getEligibilityFacts(w.deps, w.ctx, e1.id))).toMatchObject({ isRepeating: false, repeatsInCycle: 0, repeatsBeforeYear: 0 });

      // Année 2 : réinscription marquée redoublante ET liée à l'issue REPEAT (un seul redoublement)
      const e2 = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: student.studentId, classroomId: classrooms[1]!, isRepeating: true, previousEnrollmentId: e1.id }));
      expect(unwrap(await getEligibilityFacts(w.deps, w.ctx, e2.id))).toMatchObject({ isRepeating: true, repeatsInCycle: 1, repeatsBeforeYear: 0 });
      unwrap(await recordEnrollmentOutcome(w.deps, w.ctx, e2.id, { outcomeCode: "REPEATED" }));

      // Année 3 : AUCUN drapeau, mais l'inscription prolonge une issue REPEAT : deuxième redoublement
      const e3 = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: student.studentId, classroomId: classrooms[2]!, previousEnrollmentId: e2.id }));
      expect(unwrap(await getEligibilityFacts(w.deps, w.ctx, e3.id))).toMatchObject({ isRepeating: false, repeatsInCycle: 2, repeatsBeforeYear: 1 });
      // l'année 1 ne « voit » pas les redoublements postérieurs
      expect(unwrap(await getEligibilityFacts(w.deps, w.ctx, e1.id)).repeatsInCycle).toBe(0);
      // un élève sans redoublement
      expect(unwrap(await getEligibilityFacts(w.deps, w.ctx, strangerEnrollment.id))).toMatchObject({ repeatsInCycle: 0, repeatsBeforeYear: 0 });

      // équivalent `countRepeatsInCycle` (entrée de la règle `cas_deja_redoublant`)
      const count = async (input: { academicYearId?: string; beforeYear?: boolean } = {}) => unwrap(await countRepeatsInCycle(w.deps, w.ctx, { studentId: student.studentId, educationLevelCode: "LICENCE", ...input }));
      expect(await count()).toBe(2);
      expect(await count({ academicYearId: years[0]! })).toBe(0);
      expect(await count({ academicYearId: years[1]! })).toBe(1);
      expect(await count({ academicYearId: years[1]!, beforeYear: true })).toBe(0);
      expect(await count({ academicYearId: years[2]!, beforeYear: true })).toBe(1);
      expect(unwrap(await countRepeatsInCycle(w.deps, w.ctx, { studentId: stranger.studentId, educationLevelCode: "LICENCE" }))).toBe(0);
      // un autre cycle d'enseignement n'est pas concerné
      expect(unwrap(await countRepeatsInCycle(w.deps, w.ctx, { studentId: student.studentId, educationLevelCode: "MASTER" }))).toBe(0);
      expect(codeOf(await countRepeatsInCycle(w.deps, w.ctx, { studentId: student.studentId, educationLevelCode: "INCONNU" }))).toBe("academic.education_level_not_found");
      expect(codeOf(await countRepeatsInCycle(w.deps, w.ctx, { studentId: student.studentId, educationLevelCode: "LICENCE", academicYearId: newId() }))).toBe("academic.year_not_found");

      // une inscription annulée ne compte pas
      const cancelledStudent = addStudent(w);
      const c1 = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: cancelledStudent.studentId, classroomId: classrooms[1]!, isRepeating: true }));
      expect(unwrap(await countRepeatsInCycle(w.deps, w.ctx, { studentId: cancelledStudent.studentId, educationLevelCode: "LICENCE" }))).toBe(1);
      unwrap(await transitionEnrollment(w.deps, w.ctx, c1.id, "cancel", "Saisie en double"));
      expect(unwrap(await countRepeatsInCycle(w.deps, w.ctx, { studentId: cancelledStudent.studentId, educationLevelCode: "LICENCE" }))).toBe(0);
    });
  });

  describe("transfert entre programmes d'un même niveau en cours d'année et financement (spec 006 §7.4)", () => {
    it("`transferEnrollment` accepte une classe d'un AUTRE programme couvrant le même niveau ; `changeEnrollmentFunding` est appelable (affecté par l'État)", async () => {
      const w = makeWorld(db, await db.createTenant());
      const s = await seedHigher(w);
      await policy(w, "AUTO");
      const levels = unwrap(await listReference(w.deps, w.ctx, "education-levels"));
      const licence = levels.find((l) => l.code === "LICENCE")!;
      const other = unwrap(await createProgram(w.deps, w.ctx, { institutionId: w.institutionId, educationLevelId: licence.id, code: "MATHS", label: "Mathématiques", gradeLevelIds: [s.gradeLevelId] }));
      const target = unwrap(await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: other.id, gradeLevelId: s.gradeLevelId, code: "L1-MATHS", name: "L1 Maths" }));
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
      const moved = unwrap(await transferEnrollment(w.deps, w.ctx, e.id, { toClassroomId: target.id, reason: "Changement de série en cours d'année" }));
      expect(moved).toMatchObject({ id: e.id, classroomId: target.id, status: "ACTIVE" });
      expect(unwrap(await getEligibilityFacts(w.deps, w.ctx, e.id)).classroomId).toBe(target.id);

      const funded = unwrap(
        await changeEnrollmentFunding(w.deps, w.ctx, e.id, { fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-0001", reason: "Affectation notifiée par l'État" }),
      );
      expect(funded).toMatchObject({ fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-0001" });
      expect(codeOf(await changeEnrollmentFunding(w.deps, w.ctx, e.id, { fundingType: "STATE_ASSIGNED", reason: "Sans référence d'affectation" }))).toBe("academic.funding_reference_required");
    });
  });
});
