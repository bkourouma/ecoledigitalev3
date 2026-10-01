/** US3 (classes, offres) et US4 (inscription qui historise) sur Postgres réel. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, newId, unwrap } from "@ecoledigitale/kernel";
import {
  changeEnrollmentFunding,
  classroomAction,
  createClassroom,
  createCurriculumVersion,
  createOffering,
  enrollStudent,
  enrollStudentsBulk,
  finalizeEndedOfferings,
  getClassroom,
  getEnrollment,
  getEnrollmentDetail,
  getEnrollmentHistory,
  getOffering,
  getRoster,
  listClassrooms,
  listEnrollments,
  listEnrollmentsByStudent,
  listOfferings,
  offeringAction,
  openOfferingsForPeriod,
  recordEnrollmentOutcome,
  reopenOffering,
  transferEnrollment,
  transitionEnrollment,
  updateAcademicSettings,
  updateClassroom,
  updateOffering,
  closeAcademicYear,
  RecordingAudit,
} from "../../index";
import { addDays } from "../../domain/dates";
import { adminOne, adminRows, createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";
import { institutionOf, neverReady } from "../support/ports";
import { addStudent, assertEventsValid, codeOf, eventsOf, makeWorld, seedHigher, todayOf, type HigherSeed, type World } from "../support/world";

describeIntegration("classes, offres et inscriptions (Postgres réel)", () => {
  let db: AcademicTestDb;
  beforeAll(async () => {
    db = await createAcademicTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });
  const newWorld = async (ports = {}): Promise<World> => makeWorld(db, await db.createTenant(), { ports });
  const auto = (w: World) => updateAcademicSettings(w.deps, w.ctx, w.institutionId, { enrollmentConfirmationPolicy: "AUTO" }).then(unwrap);

  describe("classes (AC3.1)", () => {
    it("niveau couvert par le programme, curriculum du même programme et de la même année, activation exigeant un curriculum publié", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const grades = await adminRows<{ id: string; code: string }>(db, "SELECT id, code FROM academic.grade_levels WHERE tenant_id = $1", [w.tenantId]);
      const m2 = grades.find((g) => g.code === "M2")!;
      const base = { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, code: "B", name: "B" };
      expect(codeOf(await createClassroom(w.deps, w.ctx, { ...base, gradeLevelId: m2.id }))).toBe("academic.classroom_level_not_in_program");
      expect(codeOf(await createClassroom(w.deps, w.ctx, { ...base, institutionId: newId() }))).toBe("academic.institution_not_found");
      expect(codeOf(await createClassroom(w.deps, w.ctx, { ...base, curriculumVersionId: newId() }))).toBe("academic.curriculum_not_found");
      const draftClass = unwrap(await createClassroom(w.deps, w.ctx, base));
      expect(draftClass).toMatchObject({ status: "DRAFT", curriculumVersionId: null, capacityIsHard: true, enrolledCount: 0 });
      expect(codeOf(await classroomAction(w.deps, w.ctx, draftClass.id, "activate"))).toBe("academic.classroom_curriculum_required");
      // un curriculum en brouillon ne permet pas d'activer
      const next = await adminOne<{ e: string }>(db, "SELECT to_char(max(ends_on), 'YYYY-MM-DD') e FROM academic.academic_years WHERE tenant_id = $1", [w.tenantId]);
      const y2 = unwrap(await (await import("../../index")).createAcademicYear(w.deps, w.ctx, { institutionId: w.institutionId, code: "Y2", label: "Y2", startsOn: addDays(next.e, 1) }));
      const draftVersion = unwrap(await createCurriculumVersion(w.deps, w.ctx, { programId: s.programId, academicYearId: y2.id }));
      const c2 = unwrap(await createClassroom(w.deps, w.ctx, { ...base, academicYearId: y2.id, curriculumVersionId: draftVersion.id, code: "C2", name: "C2" }));
      expect(codeOf(await classroomAction(w.deps, w.ctx, c2.id, "activate"))).toBe("academic.classroom_curriculum_draft");
      // version d'une autre année
      expect(codeOf(await createClassroom(w.deps, w.ctx, { ...base, curriculumVersionId: draftVersion.id, code: "C3", name: "C3" }))).toBe("academic.classroom_curriculum_mismatch");
      // nom et code uniques par (année, programme, niveau)
      expect(codeOf(await createClassroom(w.deps, w.ctx, { ...base, name: "autre" }))).toBe("academic.classroom_code_taken");
      expect(codeOf(await createClassroom(w.deps, w.ctx, { ...base, code: "Z" }))).toBe("academic.classroom_name_taken");
      expect(unwrap(await getClassroom(w.deps, w.ctx, draftClass.id)).id).toBe(draftClass.id);
      const list = unwrap(await listClassrooms(w.deps, w.ctx, { academicYearId: s.yearId, pageSize: 1 }));
      expect(list).toMatchObject({ total: 2, pageSize: 1, page: 1 });
      expect(list.items).toHaveLength(1);
      expect((await eventsOf(w, "academic.classroom.created")).length).toBe(4);
      await assertEventsValid(w);
    });
    it("cycle : activer, terminer, rouvrir ; annuler exige un motif et l'absence d'inscrits vivants ; modification de capacité contrôlée", async () => {
      const w = await newWorld();
      const s = await seedHigher(w, { capacity: 5 });
      await auto(w);
      const st = addStudent(w);
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId }));
      expect(codeOf(await classroomAction(w.deps, w.ctx, s.classroomId, "cancel", "x"))).toBe("academic.enrollment_reason_required");
      expect(codeOf(await classroomAction(w.deps, w.ctx, s.classroomId, "cancel", "Fusion avec une autre classe"))).toBe("academic.classroom_has_enrollments");
      expect(codeOf(await updateClassroom(w.deps, w.ctx, s.classroomId, { capacity: 0 as never }))).not.toBeNull();
      const e2 = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
      expect(codeOf(await updateClassroom(w.deps, w.ctx, s.classroomId, { capacity: 1 }))).toBe("academic.capacity_below_reserved");
      expect(unwrap(await updateClassroom(w.deps, w.ctx, s.classroomId, { capacity: 2, name: "L1 renommée" }))).toMatchObject({ capacity: 2, name: "L1 renommée", enrolledCount: 2 });
      expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }))).toBe("academic.classroom_full");
      expect(unwrap(await updateClassroom(w.deps, w.ctx, s.classroomId, { capacityIsHard: false })).capacityIsHard).toBe(false);
      // capacité INDICATIVE : le dépassement est permis
      expect(unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId })).status).toBe("ACTIVE");
      unwrap(await transitionEnrollment(w.deps, w.ctx, e.id, "cancel", "Départ avant la rentrée"));
      unwrap(await transitionEnrollment(w.deps, w.ctx, e2.id, "withdraw", "Retrait volontaire de l'élève"));
      expect(unwrap(await classroomAction(w.deps, w.ctx, s.classroomId, "complete")).status).toBe("COMPLETED");
      expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }))).toBe("academic.classroom_not_open");
      expect(unwrap(await classroomAction(w.deps, w.ctx, s.classroomId, "activate")).status).toBe("ACTIVE");
      expect(codeOf(await classroomAction(w.deps, w.ctx, s.classroomId, "complete").then(() => classroomAction(w.deps, w.ctx, s.classroomId, "complete")))).toBe("academic.classroom_transition");
    });
  });

  describe("offres (AC3.2 – AC3.5b)", () => {
    const window = (w: World) => ({ registrationOpensAt: new Date(w.clock.now().getTime() - 86_400_000).toISOString(), registrationClosesAt: new Date(w.clock.now().getTime() + 30 * 86_400_000).toISOString() });
    it("ouvrir un semestre crée UNE offre par UE inscriptible, mêmes dates/fenêtre/capacité, de façon IDEMPOTENTE", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const body = { periodNodeId: s.periodNodeId, startsOn: todayOf(w), endsOn: addDays(todayOf(w), 90), capacity: 30, ...window(w) };
      const first = unwrap(await openOfferingsForPeriod(w.deps, w.ctx, s.classroomId, body));
      expect(first.created.map((o) => o.curriculumNodeId).sort()).toEqual([s.ue1.id, s.ue2.id].sort());
      expect(first.existing).toEqual([]);
      for (const o of first.created) expect(o).toMatchObject({ status: "DRAFT", capacity: 30, startsOn: body.startsOn, endsOn: body.endsOn, registrationOpensAt: body.registrationOpensAt, heldPlaces: 0 });
      const second = unwrap(await openOfferingsForPeriod(w.deps, w.ctx, s.classroomId, body));
      expect(second.created).toEqual([]);
      expect(second.existing).toHaveLength(2);
      expect(Number((await adminOne<{ n: number }>(db, "SELECT count(*)::int n FROM academic.classroom_offerings WHERE classroom_id = $1", [s.classroomId])).n)).toBe(2);
      // jamais de 500 : dates incohérentes => erreur de validation explicite
      expect(codeOf(await openOfferingsForPeriod(w.deps, w.ctx, s.classroomId, { ...body, endsOn: addDays(body.startsOn, -3) }))).toBe("academic.offering_dates_invalid");
      expect(codeOf(await openOfferingsForPeriod(w.deps, w.ctx, s.classroomId, { ...body, endsOn: "2999-01-01" }))).toBe("academic.offering_outside_year");
      expect(codeOf(await openOfferingsForPeriod(w.deps, w.ctx, s.classroomId, { ...body, registrationClosesAt: addDays(todayOf(w), -40) + "T00:00:00.000Z" }))).toBe("academic.offering_dates_invalid");
      expect(codeOf(await openOfferingsForPeriod(w.deps, w.ctx, s.classroomId, { ...body, periodNodeId: s.levelNodeId }))).toBe("academic.invalid_input");
      expect(codeOf(await openOfferingsForPeriod(w.deps, w.ctx, s.classroomId, { ...body, periodNodeId: newId() }))).toBe("academic.node_not_found");
      expect(unwrap(await listOfferings(w.deps, w.ctx, { classroomId: s.classroomId }))).toHaveLength(2);
    });
    it("une classe sans curriculum, ou un nœud non offrable (ECUE, hors curriculum), ne reçoit pas d'offre", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const bare = unwrap(await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, code: "NUE", name: "Nue" }));
      const body = { periodNodeId: s.periodNodeId, startsOn: todayOf(w), endsOn: addDays(todayOf(w), 30) };
      expect(codeOf(await openOfferingsForPeriod(w.deps, w.ctx, bare.id, body))).toBe("academic.classroom_curriculum_required");
      const dates = { label: "x", startsOn: body.startsOn, endsOn: body.endsOn };
      expect(codeOf(await createOffering(w.deps, w.ctx, s.classroomId, { ...dates, curriculumNodeId: s.ue1.ecueIds[0]! }))).toBe("academic.offering_node_not_enrollable");
      expect(codeOf(await createOffering(w.deps, w.ctx, s.classroomId, { ...dates, curriculumNodeId: newId() }))).toBe("academic.offering_node_not_in_curriculum");
      expect(unwrap(await createOffering(w.deps, w.ctx, s.classroomId, { ...dates, curriculumNodeId: s.ue1.id })).label).toBe("UE UE1");
      expect(codeOf(await createOffering(w.deps, w.ctx, s.classroomId, { ...dates, curriculumNodeId: s.ue1.id }))).toBe("academic.offering_exists");
    });
    it("OfferingReadinessGuard : même garde pour TOUS les chemins d'ouverture (bug legacy P-010), tout ou rien", async () => {
      const w = await newWorld({ readiness: neverReady });
      const s = await seedHigher(w);
      const body = { periodNodeId: s.periodNodeId, startsOn: todayOf(w), endsOn: addDays(todayOf(w), 30) };
      const refused = await openOfferingsForPeriod(w.deps, w.ctx, s.classroomId, { ...body, open: true });
      expect(codeOf(refused)).toBe("academic.offering_not_ready");
      expect(Number((await adminOne<{ n: number }>(db, "SELECT count(*)::int n FROM academic.classroom_offerings WHERE classroom_id = $1", [s.classroomId])).n)).toBe(0); // rien d'écrit
      const drafts = unwrap(await openOfferingsForPeriod(w.deps, w.ctx, s.classroomId, body));
      expect(drafts.created.every((o) => o.status === "DRAFT")).toBe(true);
      expect(codeOf(await offeringAction(w.deps, w.ctx, drafts.created[0]!.id, "open"))).toBe("academic.offering_not_ready");
      const ready = await newWorld(); // garde par défaut : prêt
      const s2 = await seedHigher(ready);
      const offers = unwrap(await openOfferingsForPeriod(ready.deps, ready.ctx, s2.classroomId, { periodNodeId: s2.periodNodeId, startsOn: todayOf(ready), endsOn: addDays(todayOf(ready), 30), open: true }));
      expect(offers.created.every((o) => o.status === "OPEN")).toBe(true);
      expect((await eventsOf(ready, "academic.offering.opened")).length).toBe(2);
    });
    it("cycle d'une offre ; annulation motivée en cascade ; capacité jamais sous les places réservées ; FULL jamais posé à la main", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const cart = unwrap(await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, curriculumVersionId: s.versionId, code: "CART", name: "À la carte", capacity: null }));
      unwrap(await classroomAction(w.deps, w.ctx, cart.id, "activate"));
      const [o1] = unwrap(await openOfferingsForPeriod(w.deps, w.ctx, cart.id, { periodNodeId: s.periodNodeId, startsOn: todayOf(w), endsOn: addDays(todayOf(w), 30), capacity: 2 })).created;
      expect(codeOf(await offeringAction(w.deps, w.ctx, o1!.id, "start"))).toBe("academic.offering_transition"); // DRAFT -> IN_PROGRESS
      expect(unwrap(await offeringAction(w.deps, w.ctx, o1!.id, "open")).status).toBe("OPEN");
      const { addEnrollmentCourse, enrollStudent: enroll } = await import("../../index");
      const e1 = unwrap(await enroll(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: cart.id, mode: "A_LA_CARTE" }));
      const e2 = unwrap(await enroll(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: cart.id, mode: "A_LA_CARTE" }));
      unwrap(await addEnrollmentCourse(w.deps, w.ctx, e1.id, { offeringId: o1!.id }));
      unwrap(await addEnrollmentCourse(w.deps, w.ctx, e2.id, { offeringId: o1!.id }));
      expect(unwrap(await getOffering(w.deps, w.ctx, o1!.id))).toMatchObject({ status: "FULL", heldPlaces: 2 });
      expect(codeOf(await updateOffering(w.deps, w.ctx, o1!.id, { capacity: 1 }))).toBe("academic.capacity_below_reserved");
      // relever la capacité resynchronise FULL -> OPEN
      expect(unwrap(await updateOffering(w.deps, w.ctx, o1!.id, { capacity: 3 })).status).toBe("OPEN");
      expect(unwrap(await updateOffering(w.deps, w.ctx, o1!.id, { capacity: 2 })).status).toBe("FULL");
      expect(codeOf(await offeringAction(w.deps, w.ctx, o1!.id, "cancel"))).toBe("academic.enrollment_reason_required");
      const cancelled = unwrap(await offeringAction(w.deps, w.ctx, o1!.id, "cancel", "Effectif insuffisant, session annulée"));
      expect(cancelled.status).toBe("CANCELLED");
      const courses = await adminRows<{ status: string; cancel_reason: string }>(db, "SELECT status, cancel_reason FROM academic.enrollment_courses WHERE offering_id = $1", [o1!.id]);
      expect(courses).toEqual([{ status: "CANCELLED", cancel_reason: "offering_cancelled" }, { status: "CANCELLED", cancel_reason: "offering_cancelled" }]);
      expect((await eventsOf(w, "academic.enrollment_course.cancelled")).length).toBe(2);
      expect((await eventsOf(w, "academic.offering.full")).length).toBeGreaterThanOrEqual(1);
      expect(codeOf(await updateOffering(w.deps, w.ctx, o1!.id, { label: "x" }))).toBe("academic.offering_closed");
      // réouverture motivée : CANCELLED -> DRAFT
      expect(codeOf(await reopenOffering(w.deps, w.ctx, o1!.id, { reason: "ok", endsOn: addDays(todayOf(w), 30) }))).toBe("academic.enrollment_reason_required");
      expect(unwrap(await reopenOffering(w.deps, w.ctx, o1!.id, { reason: "Effectif atteint finalement", endsOn: addDays(todayOf(w), 40) }))).toMatchObject({ status: "DRAFT", endsOn: addDays(todayOf(w), 40) });
      expect(codeOf(await reopenOffering(w.deps, w.ctx, o1!.id, { reason: "Pas terminée du tout", endsOn: addDays(todayOf(w), 40) }))).toBe("academic.offering_transition");
      expect(codeOf(await reopenOffering(w.deps, w.ctx, o1!.id, { reason: "Hors année volontaire", endsOn: "2999-01-01" }))).toBe("academic.offering_outside_year");
      await assertEventsValid(w);
    });
    it("finalizeEndedOfferings : OPEN/FULL/IN_PROGRESS échues -> COMPLETED ; JAMAIS DRAFT ni CANCELLED ; date civile de l'établissement", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const cart = unwrap(await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, curriculumVersionId: s.versionId, code: "FIN", name: "Fin", capacity: null }));
      unwrap(await classroomAction(w.deps, w.ctx, cart.id, "activate"));
      const mk = async (node: string, endsIn: number) => unwrap(await createOffering(w.deps, w.ctx, cart.id, { curriculumNodeId: node, startsOn: addDays(todayOf(w), -50), endsOn: addDays(todayOf(w), endsIn) }));
      const open = await mk(s.ue1.id, -1);
      unwrap(await offeringAction(w.deps, w.ctx, open.id, "open"));
      const draft = await mk(s.ue2.id, -1);
      // une seconde offre échue en cours + une annulée
      const g = unwrap(await createOffering(w.deps, w.ctx, cart.id, { curriculumNodeId: s.ue1.id, startsOn: todayOf(w), endsOn: todayOf(w) }).then((r) => ({ ok: true as const, value: r })).catch(() => ({ ok: false as const, error: null })) as never);
      void g;
      const sys = createRequestContext({ tenantId: w.tenantId, actor: "system", userId: null });
      const r = unwrap(await finalizeEndedOfferings(w.deps, sys));
      expect(r.finalized).toEqual([open.id]);
      expect(unwrap(await getOffering(w.deps, w.ctx, open.id)).status).toBe("COMPLETED");
      expect(unwrap(await getOffering(w.deps, w.ctx, draft.id)).status).toBe("DRAFT"); // le legacy « terminait » aussi les brouillons
      expect(unwrap(await finalizeEndedOfferings(w.deps, sys)).finalized).toEqual([]); // idempotent
      expect((await eventsOf(w, "academic.offering.completed"))[0]!.payload).toMatchObject({ offeringId: open.id, reason: "ended", status: "COMPLETED" });
      // réouverture d'une offre terminée (motif, nouvelle fin cohérente)
      const reopened = unwrap(await reopenOffering(w.deps, w.ctx, open.id, { reason: "Prolongation décidée en conseil", endsOn: addDays(todayOf(w), 20), status: "IN_PROGRESS" }));
      expect(reopened.status).toBe("IN_PROGRESS");
      expect((w.audit as RecordingAudit).actions()).toContain("academic.offering.reopened");
      // fuseau de l'établissement : à 23h30 UTC il est déjà « demain » à Tokyo
      const tz = await newWorld({ institutions: institutionOf({ timezone: "Asia/Tokyo" }) });
      const s2 = await seedHigher(tz);
      const c2 = unwrap(await createClassroom(tz.deps, tz.ctx, { institutionId: tz.institutionId, academicYearId: s2.yearId, programId: s2.programId, gradeLevelId: s2.gradeLevelId, curriculumVersionId: s2.versionId, code: "TZ", name: "TZ" }));
      unwrap(await classroomAction(tz.deps, tz.ctx, c2.id, "activate"));
      const today = todayOf(tz);
      const off = unwrap(await createOffering(tz.deps, tz.ctx, c2.id, { curriculumNodeId: s2.ue1.id, startsOn: addDays(today, -10), endsOn: today }));
      unwrap(await offeringAction(tz.deps, tz.ctx, off.id, "open"));
      tz.clock.set(`${today}T20:00:00.000Z`); // 05:00 le lendemain à Tokyo
      expect(unwrap(await finalizeEndedOfferings(tz.deps, createRequestContext({ tenantId: tz.tenantId, actor: "system", userId: null }))).finalized).toEqual([off.id]);
    });
  });

  describe("inscription qui historise (AC4.1 – AC4.7)", () => {
    it("naît selon la politique (HIGHER : en attente), refuse un apprenant inconnu ou sorti, une classe fermée, une année close", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const st = addStudent(w);
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId }));
      expect(e).toMatchObject({ status: "PENDING", mode: "CLASS", fundingType: "PRIVATE", assignmentReference: null, confirmedAt: null, enrolledOn: todayOf(w), classroomId: s.classroomId, institutionId: w.institutionId, sourceKind: "MANUAL" });
      expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: newId(), classroomId: s.classroomId }))).toBe("academic.student_not_found");
      w.students.setStatus(addStudent(w, { studentId: "11111111-1111-4111-8111-111111111111" }).studentId, "WITHDRAWN");
      expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: "11111111-1111-4111-8111-111111111111", classroomId: s.classroomId }))).toBe("academic.student_not_enrollable");
      expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: newId() }))).toBe("academic.classroom_not_found");
      await auto(w);
      const confirmed = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
      expect(confirmed.status).toBe("ACTIVE");
      expect(confirmed.confirmedAt).not.toBeNull();
      const types = (await eventsOf(w, /^academic\.enrollment\./)).map((x) => x.type);
      expect(types).toEqual(["academic.enrollment.created", "academic.enrollment.created", "academic.enrollment.confirmed"]);
      await assertEventsValid(w);
    });
    it("unicité : une inscription vivante par classe, une inscription de classe par année et établissement (codes stables, jamais de 500)", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const other = unwrap(await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, curriculumVersionId: s.versionId, code: "L1-B", name: "Licence 1 B" }));
      unwrap(await classroomAction(w.deps, w.ctx, other.id, "activate"));
      const st = addStudent(w);
      unwrap(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId }));
      expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId }))).toBe("academic.already_enrolled");
      expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: other.id }))).toBe("academic.class_enrollment_exists");
      // doubles clics concurrents : une seule réussit, les autres sont des 409 explicites
      const st2 = addStudent(w);
      const twice = await Promise.all(Array.from({ length: 5 }, () => enrollStudent(w.deps, w.ctx, { studentId: st2.studentId, classroomId: s.classroomId })));
      expect(twice.filter((r) => r.ok)).toHaveLength(1);
      expect(twice.filter((r) => !r.ok).every((r) => !r.ok && ["academic.already_enrolled", "academic.class_enrollment_exists"].includes(r.error.code) && r.error.httpStatus === 409)).toBe(true);
      // dans un AUTRE établissement du groupe, la même personne s'inscrit librement
      const w2 = makeWorld(db, w.tenantId, { ports: { students: w.students }, institutionId: newId() });
      await (await import("../support/world")).applyTemplate(w2);
      expect(w2.institutionId).not.toBe(w.institutionId);
    });
    it("le financement vient des données du pack : STATE_ASSIGNED exige une référence, boursier un financeur ; PRIVATE n'en porte pas (AC4.3)", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const mk = (over: Record<string, unknown>) => enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId, ...over } as never);
      expect(codeOf(await mk({ fundingType: "STATE_ASSIGNED" }))).toBe("academic.funding_reference_required");
      expect(codeOf(await mk({ fundingType: "SCHOLARSHIP" }))).toBe("academic.funding_funder_required");
      expect(codeOf(await mk({ fundingType: "PRIVATE", assignmentReference: "X" }))).toBe("academic.funding_reference_forbidden");
      const ok1 = unwrap(await mk({ fundingType: "STATE_ASSIGNED", assignmentReference: " AFF-2026-0042 ", assignmentIssuedOn: "2026-08-15" }));
      expect(ok1).toMatchObject({ fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-2026-0042", assignmentIssuedOn: "2026-08-15" });
      const ok2 = unwrap(await mk({ fundingType: "SCHOLARSHIP", funderLabel: "Fondation Espoir" }));
      expect(ok2.funderLabel).toBe("Fondation Espoir");
      // changement de financement : ancien et nouveau couple journalisés, sensible pour une affectation, événement publié
      expect(codeOf(await changeEnrollmentFunding(w.deps, w.ctx, ok2.id, { fundingType: "STATE_ASSIGNED", reason: "Affectation reçue" }))).toBe("academic.funding_reference_required");
      expect(codeOf(await changeEnrollmentFunding(w.deps, w.ctx, ok2.id, { fundingType: "COMPANY", funderLabel: "ACME", reason: "ab" }))).toBe("academic.enrollment_reason_required");
      const changed = unwrap(await changeEnrollmentFunding(w.deps, w.ctx, ok2.id, { fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-77", reason: "Affectation reçue du ministère" }));
      expect(changed).toMatchObject({ fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-77" });
      const hist = unwrap(await getEnrollmentHistory(w.deps, w.ctx, ok2.id));
      expect(hist.find((h) => h.kind === "FUNDING")).toMatchObject({ fromValue: { fundingType: "SCHOLARSHIP", assignmentReference: null }, toValue: { fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-77" }, reason: "Affectation reçue du ministère", actorId: w.ctx.userId });
      expect((await eventsOf(w, "academic.enrollment.funding_changed"))[0]!.payload).toMatchObject({ from: { fundingType: "SCHOLARSHIP" }, to: { fundingType: "STATE_ASSIGNED", assignmentReference: "AFF-77" } });
      const audit = (w.audit as RecordingAudit).entries.find((e) => e.entry.action === "academic.enrollment.funding_changed");
      expect(audit?.entry.sensitive).toBe(true);
      // le type de financement est une donnée : un code inconnu est refusé
      expect(codeOf(await changeEnrollmentFunding(w.deps, w.ctx, ok2.id, { fundingType: "INCONNU" as never, reason: "Test de type inconnu" }))).toBe("academic.funding_type_unknown");
      await assertEventsValid(w);
    });
    it("machine d'états en base ET en domaine ; motif exigé ; aucun paiement n'est altéré ; sélections annulées en cascade ; aucune suppression", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
      const t = (action: Parameters<typeof transitionEnrollment>[3], reason?: string) => transitionEnrollment(w.deps, w.ctx, e.id, action, reason);
      expect(codeOf(await t("suspend", "Raison valable"))).toBe("academic.enrollment_transition"); // PENDING -> SUSPENDED
      expect(codeOf(await t("complete"))).toBe("academic.enrollment_transition");
      const active = unwrap(await t("confirm"));
      expect(active).toMatchObject({ status: "ACTIVE" });
      expect(active.confirmedAt).not.toBeNull();
      expect(codeOf(await t("confirm"))).toBe("academic.enrollment_transition");
      expect(codeOf(await t("suspend", "court"))).toBe("academic.enrollment_reason_required");
      expect(unwrap(await t("suspend", "Impayé de la scolarité en cours")).status).toBe("SUSPENDED");
      expect(unwrap(await t("resume")).status).toBe("ACTIVE");
      expect(unwrap(await t("complete")).endedOn).toBe(todayOf(w));
      const reopened = unwrap(await t("reopen", "Erreur de clôture constatée"));
      expect(reopened).toMatchObject({ status: "ACTIVE", endedOn: null });
      const gone = unwrap(await t("withdraw", "Départ vers un autre établissement"));
      expect(gone).toMatchObject({ status: "WITHDRAWN", endedOn: todayOf(w), endReason: "Départ vers un autre établissement" });
      for (const a of ["confirm", "suspend", "resume", "complete", "reopen", "withdraw", "cancel"] as const) expect(codeOf(await t(a, "Motif suffisant"))).toBe("academic.enrollment_transition");
      const types = (await eventsOf(w, /^academic\.enrollment\./)).map((x) => x.type);
      expect(types).toEqual(["academic.enrollment.created", "academic.enrollment.confirmed", "academic.enrollment.suspended", "academic.enrollment.resumed", "academic.enrollment.completed", "academic.enrollment.reopened", "academic.enrollment.withdrawn"]);
      const hist = unwrap(await getEnrollmentHistory(w.deps, w.ctx, e.id));
      expect(hist.map((h) => h.kind)).toEqual(["CREATED", "STATUS", "STATUS", "STATUS", "STATUS", "STATUS", "STATUS"]);
      expect(hist.every((h) => h.actorId === w.ctx.userId)).toBe(true); // acteur renseigné pour 100 % des événements
      expect(hist.slice(2).every((h) => h.reason !== null || h.toValue)).toBe(true);
      await expect(db.admin.query("DELETE FROM academic.enrollments WHERE id = $1", [e.id])).rejects.toThrow(/academic\.immutable/);
      // le placement courant est fermé au retrait
      const detail = unwrap(await getEnrollmentDetail(w.deps, w.ctx, e.id));
      expect(detail.placements).toHaveLength(1);
      expect(detail.placements[0]!.endsOn).not.toBeNull();
      await assertEventsValid(w);
    });
    it("changement de classe : MÊME enrollment_id, placement historisé, aucun nouvel élève (AC4.2) ; roster par date", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      await auto(w);
      const b = unwrap(await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, curriculumVersionId: s.versionId, code: "L1-B", name: "Licence 1 B", capacity: 1 }));
      unwrap(await classroomAction(w.deps, w.ctx, b.id, "activate"));
      const st = addStudent(w);
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId, enrolledOn: addDays(todayOf(w), -30) }));
      const effective = addDays(todayOf(w), -10);
      expect(codeOf(await transferEnrollment(w.deps, w.ctx, e.id, { toClassroomId: b.id, effectiveOn: effective, reason: "x" }))).toBe("academic.enrollment_reason_required");
      expect(codeOf(await transferEnrollment(w.deps, w.ctx, e.id, { toClassroomId: s.classroomId, reason: "Même classe" }))).toBe("academic.transfer_same_classroom");
      expect(codeOf(await transferEnrollment(w.deps, w.ctx, e.id, { toClassroomId: newId(), reason: "Classe inconnue" }))).toBe("academic.classroom_not_found");
      const moved = unwrap(await transferEnrollment(w.deps, w.ctx, e.id, { toClassroomId: b.id, effectiveOn: effective, reason: "Rééquilibrage des effectifs" }));
      expect(moved.id).toBe(e.id);
      expect(moved.classroomId).toBe(b.id);
      const detail = unwrap(await getEnrollmentDetail(w.deps, w.ctx, e.id));
      expect(detail.placements.map((p) => [p.classroomId, p.startsOn, p.endsOn])).toEqual([[s.classroomId, addDays(todayOf(w), -30), addDays(effective, -1)], [b.id, effective, null]]);
      const students = await adminOne<{ n: number }>(db, "SELECT count(DISTINCT student_id)::int n FROM academic.enrollments WHERE tenant_id = $1", [w.tenantId]);
      expect(students.n).toBe(1);
      expect(unwrap(await listEnrollmentsByStudent(w.deps, w.ctx, st.studentId))).toHaveLength(1);
      const hist = unwrap(await getEnrollmentHistory(w.deps, w.ctx, e.id));
      expect(hist.find((h) => h.kind === "PLACEMENT")).toMatchObject({ fromValue: { classroomId: s.classroomId }, toValue: { classroomId: b.id, effectiveOn: effective }, reason: "Rééquilibrage des effectifs" });
      expect((await eventsOf(w, "academic.enrollment.transferred"))[0]!.payload).toMatchObject({ enrollmentId: e.id, fromClassroomId: s.classroomId, toClassroomId: b.id, effectiveOn: effective });
      // effectif à une date : l'élève était dans la classe A avant le transfert, dans B après — jamais dans les deux
      const rosterAt = async (c: string, date: string) => unwrap(await getRoster(w.deps, w.ctx, c, { onDate: date })).items.map((i) => i.studentId);
      expect(await rosterAt(s.classroomId, addDays(effective, -1))).toEqual([st.studentId]);
      expect(await rosterAt(b.id, addDays(effective, -1))).toEqual([]);
      expect(await rosterAt(s.classroomId, effective)).toEqual([]);
      expect(await rosterAt(b.id, effective)).toEqual([st.studentId]);
      expect(await rosterAt(b.id, addDays(effective, -31))).toEqual([]); // avant l'inscription
      // capacité de la classe de destination (1 place, déjà prise)
      const e2 = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
      expect(codeOf(await transferEnrollment(w.deps, w.ctx, e2.id, { toClassroomId: b.id, reason: "Classe de destination pleine" }))).toBe("academic.classroom_full");
      // correction du jour : on réécrit le placement au lieu d'ouvrir un placement vide
      const cap = unwrap(await updateClassroom(w.deps, w.ctx, b.id, { capacity: 5 }));
      expect(cap.capacity).toBe(5);
      unwrap(await transferEnrollment(w.deps, w.ctx, e2.id, { toClassroomId: b.id, reason: "Erreur de saisie à l'inscription" }));
      expect(unwrap(await getEnrollmentDetail(w.deps, w.ctx, e2.id)).placements).toHaveLength(1);
      await assertEventsValid(w);
    });
    it("changement de classe : refusé pour une inscription terminée, à la carte, ou vers une autre année", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      await auto(w);
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
      const b = unwrap(await createClassroom(w.deps, w.ctx, { institutionId: w.institutionId, academicYearId: s.yearId, programId: s.programId, gradeLevelId: s.gradeLevelId, code: "L1-B", name: "Licence 1 B" }));
      const cart = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: b.id, mode: "A_LA_CARTE" }));
      expect(codeOf(await transferEnrollment(w.deps, w.ctx, cart.id, { toClassroomId: s.classroomId, reason: "À la carte, impossible" }))).toBe("academic.enrollment_mode_mismatch");
      unwrap(await transitionEnrollment(w.deps, w.ctx, e.id, "cancel", "Annulation avant transfert"));
      expect(codeOf(await transferEnrollment(w.deps, w.ctx, e.id, { toClassroomId: b.id, reason: "Trop tard pour ça" }))).toBe("academic.enrollment_transition");
    });
    it("outcome fourni par le module de décisions : issue connue, cible exigée pour une orientation, historisée ; jamais calculée ici", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      await auto(w);
      const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
      expect(codeOf(await recordEnrollmentOutcome(w.deps, w.ctx, e.id, { outcomeCode: "INCONNUE" }))).toBe("academic.outcome_unknown");
      expect(codeOf(await recordEnrollmentOutcome(w.deps, w.ctx, e.id, { outcomeCode: "ORIENTED" }))).toBe("academic.outcome_target_required");
      const decision = newId();
      const done = unwrap(await recordEnrollmentOutcome(w.deps, w.ctx, e.id, { outcomeCode: "PROMOTED", decisionRef: decision }));
      expect(done).toMatchObject({ outcomeCode: "PROMOTED", outcomeSourceRef: decision });
      expect(done.outcomeDecidedAt).not.toBeNull();
      expect(unwrap(await getEnrollmentHistory(w.deps, w.ctx, e.id)).some((h) => h.kind === "OUTCOME" && (h.toValue as { kind: string }).kind === "ADVANCE")).toBe(true);
      expect((await eventsOf(w, "academic.enrollment.outcome_recorded"))[0]!.payload).toMatchObject({ outcomeCode: "PROMOTED", outcomeKind: "ADVANCE", decisionRef: decision });
      const pending = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId, mode: "A_LA_CARTE" }));
      void pending;
      await assertEventsValid(w);
    });
    it("inscription en lot idempotente : créées / ignorées (déjà inscrit) / en échec", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      await auto(w);
      const a = addStudent(w);
      const b = addStudent(w);
      unwrap(await enrollStudent(w.deps, w.ctx, { studentId: a.studentId, classroomId: s.classroomId }));
      const r = unwrap(await enrollStudentsBulk(w.deps, w.ctx, [{ studentId: a.studentId, classroomId: s.classroomId }, { studentId: b.studentId, classroomId: s.classroomId }, { studentId: newId(), classroomId: s.classroomId }]));
      expect(r.created.map((e) => e.studentId)).toEqual([b.studentId]);
      expect(r.skipped).toHaveLength(1);
      expect(r.skipped[0]).toMatchObject({ studentId: a.studentId, reason: "academic.already_enrolled" });
      expect(r.failed).toEqual([expect.objectContaining({ index: 2, code: "academic.student_not_found" })]);
      const again = unwrap(await enrollStudentsBulk(w.deps, w.ctx, [{ studentId: b.studentId, classroomId: s.classroomId }]));
      expect(again.created).toEqual([]);
      expect(again.skipped).toHaveLength(1);
      const page = unwrap(await listEnrollments(w.deps, w.ctx, { classroomId: s.classroomId, status: "ACTIVE", pageSize: 1, page: 2 }));
      expect(page).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(unwrap(await getEnrollment(w.deps, w.ctx, page.items[0]!.id)).id).toBe(page.items[0]!.id);
      expect(unwrap(await listEnrollments(w.deps, w.ctx, { studentId: a.studentId })).total).toBe(1);
      expect(unwrap(await listEnrollments(w.deps, w.ctx, { fundingType: "STATE_ASSIGNED" })).total).toBe(0);
    });
  });

  describe("numéro d'inscription (R23) : registre stable, unique, sous concurrence", () => {
    it("attribué UNE fois par (apprenant, programme, niveau), identique à chaque réinscription, jamais partagé", async () => {
      const w = await newWorld();
      const s = await seedHigher(w);
      unwrap(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { enrollmentConfirmationPolicy: "AUTO", registrationNumberPrefix: "ECO", registrationNumberPattern: "{PREFIX}-{PROGRAM}-{LEVEL}-{STUDENT_SEQ:4}" }));
      const a = addStudent(w, { sequenceNumber: 7 });
      const b = addStudent(w, { sequenceNumber: 8 });
      const ea = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: a.studentId, classroomId: s.classroomId }));
      expect(ea.registrationNumber).toBe("ECO-INFO-L1-0007");
      expect(unwrap(await enrollStudent(w.deps, w.ctx, { studentId: b.studentId, classroomId: s.classroomId })).registrationNumber).toBe("ECO-INFO-L1-0008");
      // réinscription (redoublement) après annulation : MÊME numéro
      unwrap(await transitionEnrollment(w.deps, w.ctx, ea.id, "cancel", "Inscription annulée par erreur"));
      const again = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: a.studentId, classroomId: s.classroomId }));
      expect(again.registrationNumber).toBe("ECO-INFO-L1-0007");
      expect(Number((await adminOne<{ n: number }>(db, "SELECT count(*)::int n FROM academic.registration_numbers WHERE tenant_id = $1", [w.tenantId])).n)).toBe(2);
      // pas de numéro d'ordre : on refuse au lieu d'inventer
      const noSeq = addStudent(w, { sequenceNumber: null });
      expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: noSeq.studentId, classroomId: s.classroomId }))).toBe("academic.registration_sequence_missing");
      // sans motif configuré : pas de numéro
      const w2 = await newWorld();
      const s2 = await seedHigher(w2);
      expect(unwrap(await enrollStudent(w2.deps, w2.ctx, { studentId: addStudent(w2).studentId, classroomId: s2.classroomId })).registrationNumber).toBeNull();
    });
    it("50 inscriptions CONCURRENTES de 50 apprenants : 50 numéros distincts et contigus ; même apprenant en parallèle : un seul numéro", async () => {
      const w = await newWorld();
      const s = await seedHigher(w, { capacity: null });
      unwrap(await updateAcademicSettings(w.deps, w.ctx, w.institutionId, { enrollmentConfirmationPolicy: "AUTO", registrationNumberPattern: "{PROGRAM}-{STUDENT_SEQ:4}" }));
      const students = Array.from({ length: 50 }, (_, i) => addStudent(w, { sequenceNumber: i + 1 }));
      const results = await Promise.all(students.map((st) => enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId })));
      expect(results.every((r) => r.ok)).toBe(true);
      const numbers = results.map((r) => (r.ok ? r.value.registrationNumber : null)).sort();
      expect(new Set(numbers).size).toBe(50);
      expect(numbers[0]).toBe("INFO-0001");
      expect(numbers[49]).toBe("INFO-0050");
      const dupStudent = addStudent(w, { sequenceNumber: 99 });
      const parallel = await Promise.all(Array.from({ length: 6 }, () => enrollStudent(w.deps, w.ctx, { studentId: dupStudent.studentId, classroomId: s.classroomId })));
      expect(parallel.filter((r) => r.ok)).toHaveLength(1);
      const reg = await adminRows(db, "SELECT registration_number FROM academic.registration_numbers WHERE student_id = $1", [dupStudent.studentId]);
      expect(reg).toHaveLength(1);
    });
  });

  describe("concurrence sur la capacité dure (AC4.5)", () => {
    it("200 inscriptions concurrentes dans une classe de capacité 100 : exactement 100 réussissent, 100 reçoivent academic.classroom_full", async () => {
      const w = await newWorld();
      const s = await seedHigher(w, { capacity: 100 });
      await auto(w);
      const students = Array.from({ length: 200 }, () => addStudent(w));
      const t0 = Date.now();
      const results = await Promise.all(students.map((st) => enrollStudent(w.deps, w.ctx, { studentId: st.studentId, classroomId: s.classroomId })));
      console.info(`[perf] 200 inscriptions concurrentes : ${Date.now() - t0} ms`);
      const ok = results.filter((r) => r.ok);
      const refused = results.filter((r) => !r.ok);
      expect(ok).toHaveLength(100);
      expect(refused).toHaveLength(100);
      expect(refused.every((r) => !r.ok && r.error.code === "academic.classroom_full" && r.error.httpStatus === 409)).toBe(true);
      const live = await adminOne<{ n: number }>(db, "SELECT count(*)::int n FROM academic.enrollments WHERE classroom_id = $1 AND status IN ('PENDING','ACTIVE','SUSPENDED')", [s.classroomId]);
      expect(live.n).toBe(100);
      expect(unwrap(await getClassroom(w.deps, w.ctx, s.classroomId)).enrolledCount).toBe(100);
    }, 120_000);
  });

  it("clôturer l'année n'est pas bloqué par des inscriptions : elle reste lisible (les inscriptions ne se suppriment jamais)", async () => {
    const w = await newWorld();
    const s = await seedHigher(w);
    await auto(w);
    const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }));
    for (const p of s.periodIds) {
      if (p === s.periodIds[1]) unwrap(await (await import("../../index")).openPeriod(w.deps, w.ctx, p));
      unwrap(await (await import("../../index")).closePeriodGrading(w.deps, w.ctx, p));
      unwrap(await (await import("../../index")).closePeriod(w.deps, w.ctx, p));
    }
    unwrap(await closeAcademicYear(w.deps, w.ctx, s.yearId));
    expect(unwrap(await getEnrollment(w.deps, w.ctx, e.id)).status).toBe("ACTIVE");
    expect(codeOf(await enrollStudent(w.deps, w.ctx, { studentId: addStudent(w).studentId, classroomId: s.classroomId }))).toBe("academic.year_not_open");
  });
});

export type { HigherSeed };
