import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { peopleAssignmentDtoSchema, peopleCreateAssignmentResultDtoSchema } from "@ecoledigitale/contracts/src/v2/people";
import {
  createOfferingReadinessGuard,
  createTeachingAssignment,
  endAssignmentsForScope,
  endTeachingAssignment,
  getResponsibleForNode,
  isStaffAssignedToClassroom,
  listAssignmentsForClassroom,
  listAssignmentsForStaff,
  listMyClasses,
  listUnstaffedNodes,
  OfferingNotReadyError,
  replaceTeachingAssignment,
  updateTeachingAssignment,
} from "../../application/teaching";
import { changeStaffStatus } from "../../application/staff";
import { adminRows, createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { FakeAcademic } from "../support/fake-academic";
import { mkStaff } from "../support/scenario";

describeIntegration("affectations d'enseignement (Postgres réel, academic simulé)", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let academic: FakeAcademic;
  let tenant: string;
  let ctx: ReturnType<typeof ctxFor>;
  let year: string;

  beforeAll(async () => {
    db = await createPeopleTestDb();
    academic = new FakeAcademic();
    world = makeWorld(db, { academic });
    tenant = await db.createTenant("ecole-affectations");
    ctx = ctxFor(tenant);
    year = newId();
  });
  afterAll(async () => {
    await db.drop();
  });

  const assign = (staffId: string, classroomId: string, nodeId: string | undefined, over: Record<string, unknown> = {}) =>
    createTeachingAssignment(world.deps, ctx, { staffId, academicYearId: year, classroomId, ...(nodeId ? { curriculumNodeId: nodeId } : {}), roleCode: "LEAD", startsOn: "2025-09-01", ...over } as never);

  it("AC2.1 vérifie classe, année, nœud du curriculum, nœud transversal (conduite) et période", async () => {
    const math = academic.addNode();
    const conduite = academic.addNode({ isTransversal: true, label: "Conduite" });
    const foreign = academic.addNode();
    const classroom = academic.addClassroom(year, [math, conduite]);
    const t = await mkStaff(world.deps, ctx);
    const res = unwrap(await assign(t.id, classroom.id, math.id));
    expect(peopleCreateAssignmentResultDtoSchema.safeParse(res).success).toBe(true);
    expect(peopleAssignmentDtoSchema.safeParse(res.assignment).success).toBe(true);
    const codes = async (p: Promise<{ ok: boolean; error?: { code: string } }>) => ((await p) as { error?: { code: string } }).error?.code;
    expect(await codes(assign(t.id, classroom.id, conduite.id, { roleCode: "CO_TEACHER" }))).toBe("people.node_transversal");
    expect(await codes(assign(t.id, classroom.id, foreign.id, { roleCode: "CO_TEACHER" }))).toBe("people.node_not_in_classroom");
    expect(await codes(assign(t.id, classroom.id, newId(), { roleCode: "CO_TEACHER" }))).toBe("people.node_not_in_classroom");
    expect(await codes(assign(t.id, newId(), math.id))).toBe("people.classroom_not_found");
    const otherYear = academic.addClassroom(newId(), [math]);
    expect(await codes(assign(t.id, otherYear.id, math.id))).toBe("people.assignment_invalid");
    const draft = academic.addClassroom(year, [math], { status: "DRAFT" });
    expect(await codes(assign(t.id, draft.id, math.id))).toBe("people.assignment_invalid");
    // Le titulaire généraliste d'une classe en BROUILLON est accepté (aucun nœud : rien d'instable) — il est même exigé AVANT
    // l'activation d'une classe du primaire ; une matière, elle, reste refusée tant que la classe est en brouillon.
    const homeroomOnDraft = await assign(t.id, draft.id, undefined, { roleCode: "HOMEROOM", coversAllSubjects: true });
    expect(homeroomOnDraft.ok).toBe(true);
    expect(await codes(assign(t.id, draft.id, math.id, { roleCode: "CO_TEACHER" }))).toBe("people.assignment_invalid");
    expect(await codes(assign(t.id, classroom.id, math.id, { roleCode: "CO_TEACHER", periodId: newId() }))).toBe("people.period_outside_year");
    const period = academic.addPeriod(year);
    expect((await assign(t.id, classroom.id, math.id, { roleCode: "CO_TEACHER", periodId: period.id })).ok).toBe(true);
    const otherYearPeriod = academic.addPeriod(newId());
    expect(await codes(assign(t.id, classroom.id, math.id, { roleCode: "SUPERVISOR", periodId: otherYearPeriod.id }))).toBe("people.period_outside_year");
    // forme : HOMEROOM sans nœud, LEAD sans nœud ni généraliste refusé, SUBSTITUTE sans cible refusé
    expect(await codes(assign(t.id, classroom.id, math.id, { roleCode: "HOMEROOM" }))).toBe("people.assignment_invalid");
    expect(await codes(assign(t.id, classroom.id, undefined))).toBe("people.assignment_invalid");
    expect(await codes(assign(t.id, classroom.id, math.id, { roleCode: "SUBSTITUTE" }))).toBe("people.assignment_invalid");
    // academic non câblé : échec fermé
    const noAcademic = makeWorld(db, {});
    const refused = await createTeachingAssignment(noAcademic.deps, ctx, { staffId: t.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: math.id, roleCode: "CO_TEACHER", startsOn: "2025-09-01" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("people.academic_unavailable");
  });

  it("AC2.2 un seul LEAD actif par (classe, nœud, période) avec le nom du premier ; un seul HOMEROOM ; CO_TEACHER libre ; pas de doublon strict", async () => {
    const node = academic.addNode();
    const classroom = academic.addClassroom(year, [node]);
    const a = await mkStaff(world.deps, ctx, {}, { lastName: "Aka", firstName: "Marie" });
    const b = await mkStaff(world.deps, ctx);
    const c = await mkStaff(world.deps, ctx);
    unwrap(await assign(a.id, classroom.id, node.id));
    const second = await assign(b.id, classroom.id, node.id);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("people.assignment_conflict");
      expect(second.error.message).toContain("AKA Marie");
      expect(second.error.details).toMatchObject({ suggestion: "CO_TEACHER" });
    }
    expect((await assign(b.id, classroom.id, node.id, { roleCode: "CO_TEACHER" })).ok).toBe(true);
    expect((await assign(c.id, classroom.id, node.id, { roleCode: "CO_TEACHER" })).ok).toBe(true);
    const dupStrict = await assign(b.id, classroom.id, node.id, { roleCode: "CO_TEACHER" });
    expect(dupStrict.ok).toBe(false);
    // titulaire de classe : unique
    expect((await assign(a.id, classroom.id, undefined, { roleCode: "HOMEROOM" })).ok).toBe(true);
    const h2 = await assign(b.id, classroom.id, undefined, { roleCode: "HOMEROOM" });
    expect(h2.ok).toBe(false);
    // la base le refuse aussi (index uniques partiels)
    await expect(
      db.admin.query(
        `INSERT INTO people.teaching_assignments (id, tenant_id, staff_id, academic_year_id, classroom_id, curriculum_node_id, role_code, starts_on) VALUES ($1,$2,$3,$4,$5,$6,'LEAD','2025-09-01')`,
        [newId(), tenant, c.id, year, classroom.id, node.id],
      ),
    ).rejects.toThrow(/teaching_assignments_one_lead/);
    // deux classes simultanées pour le même enseignant : permis (le conflit d'horaire relève de scheduling)
    const classroom2 = academic.addClassroom(year, [node]);
    expect((await assign(a.id, classroom2.id, node.id)).ok).toBe(true);
  });

  it("AC2.3 getResponsibleForNode : LEAD > généraliste > titulaire ; conduite sans responsable ; suppléant de longue durée", async () => {
    const n1 = academic.addNode();
    const n2 = academic.addNode();
    const conduite = academic.addNode({ isTransversal: true });
    const classroom = academic.addClassroom(year, [n1, n2, conduite]);
    const lead = await mkStaff(world.deps, ctx);
    const generalist = await mkStaff(world.deps, ctx);
    const homeroom = await mkStaff(world.deps, ctx);
    const sub = await mkStaff(world.deps, ctx);
    const get = async (nodeId: string, onDate?: string) => unwrap(await getResponsibleForNode(world.deps, ctx, { classroomId: classroom.id, nodeId, ...(onDate ? { onDate } : {}) }));
    expect(await get(n1.id)).toBeNull();
    unwrap(await assign(homeroom.id, classroom.id, undefined, { roleCode: "HOMEROOM" }));
    expect(await get(n1.id)).toMatchObject({ staffId: homeroom.id, via: "HOMEROOM" });
    const gen = unwrap(await assign(generalist.id, classroom.id, undefined, { coversAllSubjects: true }));
    expect(await get(n2.id)).toMatchObject({ staffId: generalist.id, via: "GENERALIST" });
    const l = unwrap(await assign(lead.id, classroom.id, n1.id));
    expect(await get(n1.id)).toMatchObject({ staffId: lead.id, via: "LEAD" });
    expect(await get(n2.id)).toMatchObject({ staffId: generalist.id });
    expect(await get(conduite.id)).toBeNull(); // la conduite n'a jamais d'enseignant
    // suppléance de longue durée : désigne l'affectation remplacée
    unwrap(await assign(sub.id, classroom.id, n1.id, { roleCode: "SUBSTITUTE", replacesAssignmentId: l.assignment.id, startsOn: "2025-11-01", endsOn: "2026-01-31" }));
    expect(await get(n1.id, "2025-10-15")).toMatchObject({ staffId: lead.id });
    expect(await get(n1.id, "2025-11-15")).toMatchObject({ staffId: sub.id, via: "SUBSTITUTE" });
    expect(await get(n1.id, "2026-02-15")).toMatchObject({ staffId: lead.id });
    // un SUBSTITUTE ne peut cibler qu'une affectation active de la même classe
    const other = academic.addClassroom(year, [n1]);
    const bad = await assign(sub.id, other.id, n1.id, { roleCode: "SUBSTITUTE", replacesAssignmentId: l.assignment.id });
    expect(bad.ok).toBe(false);
    void gen;
  });

  it("AC2.4 replaceTeachingAssignment : atomique, historique REPLACED, événement ; AC2.7 une affectation terminée ne se réactive pas", async () => {
    const node = academic.addNode();
    const classroom = academic.addClassroom(year, [node]);
    const old = await mkStaff(world.deps, ctx);
    const next = await mkStaff(world.deps, ctx);
    const created = unwrap(await assign(old.id, classroom.id, node.id, { plannedHours: 90 }));
    const out = unwrap(await replaceTeachingAssignment(world.deps, ctx, created.assignment.id, { newStaffId: next.id, effectiveOn: "2025-11-01", reason: "Congé maternité" }));
    expect(out.replacedAssignment).toMatchObject({ status: "ENDED", endsOn: "2025-10-31", staffId: old.id });
    expect(out.assignment).toMatchObject({ status: "ACTIVE", staffId: next.id, startsOn: "2025-11-01", roleCode: "LEAD", plannedHours: 90 });
    const history = await adminRows<{ kind: string }>(db, "SELECT kind FROM people.teaching_assignment_history WHERE assignment_id = ANY($1) ORDER BY occurred_at, id", [[created.assignment.id, out.assignment.id]]);
    expect(history.map((h) => h.kind).sort()).toEqual(["CREATED", "CREATED", "REPLACED"]);
    const ev = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'people.teaching_assignment.replaced' AND aggregate_id = $1", [out.assignment.id]);
    expect(ev[0]?.payload).toMatchObject({ oldStaffId: old.id, newStaffId: next.id, effectiveOn: "2025-11-01" });
    expect(JSON.stringify(ev)).not.toContain("Congé");
    // l'ancienne ne se réactive pas, ni ne se remplace deux fois
    const again = await replaceTeachingAssignment(world.deps, ctx, created.assignment.id, { newStaffId: old.id, effectiveOn: "2025-12-01", reason: "x" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("people.assignment_closed");
    await expect(db.admin.query("UPDATE people.teaching_assignments SET status = 'ACTIVE' WHERE id = $1", [created.assignment.id])).rejects.toThrow(/people.assignment_transition/);
    await expect(db.admin.query("UPDATE people.teaching_assignments SET staff_id = $2 WHERE id = $1", [out.assignment.id, old.id])).rejects.toThrow(/people.assignment_identity_immutable/);
    await expect(db.admin.query("DELETE FROM people.teaching_assignments WHERE id = $1", [out.assignment.id])).rejects.toThrow(/people.immutable/);
    // atomicité : un remplaçant invalide ne laisse AUCUNE trace (l'ancienne reste active)
    const keep = unwrap(await assign((await mkStaff(world.deps, ctx)).id, academic.addClassroom(year, [node]).id, node.id));
    const admin = await mkStaff(world.deps, ctx, { categoryCode: "ADMIN" });
    const fail = await replaceTeachingAssignment(world.deps, ctx, keep.assignment.id, { newStaffId: admin.id, effectiveOn: "2025-11-01", reason: "x" });
    expect(fail.ok).toBe(false);
    const still = await adminRows<{ status: string }>(db, "SELECT status FROM people.teaching_assignments WHERE id = $1", [keep.assignment.id]);
    expect(still[0]?.status).toBe("ACTIVE");
    // remplacement le jour même du début : l'ancienne n'a jamais pris effet (CANCELLED)
    const fresh = unwrap(await assign((await mkStaff(world.deps, ctx)).id, academic.addClassroom(year, [node]).id, node.id, { startsOn: "2025-12-01" }));
    const sameDay = unwrap(await replaceTeachingAssignment(world.deps, ctx, fresh.assignment.id, { newStaffId: next.id, effectiveOn: "2025-12-01", reason: "Erreur de saisie" }));
    expect(sameDay.replacedAssignment.status).toBe("CANCELLED");
  });

  it("fin d'affectation, modification, historique et lecture par classe / par enseignant / « mes classes »", async () => {
    const node = academic.addNode();
    const classroom = academic.addClassroom(year, [node], { name: "6e A", code: "6A" });
    academic.educationLevels.set(classroom.id, "SECONDARY_1");
    const period = academic.addPeriod(year);
    const t = await mkStaff(world.deps, ctx);
    const a = unwrap(await assign(t.id, classroom.id, node.id, { plannedHours: 10, startsOn: "2025-09-01" }));
    const upd = unwrap(await updateTeachingAssignment(world.deps, ctx, a.assignment.id, { plannedHours: 12, note: "Révisé" }));
    expect(upd.plannedHours).toBe(12);
    expect(unwrap(await listAssignmentsForClassroom(world.deps, ctx, classroom.id, { onDate: "2025-10-01" })).map((x) => x.id)).toEqual([a.assignment.id]);
    expect(unwrap(await listAssignmentsForStaff(world.deps, ctx, t.id, { yearId: year, onDate: "2025-10-01" })).map((x) => x.id)).toEqual([a.assignment.id]);
    expect(unwrap(await listMyClasses(world.deps, ctx, t.id)).map((x) => x.classroomId)).toEqual([classroom.id]);
    // « mes classes » est nommé (classe et matière) sans exiger `academic.classroom.read` ni `curriculum.read`
    expect(unwrap(await listMyClasses(world.deps, ctx, t.id))[0]).toMatchObject({
      classroomName: "6e A",
      classroomCode: "6A",
      // niveau d'enseignement : de quoi appliquer la politique d'appel du cycle sans `academic.classroom.read`
      educationLevelCode: "SECONDARY_1",
      periods: expect.arrayContaining([expect.objectContaining({ id: period.id, startsOn: "2025-09-01" })]),
      nodes: [{ id: node.id, label: node.label }],
      assignments: [{ nodeLabel: node.label }],
    });
    expect(await isStaffAssignedToClassroom(world.deps, ctx, { staffId: t.id, classroomId: classroom.id })).toBe(true);
    expect(await isStaffAssignedToClassroom(world.deps, ctx, { staffId: t.id, classroomId: classroom.id, nodeId: node.id })).toBe(true);
    expect(await isStaffAssignedToClassroom(world.deps, ctx, { staffId: t.id, classroomId: classroom.id, nodeId: newId() })).toBe(false);
    expect(await isStaffAssignedToClassroom(world.deps, ctx, { staffId: newId(), classroomId: classroom.id })).toBe(false);
    const ended = unwrap(await endTeachingAssignment(world.deps, ctx, a.assignment.id, { endsOn: "2025-12-15", reason: "Fin de mission" }));
    expect(ended).toMatchObject({ status: "ENDED", endsOn: "2025-12-15" });
    // l'enseignant ne voit plus la classe après la fin de l'affectation
    expect(unwrap(await listMyClasses(world.deps, ctx, t.id, "2026-01-10"))).toEqual([]);
    expect(await isStaffAssignedToClassroom(world.deps, ctx, { staffId: t.id, classroomId: classroom.id, onDate: "2026-01-10" })).toBe(false);
    expect((await endTeachingAssignment(world.deps, ctx, a.assignment.id)).ok).toBe(false);
    expect((await updateTeachingAssignment(world.deps, ctx, a.assignment.id, { note: "x" })).ok).toBe(false);
  });

  it("AC2.3b / AC2.5 matières sans responsable et garde d'ouverture d'offre", async () => {
    const t = await db.createTenant("ecole-garde");
    const c = ctxFor(t);
    const y = newId();
    const algebre = academic.addNode({ label: "Algèbre" });
    const analyse = academic.addNode({ label: "Analyse" });
    const conduite = academic.addNode({ label: "Conduite", isTransversal: true });
    const facultative = academic.addNode({ label: "Danse", isMandatory: false });
    const classroom = academic.addClassroom(y, [algebre, analyse, conduite, facultative]);
    const teacher = await mkStaff(world.deps, c);
    academic.offerings.set("off-1", { id: "off-1", classroomId: classroom.id, nodeIds: [algebre.id, analyse.id, conduite.id, facultative.id] });
    const guard = createOfferingReadinessGuard(world.deps);
    const empty = unwrap(await listUnstaffedNodes(world.deps, c, { yearId: y }));
    expect(empty.map((n) => n.label).sort()).toEqual(["Algèbre", "Analyse"]); // ni conduite (transversale), ni matière facultative
    const blocked = await guard.check(c, "off-1");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toBeInstanceOf(OfferingNotReadyError);
      expect((blocked.error as OfferingNotReadyError).missing.map((m) => m.label).sort()).toEqual(["Algèbre", "Analyse"]);
      expect(blocked.error.code).toBe("people.teaching_staff_missing");
    }
    await createTeachingAssignment(world.deps, c, { staffId: teacher.id, academicYearId: y, classroomId: classroom.id, curriculumNodeId: algebre.id, roleCode: "LEAD", startsOn: "2025-09-01" });
    expect(unwrap(await listUnstaffedNodes(world.deps, c, { yearId: y, classroomId: classroom.id })).map((n) => n.label)).toEqual(["Analyse"]);
    // un co-enseignant seul ne suffit pas
    await createTeachingAssignment(world.deps, c, { staffId: teacher.id, academicYearId: y, classroomId: classroom.id, curriculumNodeId: analyse.id, roleCode: "CO_TEACHER", startsOn: "2025-09-01" });
    expect((await guard.check(c, "off-1")).ok).toBe(false);
    // un généraliste couvre tous les nœuds non transversaux
    const generalist = await mkStaff(world.deps, c);
    await createTeachingAssignment(world.deps, c, { staffId: generalist.id, academicYearId: y, classroomId: classroom.id, roleCode: "LEAD", coversAllSubjects: true, startsOn: "2025-09-01" });
    expect((await guard.check(c, "off-1")).ok).toBe(true);
    expect(unwrap(await listUnstaffedNodes(world.deps, c, { yearId: y }))).toEqual([]);
    // sans port academic : échec fermé
    const closed = await createOfferingReadinessGuard(makeWorld(db, {}).deps).check(c, "off-1");
    expect(closed.ok).toBe(false);
  });

  it("événements academic : classe annulée / année clôturée terminent les affectations actives", async () => {
    const node = academic.addNode();
    const y = newId();
    const c1 = academic.addClassroom(y, [node]);
    const c2 = academic.addClassroom(y, [node]);
    const t = await mkStaff(world.deps, ctx);
    const a1 = unwrap(await createTeachingAssignment(world.deps, ctx, { staffId: t.id, academicYearId: y, classroomId: c1.id, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" }));
    const a2 = unwrap(await createTeachingAssignment(world.deps, ctx, { staffId: t.id, academicYearId: y, classroomId: c2.id, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" }));
    const sys = ctxFor(tenant);
    const n1 = await world.deps.db.run(sys, (tx) => endAssignmentsForScope(world.deps, tx, sys, { classroomId: c1.id }, { reason: "CLASSROOM_CANCELLED" }));
    expect(n1).toBe(1);
    const n2 = await world.deps.db.run(sys, (tx) => endAssignmentsForScope(world.deps, tx, sys, { yearId: y }, { reason: "YEAR_CLOSED" }));
    expect(n2).toBe(1);
    const rows = await adminRows<{ id: string; status: string }>(db, "SELECT id, status FROM people.teaching_assignments WHERE id = ANY($1)", [[a1.assignment.id, a2.assignment.id]]);
    expect(rows.every((r) => r.status === "ENDED")).toBe(true);
    expect(await world.deps.db.run(sys, (tx) => endAssignmentsForScope(world.deps, tx, sys, { yearId: y }, { reason: "YEAR_CLOSED" }))).toBe(0); // idempotent
    void changeStaffStatus;
  });
});
