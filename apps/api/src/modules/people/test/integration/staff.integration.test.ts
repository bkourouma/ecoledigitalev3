import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { peopleAvailabilityDtoSchema, peopleContractDtoSchema, peopleStaffDetailDtoSchema, peopleStaffSummaryDtoSchema } from "@ecoledigitale/contracts/src/v2/people";
import {
  addContract,
  addQualification,
  changeStaffStatus,
  createStaff,
  emitExpiringQualifications,
  endContract,
  getStaff,
  getStaffByIds,
  getTeachingLoad,
  listAvailabilities,
  listContracts,
  listExpiringQualifications,
  listStaff,
  resolveStaffForIdentity,
  setAffiliations,
  setAvailabilities,
  setCompetencies,
  updateQualification,
  updateStaff,
} from "../../application/staff";
import { createGuardian } from "../../application/guardians";
import { createStudent } from "../../application/students";
import { updateSettings, upsertStaffCategory } from "../../application/settings";
import { createTeachingAssignment } from "../../application/teaching";
import { adminRows, createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { FakeAcademic } from "../support/fake-academic";
import { count, giveIdentity, mkGuardian, mkStaff, mkStudent, person, word } from "../support/scenario";

describeIntegration("personnel : fiche, statut, contrats, qualifications, disponibilités (Postgres réel)", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let academic: FakeAcademic;
  let tenant: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createPeopleTestDb();
    academic = new FakeAcademic();
    world = makeWorld(db, { academic });
    tenant = await db.createTenant("ecole-rh");
    ctx = ctxFor(tenant);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("AC1.1 création atomique : numéro P0001, historique, affiliation principale, événement ; AC1.4 jamais de suppression", async () => {
    const inst = newId();
    const s = await mkStaff(world.deps, ctx, { primaryInstitutionId: inst, hiredOn: "2024-09-01", jobTitle: "Professeur de mathématiques" });
    expect(peopleStaffDetailDtoSchema.safeParse(s).success).toBe(true);
    expect(s.staffNumber).toMatch(/^P\d{4}$/);
    expect(s.affiliations).toHaveLength(1);
    expect(s.affiliations[0]).toMatchObject({ institutionId: inst, validFrom: "2024-09-01" });
    const events = await adminRows(db, "SELECT type, payload FROM kernel.domain_events WHERE aggregate_id = $1", [s.id]);
    expect(events.map((e) => e.type)).toEqual(["people.staff.created"]);
    expect(JSON.stringify(events[0]?.payload)).not.toMatch(/email|phone|birth/i);
    await expect(db.admin.query("DELETE FROM people.staff WHERE id = $1", [s.id])).rejects.toThrow(/people.immutable/);
    await expect(db.admin.query("UPDATE people.staff SET staff_number = 'X' WHERE id = $1", [s.id])).rejects.toThrow(/people.staff_identity_immutable/);
    // catégorie inconnue
    const bad = await createStaff(world.deps, ctx, { person: person(), categoryCode: "ASTRONAUT" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("people.category_unknown");
  });

  it("AC1.1 30 créations concurrentes : numéros contigus sans doublon", async () => {
    const t = await db.createTenant("rh-concurrence");
    const c = ctxFor(t);
    const results = await Promise.all(Array.from({ length: 30 }, () => createStaff(world.deps, c, { person: person({ email: `${word()}@example.test` }), categoryCode: "TEACHER" })));
    for (const r of results) expect(r.ok).toBe(true);
    const numbers = (await adminRows<{ staff_number: string }>(db, "SELECT staff_number FROM people.staff WHERE tenant_id = $1 ORDER BY staff_number", [t])).map((r) => r.staff_number);
    expect(numbers).toEqual(Array.from({ length: 30 }, (_, i) => `P${String(i + 1).padStart(4, "0")}`));
  });

  it("AC1.6 doublons : e-mail identique, nom + date de naissance, téléphone — élèves et tuteurs compris, rôles filtrés par permissions", async () => {
    const t = await db.createTenant("rh-doublons");
    const c = ctxFor(t);
    const g = await mkGuardian(world.deps, c, { lastName: "Bamba", firstName: "Awa", birthDate: "1985-03-03", email: "awa@example.test", phone: "+2250101010101" });
    // même e-mail
    const byEmail = await createStaff(world.deps, c, { person: person({ email: "AWA@example.test" }), categoryCode: "TEACHER" });
    expect(byEmail.ok).toBe(false);
    if (!byEmail.ok) {
      const cands = (byEmail.error.details as { candidates: Array<{ match: string; roles: string[]; personId: string }> }).candidates;
      expect(cands[0]).toMatchObject({ match: "EMAIL", personId: g.personId, roles: [] }); // aucune visibilité ⇒ aucun rôle révélé
    }
    // nom permuté + même date de naissance, avec droit de voir les tuteurs
    const byName = await createStaff(world.deps, c, { person: { lastName: "AWA", firstName: "bamba", sex: "F", birthDate: "1985-03-03" }, categoryCode: "TEACHER" }, { visibility: { student: false, guardian: true, staff: true } });
    expect(byName.ok).toBe(false);
    if (!byName.ok) expect((byName.error.details as { candidates: Array<{ roles: string[] }> }).candidates[0]?.roles).toEqual(["GUARDIAN"]);
    // téléphone
    const byPhone = await createStaff(world.deps, c, { person: person({ phone: "+225 01 01 01 01 01" }), categoryCode: "TEACHER" });
    expect(byPhone.ok).toBe(false);
    // réutilisation de la personne : UNE personne, deux rôles (parent ET enseignant)
    const both = unwrap(await createStaff(world.deps, c, { personId: g.personId, categoryCode: "TEACHER" }));
    if (both.kind !== "created") throw new Error("created attendu");
    expect(both.staff.personId).toBe(g.personId);
    expect(await count(db, "SELECT count(*) AS n FROM people.persons WHERE id = $1", [g.personId])).toBe(1);
    expect(await count(db, "SELECT count(*) AS n FROM people.guardians WHERE person_id = $1", [g.personId])).toBe(1);
    // listStaff n'expose pas la qualité de tuteur (cloisonnement)
    const listed = unwrap(await listStaff(world.deps, c, {}));
    expect(JSON.stringify(listed)).not.toMatch(/guardian|tuteur/i);
    // la personne ne peut pas recevoir deux fiches de personnel
    const again = await createStaff(world.deps, c, { personId: g.personId, categoryCode: "TEACHER" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe("people.person_already_staff");
    // l'élève devenu adulte : doublon vu depuis l'inscription d'un personnel
    const stud = await mkStudent(world.deps, c, {}, { lastName: "Kone", firstName: "Ibrahim", birthDate: "2001-01-01" });
    const asStaff = await createStaff(world.deps, c, { person: { lastName: "Kone", firstName: "Ibrahim", sex: "M", birthDate: "2001-01-01" }, categoryCode: "ADMIN" }, { visibility: { student: true, guardian: false, staff: false } });
    expect(asStaff.ok).toBe(false);
    if (!asStaff.ok) expect((asStaff.error.details as { candidates: Array<{ studentId: string }> }).candidates[0]?.studentId).toBe(stud.id);
  });

  it("AC1.3 LEFT : motif, left_on, clôture des affectations actives dans la même transaction ; réembauche conserve le numéro", async () => {
    const t = await db.createTenant("rh-depart");
    const c = ctxFor(t);
    const year = newId();
    const node = academic.addNode();
    const classroom = academic.addClassroom(year, [node]);
    const teacher = await mkStaff(world.deps, c);
    const a = unwrap(await createTeachingAssignment(world.deps, c, { staffId: teacher.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" }));
    const noReason = await changeStaffStatus(world.deps, c, teacher.id, { status: "LEFT" });
    expect(noReason.ok).toBe(false);
    const out = unwrap(await changeStaffStatus(world.deps, c, teacher.id, { status: "LEFT", reasonText: "Démission", effectiveOn: "2025-09-01" }));
    expect(out.status).toBe("LEFT");
    expect(out.leftOn).toBe("2025-09-01");
    const row = (await adminRows<{ status: string }>(db, "SELECT status FROM people.teaching_assignments WHERE id = $1", [a.assignment.id]))[0];
    expect(row?.status).toBe("ENDED");
    const types = (await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE tenant_id = $1 ORDER BY occurred_at, id", [t])).map((r) => r.type);
    expect(types).toEqual(expect.arrayContaining(["people.teaching_assignment.ended", "people.staff.status_changed", "people.staff.deactivated"]));
    // un membre LEFT ne reçoit plus d'affectation
    const refused = await createTeachingAssignment(world.deps, c, { staffId: teacher.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-10-01" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("people.assignment_staff_not_active");
    // LEFT -> SUSPENDED interdit ; réembauche LEFT -> ACTIVE avec motif, même numéro
    const bad = await changeStaffStatus(world.deps, c, teacher.id, { status: "SUSPENDED", reasonText: "x" });
    expect(bad.ok).toBe(false);
    const back = unwrap(await changeStaffStatus(world.deps, c, teacher.id, { status: "ACTIVE", reasonText: "Réembauche" }));
    expect(back.status).toBe("ACTIVE");
    expect(back.leftOn).toBeNull();
    expect(back.staffNumber).toBe(teacher.staffNumber);
    // le congé n'est jamais posé automatiquement : ON_LEAVE est une action explicite
    const leave = unwrap(await changeStaffStatus(world.deps, c, teacher.id, { status: "ON_LEAVE" }));
    expect(leave.status).toBe("ON_LEAVE");
    await expect(db.admin.query("UPDATE people.staff SET status = 'LEFT', left_on = NULL WHERE id = $1", [teacher.id])).rejects.toThrow();
  });

  it("AC3.1 contrats : types en données, pas de chevauchement du même type, sensibles (lecture et écriture auditées), jamais supprimés", async () => {
    const t = await db.createTenant("rh-contrats");
    const c = ctxFor(t);
    const s = await mkStaff(world.deps, c);
    const c1 = unwrap(await addContract(world.deps, c, s.id, { contractTypeCode: "CDD", startsOn: "2025-09-01", endsOn: "2026-06-30", committedHours: 18, committedHoursUnit: "PER_WEEK" }));
    expect(peopleContractDtoSchema.safeParse(c1).success).toBe(true);
    const overlap = await addContract(world.deps, c, s.id, { contractTypeCode: "CDD", startsOn: "2026-01-01", endsOn: "2026-12-31" });
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.error.code).toBe("people.contract_overlap");
    // un contrat d'un autre type peut coexister
    unwrap(await addContract(world.deps, c, s.id, { contractTypeCode: "VACATION", startsOn: "2026-01-01", endsOn: "2026-02-01" }));
    const unknown = await addContract(world.deps, c, s.id, { contractTypeCode: "NOPE", startsOn: "2026-01-01" });
    expect(unknown.ok).toBe(false);
    const ended = unwrap(await endContract(world.deps, c, s.id, c1.id, { endsOn: "2025-12-31" }));
    expect(ended).toMatchObject({ status: "ENDED", endsOn: "2025-12-31" });
    // une fois terminé, le créneau est libre
    unwrap(await addContract(world.deps, c, s.id, { contractTypeCode: "CDD", startsOn: "2026-01-01", endsOn: "2026-06-30" }));
    // lecture auditée
    const reads = world.audit.find("people.staff_contract.read").length;
    const list = unwrap(await listContracts(world.deps, c, s.id));
    expect(list).toHaveLength(3);
    expect(world.audit.find("people.staff_contract.read")).toHaveLength(reads + 1);
    expect(world.audit.find("people.staff_contract.created").every((e) => e.severity === "notice")).toBe(true);
    await expect(db.admin.query("DELETE FROM people.staff_contracts WHERE id = $1", [c1.id])).rejects.toThrow(/people.immutable/);
    // ni tarif ni salaire dans le schéma du module
    const cols = (await adminRows<{ column_name: string }>(db, "SELECT column_name FROM information_schema.columns WHERE table_schema = 'people' AND table_name = 'staff_contracts'")).map((r) => r.column_name);
    expect(cols.filter((n) => /salary|salaire|rate|taux|amount|montant/i.test(n))).toEqual([]);
  });

  it("AC3.2 qualifications qui expirent : une alerte par franchissement de seuil, idempotent, seuil = donnée du tenant", async () => {
    const t = await db.createTenant("rh-qualifs");
    const c = ctxFor(t);
    const s = await mkStaff(world.deps, c);
    const soon = unwrap(await addQualification(world.deps, c, s.id, { kind: "AUTHORIZATION", label: "Habilitation soudure", expiresOn: "2025-10-15" }));
    unwrap(await addQualification(world.deps, c, s.id, { kind: "DIPLOMA", label: "Licence", obtainedOn: "2010-06-01" })); // sans expiration
    unwrap(await addQualification(world.deps, c, s.id, { kind: "CERTIFICATION", label: "Secourisme", expiresOn: "2027-01-01" })); // loin
    const expired = unwrap(await addQualification(world.deps, c, s.id, { kind: "CERTIFICATION", label: "Permis", expiresOn: "2025-08-01" })); // déjà expirée
    const bad = await addQualification(world.deps, c, s.id, { kind: "DIPLOMA", label: "x", obtainedOn: "2020-01-01", expiresOn: "2019-01-01" });
    expect(bad.ok).toBe(false);
    // préavis par défaut du pack : 60 jours (donnée modifiable)
    const listed = unwrap(await listExpiringQualifications(world.deps, c, {}));
    expect(listed.map((x) => x.qualificationId)).toEqual([soon.id]);
    expect(listed[0]?.daysLeft).toBe(44);
    const first = unwrap(await emitExpiringQualifications(world.deps, c));
    expect(first.emitted).toBe(2); // l'imminente ET l'expirée (alerte immédiate)
    expect(unwrap(await emitExpiringQualifications(world.deps, c)).emitted).toBe(0); // idempotent
    const events = await adminRows<{ payload: { qualificationId: string; staffId: string } }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'people.staff_qualification.expiring'", [t]);
    expect(events.map((e) => e.payload.qualificationId).sort()).toEqual([soon.id, expired.id].sort());
    expect(JSON.stringify(events)).not.toMatch(/Habilitation|Permis/); // pas de libellé libre dans l'événement
    // repousser l'expiration autorise une nouvelle alerte
    unwrap(await updateQualification(world.deps, c, s.id, soon.id, { expiresOn: "2025-10-20" }));
    expect(unwrap(await emitExpiringQualifications(world.deps, c)).emitted).toBe(1);
    // sans préavis configuré, aucune durée en dur : aucune alerte
    unwrap(await updateSettings(world.deps, c, { expiryAlertDays: null }));
    unwrap(await addQualification(world.deps, c, s.id, { kind: "OTHER", label: "Autre", expiresOn: "2025-09-05" }));
    expect(unwrap(await emitExpiringQualifications(world.deps, c)).emitted).toBe(0);
    expect(unwrap(await listExpiringQualifications(world.deps, c, {}))).toEqual([]);
    // un membre parti n'est plus alerté
    unwrap(await updateSettings(world.deps, c, { expiryAlertDays: 365 }));
    unwrap(await changeStaffStatus(world.deps, c, s.id, { status: "LEFT", reasonText: "Départ" }));
    expect(unwrap(await emitExpiringQualifications(world.deps, c)).emitted).toBe(0);
  });

  it("AC3.4 disponibilités : UNAVAILABLE par défaut, créneau valide, pas de chevauchement de minuit ; lecture pour scheduling", async () => {
    const t = await db.createTenant("rh-dispos");
    const c = ctxFor(t);
    const a = await mkStaff(world.deps, c);
    const b = await mkStaff(world.deps, c);
    const set = unwrap(
      await setAvailabilities(world.deps, c, a.id, [
        { weekday: 1, startTime: "08:00", endTime: "10:00", kind: "UNAVAILABLE", reason: "Autre école" },
        { weekday: 3, startTime: "14:00", endTime: "18:00", kind: "AVAILABLE", validFrom: "2025-09-01", validTo: "2026-06-30" },
      ]),
    );
    expect(set).toHaveLength(2);
    expect(set.every((x) => peopleAvailabilityDtoSchema.safeParse(x).success)).toBe(true);
    unwrap(await setAvailabilities(world.deps, c, b.id, [{ weekday: 5, startTime: "08:00", endTime: "12:00", kind: "UNAVAILABLE" }]));
    const both = unwrap(await listAvailabilities(world.deps, c, { staffIds: [a.id, b.id] }));
    expect(both.map((x) => x.staffId).sort()).toEqual([a.id, a.id, b.id].sort());
    expect(set[0]?.startTime).toBe("08:00");
    // fenêtre de validité
    expect(unwrap(await listAvailabilities(world.deps, c, { staffIds: [a.id], from: "2026-07-15" })).map((x) => x.weekday)).toEqual([1]);
    await expect(db.admin.query("INSERT INTO people.staff_availabilities (id, tenant_id, staff_id, weekday, start_time, end_time) VALUES ($1,$2,$3,1,'23:00','01:00')", [newId(), t, a.id])).rejects.toThrow();
    // remplacement complet
    expect(unwrap(await setAvailabilities(world.deps, c, a.id, []))).toEqual([]);
  });

  it("compétences : une matière une seule fois ; affectation sans compétence correspondante = avertissement, non bloquant", async () => {
    const t = await db.createTenant("rh-competences");
    const c = ctxFor(t);
    const year = newId();
    const subject = newId();
    const node = academic.addNode({ subjectId: subject });
    const classroom = academic.addClassroom(year, [node]);
    const s = await mkStaff(world.deps, c);
    const dup = await setCompetencies(world.deps, c, s.id, [{ subjectId: subject }, { subjectId: subject }]);
    expect(dup.ok).toBe(false);
    const created = unwrap(await createTeachingAssignment(world.deps, c, { staffId: s.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" }));
    expect(created.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["people.no_matching_competency", "people.no_active_contract"]));
    const s2 = await mkStaff(world.deps, c);
    unwrap(await setCompetencies(world.deps, c, s2.id, [{ subjectId: subject, gradeLevelCodes: ["6EME"] }]));
    unwrap(await addContract(world.deps, c, s2.id, { contractTypeCode: "CDI", startsOn: "2020-01-01" }));
    const ok2 = unwrap(await createTeachingAssignment(world.deps, c, { staffId: s2.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: node.id, roleCode: "CO_TEACHER", startsOn: "2025-09-01" }));
    expect(ok2.warnings).toEqual([]);
  });

  it("AC1.2 catégorie : ADMIN ne reçoit aucune affectation (domaine ET déclencheur) ; can_teach ne se retire pas avec des affectations actives", async () => {
    const t = await db.createTenant("rh-categories");
    const c = ctxFor(t);
    const year = newId();
    const node = academic.addNode();
    const classroom = academic.addClassroom(year, [node]);
    const admin = await mkStaff(world.deps, c, { categoryCode: "ADMIN" });
    const refused = await createTeachingAssignment(world.deps, c, { staffId: admin.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("people.category_forbidden_to_teach");
    // le déclencheur de la base refuse aussi, hors application
    await expect(
      db.admin.query(
        `INSERT INTO people.teaching_assignments (id, tenant_id, staff_id, academic_year_id, classroom_id, curriculum_node_id, role_code, starts_on) VALUES ($1,$2,$3,$4,$5,$6,'LEAD','2025-09-01')`,
        [newId(), t, admin.id, year, classroom.id, node.id],
      ),
    ).rejects.toThrow(/people.assignment_category_forbidden/);
    const teacher = await mkStaff(world.deps, c);
    unwrap(await createTeachingAssignment(world.deps, c, { staffId: teacher.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" }));
    const strip = await upsertStaffCategory(world.deps, c, { code: "TEACHER", label: "Enseignant", canTeach: false });
    expect(strip.ok).toBe(false);
    if (!strip.ok) expect(strip.error.code).toBe("people.reference_in_use");
    const move = await updateStaff(world.deps, c, teacher.id, { categoryCode: "ADMIN" });
    expect(move.ok).toBe(false);
    // une catégorie ajoutée par le tenant (intervenant extérieur) peut enseigner
    unwrap(await upsertStaffCategory(world.deps, c, { code: "EXTERNAL", label: "Intervenant extérieur", canTeach: true }));
    const ext = await mkStaff(world.deps, c, { categoryCode: "EXTERNAL" });
    expect(ext.categoryCode).toBe("EXTERNAL");
  });

  it("affiliations multiples, chevauchement refusé, périmètre de lecture par établissement (R11)", async () => {
    const t = await db.createTenant("rh-affiliations");
    const c = ctxFor(t);
    const college = newId();
    const lycee = newId();
    const s = await mkStaff(world.deps, c);
    const set = unwrap(await setAffiliations(world.deps, c, s.id, [{ institutionId: college, validFrom: "2025-09-01" }, { institutionId: lycee, validFrom: "2025-09-01" }]));
    expect(set.affiliations).toHaveLength(2);
    const overlap = await setAffiliations(world.deps, c, s.id, [{ institutionId: college, validFrom: "2025-09-01", validTo: "2026-06-30" }, { institutionId: college, validFrom: "2026-01-01" }]);
    expect(overlap.ok).toBe(false);
    const other = await mkStaff(world.deps, c);
    unwrap(await setAffiliations(world.deps, c, other.id, [{ institutionId: lycee, validFrom: "2025-09-01" }]));
    const inCollege = unwrap(await listStaff(world.deps, c, { institutionId: college }));
    expect(inCollege.items.map((x) => x.id)).toEqual([s.id]);
    const inLycee = unwrap(await listStaff(world.deps, c, { institutionId: lycee }));
    expect(inLycee.items.map((x) => x.id).sort()).toEqual([s.id, other.id].sort());
    // le contexte porte l'établissement actif : il borne la lecture par défaut
    const scoped = ctxFor(t);
    const withInst = { ...scoped, institutionId: college };
    expect(unwrap(await listStaff(world.deps, withInst, {})).items.map((x) => x.id)).toEqual([s.id]);
  });

  it("annuaire par lots, résolution par identité (jamais déduite d'une ligne), charge prévue et contractuelle", async () => {
    const t = await db.createTenant("rh-annuaire");
    const c = ctxFor(t);
    const year = newId();
    const n1 = academic.addNode();
    const n2 = academic.addNode();
    const classroom = academic.addClassroom(year, [n1, n2]);
    const s = await mkStaff(world.deps, c);
    const identity = await giveIdentity(db, s.personId);
    expect(await resolveStaffForIdentity(world.deps, c, identity)).toBe(s.id);
    expect(await resolveStaffForIdentity(world.deps, c, newId())).toBeNull();
    const brief = unwrap(await getStaffByIds(world.deps, c, [s.id, newId()]));
    expect(brief).toHaveLength(1);
    expect(brief[0]).toMatchObject({ staffId: s.id, categoryCode: "TEACHER", status: "ACTIVE", staffNumber: s.staffNumber });
    const many = await getStaffByIds(world.deps, c, Array.from({ length: 501 }, () => newId()));
    expect(many.ok).toBe(false);
    unwrap(await addContract(world.deps, c, s.id, { contractTypeCode: "CDI", startsOn: "2025-01-01", committedHours: 18, committedHoursUnit: "PER_WEEK" }));
    unwrap(await createTeachingAssignment(world.deps, c, { staffId: s.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: n1.id, roleCode: "LEAD", plannedHours: 120, startsOn: "2025-09-01" }));
    unwrap(await createTeachingAssignment(world.deps, c, { staffId: s.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: n2.id, roleCode: "LEAD", plannedHours: 60.5, startsOn: "2025-09-01" }));
    const load = unwrap(await getTeachingLoad(world.deps, c, s.id, { yearId: year, weeksPerYear: 30 }));
    expect(load).toMatchObject({ plannedHours: 180.5, contractualHoursPerWeek: 18, contractualHoursPerYear: 540, weeksPerYearUsed: 30 });
    expect(load.byClassroom).toEqual([{ classroomId: classroom.id, plannedHours: 180.5 }]);
    const noWeeks = unwrap(await getTeachingLoad(world.deps, c, s.id, { yearId: year }));
    expect(noWeeks.contractualHoursPerYear).toBeNull(); // aucune constante de semaines codée
    const sorted = unwrap(await listStaff(world.deps, c, { sort: "load", academicYearId: year }));
    expect(sorted.items[0]).toMatchObject({ id: s.id, plannedHours: 180.5 });
    expect(peopleStaffSummaryDtoSchema.safeParse(sorted.items[0]).success).toBe(true);
    expect((await getStaff(world.deps, c, newId())).ok).toBe(false);
    const upd = unwrap(await updateStaff(world.deps, c, s.id, { jobTitle: "Directeur des études" }));
    expect(upd.jobTitle).toBe("Directeur des études");
  });

  it("une personne peut aussi être élève : un seul enregistrement persons, trois rôles possibles", async () => {
    const t = await db.createTenant("rh-trois-roles");
    const c = ctxFor(t);
    const g = unwrap(await createGuardian(world.deps, c, { person: person({ sex: "F", birthDate: "1990-02-02" }) })).guardian;
    const st = unwrap(await createStudent(world.deps, c, { personId: g.personId }));
    expect(st.kind).toBe("created");
    const staff = unwrap(await createStaff(world.deps, c, { personId: g.personId, categoryCode: "EDUCATOR" }));
    expect(staff.kind).toBe("created");
    expect(await count(db, "SELECT count(*) AS n FROM people.persons WHERE tenant_id = $1", [t])).toBe(1);
  });
});
