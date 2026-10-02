/**
 * Extensions Phase 4-5 de `people` (Postgres réel) : création INACTIVE / `id` fourni, INACTIVE -> ACTIVE, doublons avec score
 * et raisons, âge à une date de référence, identifiant national facultatif, statuts sanctionnants, titulaire généraliste.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemContext, newId, unwrap } from "@ecoledigitale/kernel";
import { peopleDuplicateCandidateDtoSchema, peopleStudentAgeDtoSchema } from "@ecoledigitale/contracts/src/v2/people";
import {
  changeStudentStatus,
  createStudent,
  findDuplicateStudents,
  getStatusHistory,
  getStudentAgeOn,
  getStudentAgesOn,
  updateStudent,
} from "../../application/students";
import {
  createTeachingAssignment,
  getResponsibleForNode,
  isStaffAssignedToClassroom,
  listAssignmentsForClassroom,
  listUnstaffedNodes,
  replaceTeachingAssignment,
} from "../../application/teaching";
import { adminRows, createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { FakeAcademic } from "../support/fake-academic";
import { mkStaff, mkStudent, person, word } from "../support/scenario";

describeIntegration("extensions people Phase 4-5 (Postgres réel)", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let academic: FakeAcademic;
  let tenant: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createPeopleTestDb();
    academic = new FakeAcademic();
    world = makeWorld(db, { academic });
    tenant = await db.createTenant("ecole-extensions");
    ctx = ctxFor(tenant);
  });
  afterAll(async () => {
    await db.drop();
  });

  const codeOf = (r: { ok: boolean; error?: unknown }): string | undefined => (r.ok ? undefined : (r.error as { code: string }).code);

  describe("createStudent : initialStatus et id fourni (spec 007 §16)", () => {
    it("INACTIVE à la création : historique NULL -> INACTIVE, événement avec initialStatus ; défaut ACTIVE inchangé", async () => {
      const inactive = await mkStudent(world.deps, ctx, { initialStatus: "INACTIVE" });
      expect(inactive.status).toBe("INACTIVE");
      const h = unwrap(await getStatusHistory(world.deps, ctx, inactive.id));
      expect(h).toHaveLength(1);
      expect(h[0]).toMatchObject({ fromStatus: null, toStatus: "INACTIVE" });
      const ev = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE aggregate_id = $1 AND type = 'people.student.created'", [inactive.id]);
      expect(ev[0]?.payload).toMatchObject({ v: 1, studentId: inactive.id, initialStatus: "INACTIVE" });
      const active = await mkStudent(world.deps, ctx, {});
      expect(active.status).toBe("ACTIVE");
      const ev2 = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE aggregate_id = $1 AND type = 'people.student.created'", [active.id]);
      expect(ev2[0]?.payload).not.toHaveProperty("initialStatus");
      const explicitActive = await mkStudent(world.deps, ctx, { initialStatus: "ACTIVE" });
      expect(explicitActive.status).toBe("ACTIVE");
    });

    it("un autre statut à la création est refusé (schéma) ; un élève INACTIVE a un matricule gapless comme les autres", async () => {
      const t = await db.createTenant("ecole-inactive-seq");
      const c = ctxFor(t);
      const a = await mkStudent(world.deps, c, { initialStatus: "INACTIVE" });
      const b = await mkStudent(world.deps, c, {});
      expect([a.sequenceNumber, b.sequenceNumber]).toEqual([1, 2]);
      const { peopleCreateStudentBodySchema } = await import("@ecoledigitale/contracts/src/v2/people");
      expect(peopleCreateStudentBodySchema.safeParse({ person: person(), initialStatus: "EXCLUDED" }).success).toBe(false);
    });

    it("INACTIVE -> ACTIVE sans motif : historique, left_on nul, événement status_changed ; rejouer est refusé", async () => {
      const s = await mkStudent(world.deps, ctx, { initialStatus: "INACTIVE" });
      const out = unwrap(await changeStudentStatus(world.deps, ctx, s.id, { status: "ACTIVE" }));
      expect(out.status).toBe("ACTIVE");
      expect(out.leftOn).toBeNull();
      expect(unwrap(await getStatusHistory(world.deps, ctx, s.id)).map((x) => x.toStatus)).toEqual(["ACTIVE", "INACTIVE"]); // le plus récent d'abord
      const ev = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE aggregate_id = $1 AND type = 'people.student.status_changed'", [s.id]);
      expect(ev).toHaveLength(1);
      expect(ev[0]?.payload).toMatchObject({ fromStatus: "INACTIVE", toStatus: "ACTIVE" });
      expect(codeOf(await changeStudentStatus(world.deps, ctx, s.id, { status: "ACTIVE" }))).toBe("people.invalid_transition");
      // INACTIVE -> SUSPENDED reste interdit (machine d'états inchangée)
      const other = await mkStudent(world.deps, ctx, { initialStatus: "INACTIVE" });
      expect(codeOf(await changeStudentStatus(world.deps, ctx, other.id, { status: "SUSPENDED", reasonText: "x" }))).toBe("people.invalid_transition");
    });

    it("id fourni : le dossier porte cet identifiant ; rejouer renvoie le même dossier sans doublon ni numéro consommé", async () => {
      const t = await db.createTenant("ecole-id-fourni");
      const c = ctxFor(t);
      const id = newId();
      const first = unwrap(await createStudent(world.deps, c, { id, person: person(), initialStatus: "INACTIVE" }));
      expect(first).toMatchObject({ kind: "created", replayed: false, student: { id } });
      const again = unwrap(await createStudent(world.deps, c, { id, person: person() }));
      expect(again).toMatchObject({ kind: "created", replayed: true, student: { id } });
      const next = await mkStudent(world.deps, c, {});
      expect(next.sequenceNumber).toBe(2); // le rejeu n'a pas pris de numéro
      expect(Number((await adminRows<{ n: string }>(db, "SELECT count(*) AS n FROM people.students WHERE tenant_id = $1", [t]))[0]?.n)).toBe(2);
    });

    it("id fourni : 10 créations concurrentes -> un seul dossier ; id déjà pris par un autre tenant -> people.student_id_conflict", async () => {
      const t = await db.createTenant("ecole-id-concurrent");
      const c = ctxFor(t);
      const id = newId();
      const results = await Promise.all(Array.from({ length: 10 }, () => createStudent(world.deps, c, { id, person: person() })));
      expect(results.every((r) => r.ok)).toBe(true);
      expect(results.filter((r) => r.ok && r.value.kind === "created" && !r.value.replayed)).toHaveLength(1);
      expect(Number((await adminRows<{ n: string }>(db, "SELECT count(*) AS n FROM people.students WHERE id = $1", [id]))[0]?.n)).toBe(1);
      const t2 = await db.createTenant("ecole-id-autre");
      const clash = await createStudent(world.deps, ctxFor(t2), { id, person: person() });
      expect(codeOf(clash)).toBe("people.student_id_conflict");
      // la tentative refusée n'a laissé ni personne ni numéro dans le second tenant
      expect(Number((await adminRows<{ n: string }>(db, "SELECT count(*) AS n FROM people.persons WHERE tenant_id = $1", [t2]))[0]?.n)).toBe(0);
    });
  });

  describe("findDuplicateStudents : score et raisons", () => {
    it("renvoie score et raisons (codes) en plus des champs existants ; trié du plus fort au plus faible ; sans donnée personnelle", async () => {
      const t = await db.createTenant("ecole-doublons");
      const c = ctxFor(t);
      const base = person({ lastName: "Diabaté", firstName: "Mariam", birthDate: "2012-05-05" });
      const exact = await mkStudent(world.deps, c, {}, base);
      const ack = { acknowledgeDuplicate: true, duplicateReason: "Homonyme confirmé (test)" };
      await mkStudent(world.deps, c, ack, { ...base, lastName: "Diabaté", firstName: "Mariame" });
      await mkStudent(world.deps, c, ack, { lastName: "Diabaté", firstName: "Mariam", birthDate: undefined });
      const found = unwrap(await findDuplicateStudents(world.deps, c, { lastName: "DIABATE", firstName: "mariam", birthDate: "2012-05-05" }, { student: true, guardian: false, staff: false }));
      expect(found.length).toBeGreaterThanOrEqual(2);
      for (const d of found) expect(peopleDuplicateCandidateDtoSchema.safeParse(d).success).toBe(true);
      expect(found[0]).toMatchObject({ match: "EXACT", score: 100, reasons: ["SAME_NAME", "SAME_BIRTHDATE"], studentId: exact.id });
      expect(found.map((d) => d.score)).toEqual([...found.map((d) => d.score)].sort((a, b) => b - a));
      const near = found.find((d) => d.match === "NEAR");
      expect(near?.reasons).toEqual(["SIMILAR_NAME", "SAME_BIRTHDATE"]);
      expect(near!.score).toBeLessThan(100);
      // les raisons sont des codes : aucune valeur de l'identité n'y figure
      expect(JSON.stringify(found.map((d) => d.reasons))).not.toMatch(/diabat|mariam|2012/i);
    });
  });

  describe("âge à une date de référence", () => {
    it("années révolues à la date FOURNIE (jamais l'horloge) ; naissance inconnue ou postérieure : null avec explication", async () => {
      const born = await mkStudent(world.deps, ctx, {}, { birthDate: "2015-06-15" });
      const age = (d: string) => getStudentAgeOn(world.deps, ctx, born.id, d);
      expect(unwrap(await age("2025-06-14"))).toMatchObject({ ageYears: 9, birthDateKnown: true, bornAfterReference: false, referenceDate: "2025-06-14" });
      expect(unwrap(await age("2025-06-15")).ageYears).toBe(10);
      expect(peopleStudentAgeDtoSchema.safeParse(unwrap(await age("2025-12-31"))).success).toBe(true);
      expect(unwrap(await age("2015-01-01"))).toMatchObject({ ageYears: null, birthDateKnown: true, bornAfterReference: true });
      const unknown = await mkStudent(world.deps, ctx, {}, { birthDate: undefined });
      expect(unwrap(await getStudentAgeOn(world.deps, ctx, unknown.id, "2025-12-31"))).toMatchObject({ ageYears: null, birthDateKnown: false, bornAfterReference: false });
      const leap = await mkStudent(world.deps, ctx, {}, { birthDate: "2016-02-29" });
      expect(unwrap(await getStudentAgeOn(world.deps, ctx, leap.id, "2025-02-28")).ageYears).toBe(8);
      expect(unwrap(await getStudentAgeOn(world.deps, ctx, leap.id, "2025-02-28", { leapBirthday: "FEB_28" })).ageYears).toBe(9);
      // la réponse ne contient pas la date de naissance
      expect(JSON.stringify(unwrap(await age("2025-06-15")))).not.toContain("2015-06-15");
    });

    it("date de référence invalide, élève inconnu, autre tenant, lot : erreurs et résultats explicites", async () => {
      const s = await mkStudent(world.deps, ctx, {}, { birthDate: "2014-09-01" });
      expect(codeOf(await getStudentAgeOn(world.deps, ctx, s.id, "2025-02-30"))).toBe("people.invalid_reference_date");
      expect(codeOf(await getStudentAgeOn(world.deps, ctx, s.id, ""))).toBe("people.invalid_reference_date");
      expect(codeOf(await getStudentAgeOn(world.deps, ctx, newId(), "2025-12-31"))).toBe("people.student_not_found");
      const t = await db.createTenant("ecole-age-autre");
      expect(codeOf(await getStudentAgeOn(world.deps, ctxFor(t), s.id, "2025-12-31"))).toBe("people.student_not_found"); // RLS
      const s2 = await mkStudent(world.deps, ctx, {}, { birthDate: "2010-01-01" });
      const batch = unwrap(await getStudentAgesOn(world.deps, ctx, [s.id, s2.id, s.id, newId()], "2025-12-31"));
      expect(batch.map((a) => [a.studentId, a.ageYears]).sort()).toEqual([[s.id, 11], [s2.id, 15]].sort());
      expect(codeOf(await getStudentAgesOn(world.deps, ctx, [s.id], "31/12/2025"))).toBe("people.invalid_reference_date");
    });
  });

  describe("identifiant national facultatif (spec 018 §16)", () => {
    it("nul par défaut (plusieurs élèves sans identifiant), unique par tenant s'il est renseigné, réutilisable après retrait, sans validation de format", async () => {
      const t = await db.createTenant("ecole-national");
      const c = ctxFor(t);
      const a = await mkStudent(world.deps, c, {});
      const b = await mkStudent(world.deps, c, {});
      const withId = await mkStudent(world.deps, c, { nationalStudentId: "n'importe quoi 12/ab" }); // aucun format officiel imposé
      expect([a.id, b.id, withId.id]).toHaveLength(3);
      const dup = await createStudent(world.deps, c, { person: person(), nationalStudentId: "n'importe quoi 12/ab" });
      expect(codeOf(dup)).toBe("people.national_id_conflict");
      expect(codeOf(await updateStudent(world.deps, c, a.id, { nationalStudentId: "n'importe quoi 12/ab" }))).toBe("people.national_id_conflict");
      unwrap(await updateStudent(world.deps, c, withId.id, { nationalStudentId: null }));
      unwrap(await updateStudent(world.deps, c, a.id, { nationalStudentId: "n'importe quoi 12/ab" }));
      // le même identifiant dans un autre tenant n'entre pas en conflit
      const t2 = await db.createTenant("ecole-national-2");
      expect((await createStudent(world.deps, ctxFor(t2), { person: person(), nationalStudentId: "n'importe quoi 12/ab" })).ok).toBe(true);
      // ni l'audit ni les événements ne portent la valeur
      const ev = await adminRows(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1", [t]);
      expect(JSON.stringify(ev)).not.toContain("quoi 12");
    });
  });

  describe("suspension et exclusion : motif et acteur humain (spec 006 §7.4)", () => {
    it("SUSPENDED : motif obligatoire, acteur identifié obligatoire, historique avec auteur ; levée sans motif", async () => {
      const s = await mkStudent(world.deps, ctx, {});
      expect(codeOf(await changeStudentStatus(world.deps, ctx, s.id, { status: "SUSPENDED" }))).toBe("people.reason_required");
      const system = createSystemContext(tenant);
      expect(codeOf(await changeStudentStatus(world.deps, system, s.id, { status: "SUSPENDED", reasonText: "Mesure disciplinaire" }))).toBe("people.human_actor_required");
      const out = unwrap(await changeStudentStatus(world.deps, ctx, s.id, { status: "SUSPENDED", reasonCode: "SCHOOLLIFE", reasonText: "Mesure disciplinaire" }));
      expect(out.status).toBe("SUSPENDED");
      const h = unwrap(await getStatusHistory(world.deps, ctx, s.id));
      expect(h[0]).toMatchObject({ toStatus: "SUSPENDED", changedBy: ctx.userId });
      const lifted = unwrap(await changeStudentStatus(world.deps, ctx, s.id, { status: "ACTIVE" }));
      expect(lifted.status).toBe("ACTIVE");
      const audit = world.audit.entries.filter((e) => e.action === "people.student.status_changed");
      expect(audit.length).toBeGreaterThanOrEqual(2);
    });

    it("EXCLUDED : motif et acteur humain ; l'événement ne porte pas le texte libre", async () => {
      const s = await mkStudent(world.deps, ctx, {});
      expect(codeOf(await changeStudentStatus(world.deps, ctx, s.id, { status: "EXCLUDED" }))).toBe("people.reason_required");
      expect(codeOf(await changeStudentStatus(world.deps, createSystemContext(tenant), s.id, { status: "EXCLUDED", reasonText: "Exclusion définitive" }))).toBe("people.human_actor_required");
      expect((await getStatusHistory(world.deps, ctx, s.id)).ok && unwrap(await getStatusHistory(world.deps, ctx, s.id))).toHaveLength(1); // rien n'a été écrit
      const out = unwrap(await changeStudentStatus(world.deps, ctx, s.id, { status: "EXCLUDED", reasonCode: "COUNCIL", reasonText: "Exclusion définitive" }));
      expect(out.status).toBe("EXCLUDED");
      const ev = await adminRows(db, "SELECT payload FROM kernel.domain_events WHERE aggregate_id = $1 AND type = 'people.student.status_changed'", [s.id]);
      expect(JSON.stringify(ev)).not.toContain("Exclusion définitive");
    });
  });

  describe("titulaire généraliste : HOMEROOM + covers_all_subjects (spec 005 T-P10)", () => {
    const year = newId();

    it("getResponsibleForNode renvoie le titulaire pour tout nœud non transversal, le spécialiste prime, la conduite n'a personne", async () => {
      const [n1, n2] = [academic.addNode(), academic.addNode()];
      const conduite = academic.addNode({ isTransversal: true });
      const classroom = academic.addClassroom(year, [n1, n2, conduite]);
      const instituteur = await mkStaff(world.deps, ctx);
      const anglais = await mkStaff(world.deps, ctx);
      const create = (staffId: string, nodeId: string | undefined, over: Record<string, unknown>) =>
        createTeachingAssignment(world.deps, ctx, { staffId, academicYearId: year, classroomId: classroom.id, ...(nodeId ? { curriculumNodeId: nodeId } : {}), startsOn: "2025-09-01", ...over } as never);
      const home = unwrap(await create(instituteur.id, undefined, { roleCode: "HOMEROOM", coversAllSubjects: true }));
      const get = async (nodeId: string, onDate?: string) => unwrap(await getResponsibleForNode(world.deps, ctx, { classroomId: classroom.id, nodeId, ...(onDate ? { onDate } : {}) }));
      expect(await get(n1.id)).toMatchObject({ staffId: instituteur.id, via: "HOMEROOM", coversAllSubjects: true });
      expect(await get(n2.id)).toMatchObject({ staffId: instituteur.id, coversAllSubjects: true });
      expect(await get(conduite.id)).toBeNull();
      // le généraliste est habilité sur tout nœud ; un spécialiste prime sur sa matière
      expect(await isStaffAssignedToClassroom(world.deps, ctx, { staffId: instituteur.id, classroomId: classroom.id, nodeId: n2.id, onDate: "2025-10-01" })).toBe(true);
      unwrap(await create(anglais.id, n1.id, { roleCode: "LEAD" }));
      expect(await get(n1.id)).toMatchObject({ staffId: anglais.id, via: "LEAD" });
      expect(await get(n2.id)).toMatchObject({ staffId: instituteur.id });
      // aucune matière obligatoire sans responsable
      const unstaffed = unwrap(await listUnstaffedNodes(world.deps, ctx, { yearId: year, classroomId: classroom.id }));
      expect(unstaffed).toEqual([]);
      // bascule : le remplaçant hérite à la date d'effet, l'ancien titulaire perd ses droits
      const sub = await mkStaff(world.deps, ctx);
      const replaced = unwrap(await replaceTeachingAssignment(world.deps, ctx, home.assignment.id, { newStaffId: sub.id, effectiveOn: "2025-11-03", reason: "Mutation" }));
      expect(replaced.assignment).toMatchObject({ roleCode: "HOMEROOM", coversAllSubjects: true, staffId: sub.id });
      expect(await get(n2.id, "2025-11-03")).toMatchObject({ staffId: sub.id, coversAllSubjects: true });
      expect(await isStaffAssignedToClassroom(world.deps, ctx, { staffId: instituteur.id, classroomId: classroom.id, nodeId: n2.id, onDate: "2025-11-03" })).toBe(false);
      expect(await isStaffAssignedToClassroom(world.deps, ctx, { staffId: sub.id, classroomId: classroom.id, nodeId: n2.id, onDate: "2025-11-03" })).toBe(true);
    });

    it("listAssignmentsForClassroom expose les rôles HOMEROOM, LEAD et SUPERVISOR d'une classe (participants d'un conseil)", async () => {
      const node = academic.addNode();
      const classroom = academic.addClassroom(year, [node]);
      const [h, l, s] = [await mkStaff(world.deps, ctx), await mkStaff(world.deps, ctx), await mkStaff(world.deps, ctx)];
      const create = (staffId: string, over: Record<string, unknown>) =>
        createTeachingAssignment(world.deps, ctx, { staffId, academicYearId: year, classroomId: classroom.id, startsOn: "2025-09-01", ...over } as never);
      unwrap(await create(h.id, { roleCode: "HOMEROOM", coversAllSubjects: true }));
      unwrap(await create(l.id, { roleCode: "LEAD", curriculumNodeId: node.id }));
      unwrap(await create(s.id, { roleCode: "SUPERVISOR", curriculumNodeId: node.id }));
      const list = unwrap(await listAssignmentsForClassroom(world.deps, ctx, classroom.id, { onDate: "2025-10-01" }));
      expect(list.map((a) => a.roleCode).sort()).toEqual(["HOMEROOM", "LEAD", "SUPERVISOR"]);
      expect(list.find((a) => a.roleCode === "HOMEROOM")).toMatchObject({ staffId: h.id, coversAllSubjects: true });
      expect(word()).toBeTruthy();
    });
  });
});
