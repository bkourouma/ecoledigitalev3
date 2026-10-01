import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemContext, newId, noopLogger, unwrap, type DomainEvent } from "@ecoledigitale/kernel";
import type { LearnerDirectory } from "../../../finance";
import { getPersonQualities, linkPersonToIdentity, provisionPortalAccount } from "../../application/accounts";
import { createLearnerDirectory, createStudentDirectory } from "../../application/directories";
import { applyEnrollmentEvent, applyMembershipEvent, getMembershipStatus, rebuildEnrollmentProjection } from "../../application/projection";
import { instantiatePeopleReferenceData, listContractTypes, listRelationshipTypes, listStaffCategories, upsertRelationshipType } from "../../application/settings";
import {
  addEmergencyContact,
  addPriorEducation,
  anonymizeStudent,
  changeStudentStatus,
  getStudent,
  getStudentPhotoUrl,
  getStudentSensitive,
  listEmergencyContacts,
  listPriorEducation,
  listStudentEnrollments,
  listStudents,
  removeEmergencyContact,
  removePriorEducation,
  removeStudentPhoto,
  updateEmergencyContact,
  updatePriorEducation,
  updateStudent,
  uploadStudentPhoto,
} from "../../application/students";
import { updateSettings } from "../../application/settings";
import { createGuardian } from "../../application/guardians";
import subscribers from "../../subscribers";
import jobs from "../../jobs";
import { adminRows, createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { FakeAcademic } from "../support/fake-academic";
import { FakeAccounts, FakeStorage, JPEG_BYTES, PNG_BYTES } from "../support/fakes";
import { count, giveEnrollment, mkGuardian, mkStaff, mkStudent, person } from "../support/scenario";

const event = (tenantId: string, type: string, payload: Record<string, unknown>, occurredAt = "2025-09-01T08:00:00.000Z"): DomainEvent => ({ id: newId(), type, version: 1, tenantId, occurredAt, payload });

describeIntegration("projections, comptes de portail, annuaires, abonnés et anonymisation (Postgres réel)", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let accounts: FakeAccounts;
  let storage: FakeStorage;
  let academic: FakeAcademic;
  let tenant: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createPeopleTestDb();
    accounts = new FakeAccounts();
    storage = new FakeStorage();
    academic = new FakeAcademic();
    world = makeWorld(db, { accounts, storage, academic });
    tenant = await db.createTenant("ecole-evenements");
    ctx = ctxFor(tenant);
  });
  afterAll(async () => {
    await db.drop();
  });

  const apply = (e: DomainEvent) => world.deps.db.run(ctx, (tx) => applyEnrollmentEvent(world.deps, tx, e));
  const applyM = (e: DomainEvent) => world.deps.db.run(ctx, (tx) => applyMembershipEvent(tx, e));

  describe("projection des inscriptions (academic.enrollment.*)", () => {
    it("alimente la liste par classe, première inscription, idempotente, insensible à l'ordre", async () => {
      const s = await mkStudent(world.deps, ctx);
      const enrollmentId = newId();
      const classroomId = newId();
      const year = newId();
      const inst = newId();
      const base = { v: 1, enrollmentId, studentId: s.id, academicYearId: year, institutionId: inst, classroomId, classroomName: "6e A", enrolledOn: "2025-09-05", registrationNumber: "IPAM-001" };
      const created = event(tenant, "academic.enrollment.created", base, "2025-09-01T08:00:00.000Z");
      expect(await apply(created)).toBe("applied");
      expect(await apply(created)).toBe("ignored_old"); // rejeu du même événement : aucun second effet
      const pending = unwrap(await listStudents(world.deps, ctx, { classroomId }));
      expect(pending.items.map((i) => i.id)).toEqual([s.id]);
      expect(pending.items[0]?.currentEnrollment).toMatchObject({ status: "PENDING", classroomName: "6e A", registrationNumber: "IPAM-001" });
      // confirmation, puis un événement ANCIEN livré en retard est ignoré
      expect(await apply(event(tenant, "academic.enrollment.confirmed", { v: 1, enrollmentId, studentId: s.id }, "2025-09-03T08:00:00.000Z"))).toBe("applied");
      expect(await apply(event(tenant, "academic.enrollment.withdrawn", { v: 1, enrollmentId, studentId: s.id }, "2025-09-02T08:00:00.000Z"))).toBe("ignored_old");
      const row = (await adminRows<{ status: string }>(db, "SELECT status FROM people.student_enrollment_summaries WHERE enrollment_id = $1", [enrollmentId]))[0];
      expect(row?.status).toBe("ACTIVE");
      // changement de classe : même inscription, aucun nouvel élève (principe PRD §10)
      const newClass = newId();
      expect(await apply(event(tenant, "academic.enrollment.transferred", { v: 1, enrollmentId, studentId: s.id, classroomId: newClass, classroomName: "6e B" }, "2025-10-01T08:00:00.000Z"))).toBe("applied");
      expect(unwrap(await listStudents(world.deps, ctx, { classroomId })).items).toHaveLength(0);
      expect(unwrap(await listStudents(world.deps, ctx, { classroomId: newClass })).items.map((i) => i.id)).toEqual([s.id]);
      expect(await count(db, "SELECT count(*) AS n FROM people.students WHERE id = $1", [s.id])).toBe(1);
      // première inscription conservée (R4), filtres année / établissement / statut
      const detail = unwrap(await getStudent(world.deps, ctx, s.id));
      expect(detail.firstEnrolledOn).toBe("2025-09-05");
      expect(unwrap(await listStudents(world.deps, ctx, { academicYearId: year, institutionId: inst, enrollmentStatus: "ACTIVE" })).items.map((i) => i.id)).toEqual([s.id]);
      expect(unwrap(await listStudents(world.deps, ctx, { enrollmentStatus: "WITHDRAWN" })).items).toHaveLength(0);
      expect(unwrap(await listStudents(world.deps, ctx, { q: "IPAM-001" })).items.map((i) => i.id)).toEqual([s.id]); // recherche par numéro d'inscription
      expect(unwrap(await listStudentEnrollments(world.deps, ctx, s.id))).toHaveLength(1);
      // élève sorti : l'inscription n'est plus « courante »
      expect(await apply(event(tenant, "academic.enrollment.withdrawn", { v: 1, enrollmentId, studentId: s.id }, "2025-11-01T08:00:00.000Z"))).toBe("applied");
      expect(unwrap(await getStudent(world.deps, ctx, s.id)).currentEnrollment).toBeNull();
    });

    it("ignore sans échouer un élève inconnu, un payload inexploitable ou un verbe inconnu", async () => {
      expect(await apply(event(tenant, "academic.enrollment.created", { v: 1, enrollmentId: newId(), studentId: newId(), academicYearId: newId(), institutionId: newId(), classroomId: newId() }))).toBe("ignored_unknown_student");
      expect(await apply(event(tenant, "academic.enrollment.created", { v: 1, enrollmentId: "pas-un-uuid" }))).toBe("ignored_unusable");
      expect(await apply(event(tenant, "academic.enrollment.payment_orphan", { v: 1 }))).toBe("ignored_unusable");
    });

    it("rebuildEnrollmentProjection reconstruit la projection à l'identique depuis academic", async () => {
      const t = await db.createTenant("ecole-rebuild");
      const c = ctxFor(t);
      const s1 = await mkStudent(world.deps, c);
      const s2 = await mkStudent(world.deps, c);
      const year = newId();
      const inst = newId();
      const mk = (studentId: string, classroomName: string, status: string) => ({ enrollmentId: newId(), studentId, academicYearId: year, institutionId: inst, classroomId: newId(), classroomName, status, enrolledOn: "2025-09-02", mode: "CLASS", fundingType: "PRIVATE", registrationNumber: null });
      academic.enrollmentsByStudent.set(s1.id, [mk(s1.id, "5e A", "ACTIVE")]);
      academic.enrollmentsByStudent.set(s2.id, [mk(s2.id, "4e B", "ACTIVE"), { ...mk(s2.id, "5e B", "COMPLETED"), academicYearId: newId() }]);
      const first = unwrap(await rebuildEnrollmentProjection(world.deps, c));
      expect(first).toMatchObject({ students: 2, enrollments: 3, identical: false }); // projection vide au départ
      const again = unwrap(await rebuildEnrollmentProjection(world.deps, c));
      expect(again).toMatchObject({ enrollments: 3, identical: true });
      // limitée à une année
      const onlyYear = unwrap(await rebuildEnrollmentProjection(world.deps, c, { yearId: year }));
      expect(onlyYear.identical).toBe(true);
      const sans = await rebuildEnrollmentProjection(makeWorld(db, {}).deps, c);
      expect(sans.ok).toBe(false);
    });
  });

  describe("liaison identité IAM <-> personne", () => {
    it("la projection des accès suit iam.membership.created|changed, insensible à l'ordre", async () => {
      const identity = newId();
      const created = event(tenant, "iam.membership.created", { v: 1, identityId: identity, membershipId: newId(), roles: ["parent"], status: "active" }, "2025-09-01T08:00:00.000Z");
      expect(await applyM(created)).toBe("applied");
      expect(await getMembershipStatus(world.deps, ctx, identity)).toBe("active");
      const suspend = event(tenant, "iam.membership.changed", { v: 1, identityId: identity, membershipId: newId(), before: { status: "active", roles: ["parent"] }, after: { status: "suspended", roles: ["parent"] } }, "2025-09-02T08:00:00.000Z");
      expect(await applyM(suspend)).toBe("applied");
      expect(await getMembershipStatus(world.deps, ctx, identity)).toBe("suspended");
      // un événement plus ancien livré après est ignoré
      expect(await applyM(event(tenant, "iam.membership.changed", { v: 1, identityId: identity, after: { status: "active", roles: ["parent"] } }, "2025-09-01T12:00:00.000Z"))).toBe("ignored_old");
      expect(await getMembershipStatus(world.deps, ctx, identity)).toBe("suspended");
      expect(await applyM(event(tenant, "iam.membership.created", { v: 1 }))).toBe("ignored_unusable");
    });

    it("linkPersonToIdentity : refuse une identité sans accès dans le tenant, accepte celle de la projection, une seule personne par identité", async () => {
      const g = await mkGuardian(world.deps, ctx);
      const unknown = await linkPersonToIdentity(world.deps, ctx, g.personId, newId());
      expect(unknown.ok).toBe(false);
      if (!unknown.ok) expect(unknown.error.code).toBe("people.identity_unknown");
      const identity = newId();
      await applyM(event(tenant, "iam.membership.created", { v: 1, identityId: identity, membershipId: newId(), roles: ["parent"], status: "active" }));
      const linked = unwrap(await linkPersonToIdentity(world.deps, ctx, g.personId, identity));
      expect(linked.status).toBe("active");
      expect(world.audit.find("people.person.identity_linked").at(-1)?.severity).toBe("notice");
      const gAfter = unwrap(await (await import("../../application/guardians")).getGuardian(world.deps, ctx, g.id));
      expect(gAfter.portalAccount).toBe("active");
      // la personne a déjà une identité ; l'identité est déjà prise par une autre personne
      expect((await linkPersonToIdentity(world.deps, ctx, g.personId, identity)).ok).toBe(false);
      const g2 = await mkGuardian(world.deps, ctx);
      const taken = await linkPersonToIdentity(world.deps, ctx, g2.personId, identity);
      expect(taken.ok).toBe(false);
      if (!taken.ok) expect(taken.error.code).toBe("people.identity_already_linked");
      const events = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'people.person.identity_linked' AND payload->>'personId' = $1", [g.personId]);
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events[0]?.payload)).not.toMatch(/email|@/);
    });

    it("provisionPortalAccount : invitation SANS mot de passe, port non câblé = 501, e-mail requis, conflit d'accès existant", async () => {
      const g = await mkGuardian(world.deps, ctx, { email: "parent.invite@example.test" });
      const out = unwrap(await provisionPortalAccount(world.deps, ctx, { personId: g.personId }));
      expect(out).toMatchObject({ invited: true, role: "parent", status: "active" });
      expect(JSON.stringify(out)).not.toMatch(/password|motdepasse|token|secret/i);
      expect(accounts.invites.at(-1)).toMatchObject({ email: "parent.invite@example.test", roles: ["parent"] });
      expect((await adminRows<{ identity_id: string }>(db, "SELECT identity_id FROM people.persons WHERE id = $1", [g.personId]))[0]?.identity_id).toBe(out.identityId);
      expect(world.audit.find("people.person.account_invited").at(-1)?.metadata).not.toHaveProperty("email");
      // relancer ne recrée pas de compte : rôle accordé à l'identité existante
      const again = unwrap(await provisionPortalAccount(world.deps, ctx, { personId: g.personId, role: "parent" }));
      expect(again).toMatchObject({ invited: false, identityId: out.identityId });
      expect(accounts.invites.filter((i) => i.identityId === out.identityId)).toHaveLength(1);
      // sans e-mail
      const noMail = await mkGuardian(world.deps, ctx, { email: undefined as never });
      await db.admin.query("UPDATE people.persons SET email = NULL WHERE id = $1", [noMail.personId]);
      const r1 = await provisionPortalAccount(world.deps, ctx, { personId: noMail.personId });
      expect(r1.ok).toBe(false);
      if (!r1.ok) expect(r1.error.code).toBe("people.account_email_required");
      // accès déjà existant pour cet e-mail
      accounts.existing.add("deja@example.test");
      const clash = await mkGuardian(world.deps, ctx, { email: "deja@example.test" });
      const r2 = await provisionPortalAccount(world.deps, ctx, { personId: clash.personId });
      expect(r2.ok).toBe(false);
      if (!r2.ok) expect(r2.error.code).toBe("people.account_exists");
      // port iam non câblé
      const none = await provisionPortalAccount(makeWorld(db, {}).deps, ctx, { personId: g.personId });
      expect(none.ok).toBe(false);
      if (!none.ok) {
        expect(none.error.code).toBe("people.account_provisioning_unavailable");
        expect(none.error.httpStatus).toBe(501);
      }
    });

    it("une personne parent ET enseignant : UNE identité, deux rôles système (aucun second compte)", async () => {
      const g = await mkGuardian(world.deps, ctx, { email: "double@example.test" });
      const staff = unwrap(await (await import("../../application/staff")).createStaff(world.deps, ctx, { personId: g.personId, categoryCode: "TEACHER" }));
      if (staff.kind !== "created") throw new Error("created attendu");
      expect(unwrap(await getPersonQualities(world.deps, ctx, g.personId)).sort()).toEqual(["GUARDIAN", "STAFF"]);
      // qualité ambiguë sans précision : le rôle est exigé
      const ambiguous = await provisionPortalAccount(world.deps, ctx, { personId: g.personId });
      expect(ambiguous.ok).toBe(false);
      const parent = unwrap(await provisionPortalAccount(world.deps, ctx, { personId: g.personId, quality: "GUARDIAN" }));
      const teacher = unwrap(await provisionPortalAccount(world.deps, ctx, { personId: g.personId, quality: "STAFF" }));
      expect(teacher.identityId).toBe(parent.identityId);
      expect(teacher).toMatchObject({ invited: false, role: "enseignant" });
      expect(accounts.grants.at(-1)).toEqual({ identityId: parent.identityId, role: "enseignant" });
      expect(accounts.invites.filter((i) => i.email === "double@example.test")).toHaveLength(1);
      expect(staff.staff.personId).toBe(g.personId);
    });
  });

  describe("annuaires pour les autres modules", () => {
    it("LearnerDirectory (finance) et StudentDirectory (academic) : conformes à leurs ports, sans donnée sensible", async () => {
      const s = await mkStudent(world.deps, ctx, { nationalStudentId: "SECRET-NAT" }, { lastName: "Yao", firstName: "Koffi" });
      const learners: LearnerDirectory = createLearnerDirectory(world.deps); // vérifié à la compilation contre le port de finance
      const ref = await learners.getLearner(ctx, s.id);
      expect(ref).toEqual({ learnerId: s.id, displayName: "YAO Koffi", registrationNumber: s.studentNumber });
      expect(await learners.getLearner(ctx, newId())).toBeNull();
      expect(await learners.getLearner(ctxFor(await db.createTenant()), s.id)).toBeNull();
      const students = createStudentDirectory(world.deps);
      expect(await students.getStudent(ctx, s.id)).toEqual({ studentId: s.id, status: "ACTIVE", displayName: "YAO Koffi", studentNumber: s.studentNumber, sequenceNumber: s.sequenceNumber });
      expect(JSON.stringify(ref) + JSON.stringify(await students.getStudent(ctx, s.id))).not.toContain("SECRET-NAT");
    });
  });

  describe("référentiels par défaut et paramètres", () => {
    it("instanciation idempotente à tenancy.tenant.provisioned, sans écraser une ligne personnalisée", async () => {
      const t = await db.createTenant("ecole-ref");
      const c = createSystemContext(t);
      expect(unwrap(await instantiatePeopleReferenceData(world.deps, c)).created).toBe(true);
      expect(unwrap(await instantiatePeopleReferenceData(world.deps, c)).created).toBe(false);
      const rel = unwrap(await listRelationshipTypes(world.deps, c));
      expect(rel.map((r) => r.code)).toEqual(expect.arrayContaining(["FATHER", "MOTHER", "LEGAL_GUARDIAN", "EMERGENCY_CONTACT"]));
      expect(unwrap(await listStaffCategories(world.deps, c)).find((x) => x.code === "TEACHER")).toMatchObject({ canTeach: true });
      expect(unwrap(await listStaffCategories(world.deps, c)).find((x) => x.code === "ADMIN")).toMatchObject({ canTeach: false });
      expect(unwrap(await listContractTypes(world.deps, c)).map((x) => x.code)).toEqual(expect.arrayContaining(["CDI", "CDD", "VACATION"]));
      unwrap(await upsertRelationshipType(world.deps, ctxFor(t), { code: "FATHER", label: "Papa", kind: "GUARDIAN" }));
      await instantiatePeopleReferenceData(world.deps, c);
      expect(unwrap(await listRelationshipTypes(world.deps, c)).find((r) => r.code === "FATHER")?.label).toBe("Papa");
    });

    it("le motif de matricule est une donnée du tenant ; un type de lien utilisé ne change pas de nature", async () => {
      const t = await db.createTenant("ecole-motif");
      const c = ctxFor(t);
      unwrap(await updateSettings(world.deps, c, { studentNumberPattern: "{PREFIX}-{YYYY}-{SEQ:4}", numberPrefix: "LPR" }));
      const s = await mkStudent(world.deps, c);
      expect(s.studentNumber).toBe("LPR-2025-0001");
      const bad = await updateSettings(world.deps, c, { studentNumberPattern: "SANS-COMPTEUR" });
      expect(bad.ok).toBe(false);
      // changer le motif ne renumérote JAMAIS un matricule existant
      unwrap(await updateSettings(world.deps, c, { studentNumberPattern: "E{SEQ:3}" }));
      const s2 = await mkStudent(world.deps, c);
      expect(s2.studentNumber).toBe("E002");
      expect(unwrap(await getStudent(world.deps, c, s.id)).studentNumber).toBe("LPR-2025-0001");
      // {PREFIX} sans préfixe : erreur nette (jamais de chaîne vide silencieuse)
      unwrap(await updateSettings(world.deps, c, { studentNumberPattern: "{PREFIX}{SEQ:3}", numberPrefix: null }));
      await expect(mkStudent(world.deps, c)).rejects.toThrow();
      expect(await count(db, "SELECT count(*) AS n FROM people.students WHERE tenant_id = $1", [t])).toBe(2);
      // type de lien utilisé par un lien vivant : sa nature est figée
      const g = unwrap(await createGuardian(world.deps, c, { person: person({ sex: "M" }) })).guardian;
      await (await import("../../application/guardians")).linkGuardian(world.deps, c, s.id, { guardianId: g.id, relationshipCode: "FATHER" });
      const change = await upsertRelationshipType(world.deps, c, { code: "FATHER", label: "Père", kind: "OTHER" });
      expect(change.ok).toBe(false);
    });
  });

  describe("photo, contacts d'urgence, antécédents scolaires", () => {
    it("photo : stockage objet par tenant et élève, octets magiques, taille configurable, URL signée courte", async () => {
      const s = await mkStudent(world.deps, ctx);
      const ok1 = unwrap(await uploadStudentPhoto(world.deps, ctx, s.id, JPEG_BYTES));
      expect(ok1.hasPhoto).toBe(true);
      expect([...storage.objects.keys()]).toContain(`tenants/${tenant}/people/students/${s.id}/photo`);
      expect(storage.objects.get(`tenants/${tenant}/people/students/${s.id}/photo`)?.contentType).toBe("image/jpeg");
      unwrap(await uploadStudentPhoto(world.deps, ctx, s.id, PNG_BYTES)); // remplace
      const url = unwrap(await getStudentPhotoUrl(world.deps, ctx, s.id));
      expect(url?.url).toContain("ttl=120");
      expect(url?.url).not.toMatch(/^file:|[A-Z]:\\|\/var\//); // jamais un chemin disque
      expect(unwrap(await getStudent(world.deps, ctx, s.id)).hasPhoto).toBe(true);
      const svg = await uploadStudentPhoto(world.deps, ctx, s.id, new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"));
      expect(svg.ok).toBe(false);
      if (!svg.ok) expect(svg.error.code).toBe("people.invalid_image");
      const pdf = await uploadStudentPhoto(world.deps, ctx, s.id, new TextEncoder().encode("%PDF-1.7 ..."));
      expect(pdf.ok).toBe(false);
      const huge = await uploadStudentPhoto(world.deps, ctx, s.id, Uint8Array.from([0xff, 0xd8, 0xff, ...new Array(2 * 1024 * 1024).fill(0)]));
      expect(huge.ok).toBe(false);
      expect((await uploadStudentPhoto(world.deps, ctx, s.id, new Uint8Array(0))).ok).toBe(false);
      const none = await uploadStudentPhoto(makeWorld(db, {}).deps, ctx, s.id, JPEG_BYTES);
      expect(none.ok).toBe(false);
      if (!none.ok) expect(none.error.code).toBe("people.storage_unavailable");
      unwrap(await removeStudentPhoto(world.deps, ctx, s.id));
      expect(storage.objects.size).toBe(0);
      expect(unwrap(await getStudentPhotoUrl(world.deps, ctx, s.id))).toBeNull();
    });

    it("contacts d'urgence (rattachés à l'élève, téléphone normalisé) et antécédents (référence = donnée sensible)", async () => {
      const s = await mkStudent(world.deps, ctx);
      const c1 = unwrap(await addEmergencyContact(world.deps, ctx, s.id, { contactName: "Oncle Paul", phone: "+225 07 07 07 07 07", relationshipLabel: "Oncle", email: "paul@example.test" }));
      expect(c1.phone).toBe("+2250707070707");
      const upd = unwrap(await updateEmergencyContact(world.deps, ctx, s.id, c1.id, { priority: 1, phoneAlt: "+2250505050505" }));
      expect(upd).toMatchObject({ priority: 1, phoneAlt: "+2250505050505" });
      expect(unwrap(await listEmergencyContacts(world.deps, ctx, s.id))).toHaveLength(1);
      expect((await updateEmergencyContact(world.deps, ctx, s.id, c1.id, { phone: "abc" })).ok).toBe(false);
      unwrap(await removeEmergencyContact(world.deps, ctx, s.id, c1.id));
      expect((await removeEmergencyContact(world.deps, ctx, s.id, c1.id)).ok).toBe(false);
      const p = unwrap(await addPriorEducation(world.deps, ctx, s.id, { kind: "DIPLOMA", label: "CEPE", referenceNumber: "CEPE-2020-77", obtainedOn: "2020-07-01" }, { withSensitive: true }));
      expect(p.referenceNumber).toBe("CEPE-2020-77");
      expect(unwrap(await listPriorEducation(world.deps, ctx, s.id, { withSensitive: false }))[0]?.referenceNumber).toBeNull();
      expect(unwrap(await listPriorEducation(world.deps, ctx, s.id, { withSensitive: true }))[0]?.referenceNumber).toBe("CEPE-2020-77");
      const patched = unwrap(await updatePriorEducation(world.deps, ctx, s.id, p.id, { kind: undefined, label: "CEPE (session 2)", institutionName: undefined, schoolYear: undefined, levelLabel: undefined, seriesLabel: undefined, obtainedOn: undefined, referenceNumber: undefined, note: undefined }, { withSensitive: false }));
      expect(patched.label).toBe("CEPE (session 2)");
      unwrap(await removePriorEducation(world.deps, ctx, s.id, p.id));
      // les contacts d'urgence sont supprimables (DELETE accordé) ; l'élève, jamais
      expect(await count(db, "SELECT count(*) AS n FROM people.student_emergency_contacts WHERE student_id = $1", [s.id])).toBe(0);
    });
  });

  describe("AC3.6 anonymisation (droit à l'effacement)", () => {
    it("exige un dossier ARCHIVED, la durée de conservation du TENANT (jamais une durée codée) et un délai écoulé ; irréversible", async () => {
      const t = await db.createTenant("ecole-oubli");
      const c = ctxFor(t);
      const s = await mkStudent(world.deps, c, { nationalStudentId: "NAT-OUBLI", birthCertificateNumber: "ACTE-9", civilRegistryOffice: "Mairie", attributes: { filiation: "x" } }, { lastName: "Gbagbo", firstName: "Awa", email: "awa@example.test", phone: "+2250101010101", addressLine: "Rue 1", birthPlace: "Yamoussoukro" });
      unwrap(await uploadStudentPhoto(world.deps, c, s.id, JPEG_BYTES));
      unwrap(await addEmergencyContact(world.deps, c, s.id, { contactName: "Tante", phone: "0102030405" }));
      unwrap(await addPriorEducation(world.deps, c, s.id, { kind: "DIPLOMA", label: "BEPC", referenceNumber: "BEPC-1", note: "Mention bien" }, { withSensitive: true }));
      const guardian = await mkGuardian(world.deps, c);
      await (await import("../support/scenario")).link(world.deps, c, s.id, guardian.id, { isPrimaryContact: true });

      const notArchived = await anonymizeStudent(world.deps, c, s.id, { reason: "Demande de la famille" });
      expect(notArchived.ok).toBe(false);
      if (!notArchived.ok) expect(notArchived.error.code).toBe("people.not_archived");

      unwrap(await changeStudentStatus(world.deps, c, s.id, { status: "WITHDRAWN", reasonText: "Départ" }));
      unwrap(await changeStudentStatus(world.deps, c, s.id, { status: "ARCHIVED" }));
      const notConfigured = await anonymizeStudent(world.deps, c, s.id, { reason: "Demande de la famille" });
      expect(notConfigured.ok).toBe(false);
      if (!notConfigured.ok) expect(notConfigured.error.code).toBe("people.retention_not_configured");

      unwrap(await updateSettings(world.deps, c, { studentRetentionDays: 30 }));
      const early = await anonymizeStudent(world.deps, c, s.id, { reason: "Demande de la famille" });
      expect(early.ok).toBe(false);
      if (!early.ok) {
        expect(early.error.code).toBe("people.retention_not_elapsed");
        expect(early.error.details).toMatchObject({ eligibleOn: "2025-10-01" });
      }

      world.clock.set("2025-10-02T08:00:00.000Z");
      const done = unwrap(await anonymizeStudent(world.deps, c, s.id, { reason: "Demande de la famille" }));
      expect(done.studentId).toBe(s.id);
      expect(world.audit.find("people.student.anonymized").at(-1)).toMatchObject({ severity: "critical", reason: "Demande de la famille" });
      expect((await anonymizeStudent(world.deps, c, s.id, { reason: "x" })).ok).toBe(false); // déjà fait
      // plus aucune donnée personnelle ; matricule et faits conservés
      const person = (await adminRows<Record<string, unknown>>(db, "SELECT * FROM people.persons WHERE id = $1", [s.personId]))[0] as Record<string, unknown>;
      for (const col of ["other_names", "sex", "birth_date", "birth_place", "email", "phone", "phone_alt", "address_line", "city", "residence", "photo_object_key", "identity_id", "external_ref"]) expect(person[col], col).toBeNull();
      expect(person.last_name).toBe("ANONYMISÉ");
      expect(person.anonymized_at).not.toBeNull();
      const student = (await adminRows<Record<string, unknown>>(db, "SELECT * FROM people.students WHERE id = $1", [s.id]))[0] as Record<string, unknown>;
      expect(student.student_number).toBe(s.studentNumber);
      for (const col of ["national_student_id", "birth_certificate_number", "birth_certificate_date", "civil_registry_office", "external_ref"]) expect(student[col], col).toBeNull();
      expect(student.attributes).toEqual({});
      expect(await count(db, "SELECT count(*) AS n FROM people.student_emergency_contacts WHERE student_id = $1", [s.id])).toBe(0);
      const pe = (await adminRows<Record<string, unknown>>(db, "SELECT * FROM people.student_prior_education WHERE student_id = $1", [s.id]))[0] as Record<string, unknown>;
      expect([pe.reference_number, pe.note, pe.institution_name, pe.attachment_object_key]).toEqual([null, null, null, null]);
      expect([...storage.objects.keys()].filter((k) => k.includes(s.id))).toEqual([]);
      // le lien financier / académique (tuteur) est conservé ; le dossier reste lisible mais neutre
      expect(await count(db, "SELECT count(*) AS n FROM people.student_guardians WHERE student_id = $1", [s.id])).toBe(1);
      const view = unwrap(await getStudent(world.deps, c, s.id));
      expect(view.lastName).toBe("ANONYMISÉ");
      expect(unwrap(await getStudentSensitive(world.deps, c, s.id)).nationalStudentId).toBeNull();
      expect((await updateStudent(world.deps, c, s.id, { person: { city: "Abidjan" } })).ok).toBe(false);
      // l'événement ne porte aucune donnée personnelle
      const ev = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE type = 'people.student.anonymized' AND aggregate_id = $1", [s.id]);
      expect(ev).toHaveLength(1);
      expect(JSON.stringify(ev)).not.toMatch(/Gbagbo|awa@/i);
      // la recherche ne retrouve plus l'ancien nom
      expect(unwrap(await listStudents(world.deps, c, { q: "Gbagbo", includeArchived: true })).items).toHaveLength(0);
    });
  });

  describe("abonnés et jobs découverts par le worker", () => {
    const sub = (name: string) => (subscribers as Array<{ name: string; pattern: string | RegExp; handler: (e: DomainEvent, c: unknown) => Promise<void> }>).find((s) => s.name === name);
    const handlerCtx = (t: string) => ({
      tenantId: t,
      db: { ctx: createSystemContext(t), run: (fn: Parameters<typeof db.tenantDb.run>[1]) => db.tenantDb.run(createSystemContext(t), fn) },
      systemDb: db.systemDb,
      tenantDb: db.tenantDb,
      logger: noopLogger,
      subscriber: "test",
      attempt: 1,
      jobId: "job",
    });

    it("déclare ses abonnés avec des noms stables et des motifs précis", () => {
      expect((subscribers as Array<{ name: string }>).map((s) => s.name)).toEqual([
        "people.project-enrollment",
        "people.project-membership",
        "people.instantiate-reference-data",
        "people.end-assignments-on-classroom-closed",
        "people.end-assignments-on-year-closed",
      ]);
      const membership = sub("people.project-membership")?.pattern as RegExp;
      expect(membership.test("iam.membership.created")).toBe(true);
      expect(membership.test("iam.membership.changed")).toBe(true);
      expect(membership.test("iam.membership.deleted")).toBe(false);
      expect(sub("people.project-enrollment")?.pattern).toBe("academic.enrollment.*");
    });

    it("people.project-enrollment est idempotent : un doublon de livraison ne produit aucun second effet", async () => {
      const t = await db.createTenant("ecole-abonne");
      const c = ctxFor(t);
      const s = await mkStudent(world.deps, c);
      const e = event(t, "academic.enrollment.created", { v: 1, enrollmentId: newId(), studentId: s.id, academicYearId: newId(), institutionId: newId(), classroomId: newId(), classroomName: "CM2 A", enrolledOn: "2025-09-01" });
      const handler = sub("people.project-enrollment")?.handler as (e: DomainEvent, c: unknown) => Promise<void>;
      await handler(e, handlerCtx(t));
      await handler(e, handlerCtx(t));
      expect(await count(db, "SELECT count(*) AS n FROM people.student_enrollment_summaries WHERE tenant_id = $1", [t])).toBe(1);
      expect(await count(db, "SELECT count(*) AS n FROM kernel.processed_events WHERE tenant_id = $1 AND subscriber = 'people.project-enrollment'", [t])).toBe(1);
    });

    it("people.instantiate-reference-data amorce un tenant ; les abonnés de fermeture terminent les affectations", async () => {
      const t = await db.createTenant("ecole-amorce");
      await (sub("people.instantiate-reference-data")?.handler as (e: DomainEvent, c: unknown) => Promise<void>)(event(t, "tenancy.tenant.provisioned", { v: 1 }), handlerCtx(t));
      expect(await count(db, "SELECT count(*) AS n FROM people.relationship_types WHERE tenant_id = $1", [t])).toBeGreaterThanOrEqual(8);
      const c = ctxFor(t);
      const year = newId();
      const node = academic.addNode();
      const classroom = academic.addClassroom(year, [node]);
      const teacher = await mkStaff(world.deps, c);
      const { createTeachingAssignment } = await import("../../application/teaching");
      unwrap(await createTeachingAssignment(world.deps, c, { staffId: teacher.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" }));
      await (sub("people.end-assignments-on-classroom-closed")?.handler as (e: DomainEvent, c: unknown) => Promise<void>)(event(t, "academic.classroom.cancelled", { v: 1, classroomId: classroom.id }), handlerCtx(t));
      expect(await count(db, "SELECT count(*) AS n FROM people.teaching_assignments WHERE tenant_id = $1 AND status = 'ENDED'", [t])).toBe(1);
      const ended = await adminRows<{ payload: Record<string, unknown> }>(db, "SELECT payload FROM kernel.domain_events WHERE tenant_id = $1 AND type = 'people.teaching_assignment.ended'", [t]);
      expect(ended).toHaveLength(1);
      expect(ended[0]?.payload).toMatchObject({ reason: "CLASSROOM_CANCELLED" });
    });

    it("le job quotidien d'alerte est planifié par tenant", () => {
      const job = (jobs as Array<{ name: string; cron: string; perTenant?: boolean }>)[0];
      expect(job).toMatchObject({ name: "people.emit-expiring-qualifications", perTenant: true });
      expect(job?.cron.split(" ")).toHaveLength(5);
    });
  });
});
