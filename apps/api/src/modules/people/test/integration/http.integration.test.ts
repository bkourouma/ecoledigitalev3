import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import {
  peopleChildDtoSchema,
  peopleContractDtoSchema,
  peopleStaffDetailDtoSchema,
  peopleStudentDetailDtoSchema,
  peopleStudentListDtoSchema,
  peopleStudentSensitiveDtoSchema,
} from "@ecoledigitale/contracts/src/v2/people";
import { addEmergencyContact } from "../../application/students";
import { addContract } from "../../application/staff";
import { createTeachingAssignment } from "../../application/teaching";
import { createPeopleDeps } from "../../application/deps";
import { createProjectionEnrollmentDirectory } from "../../infrastructure/projection-enrollment-directory";
import { createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { FakeAcademic } from "../support/fake-academic";
import { FakeAccounts, FakeStorage, JPEG_BYTES } from "../support/fakes";
import { buildHarness, type HttpHarness } from "../support/http-harness";
import { giveEnrollment, giveIdentity, link, mkGuardian, mkStaff, mkStudent, person, word } from "../support/scenario";

const SENSITIVE_KEYS = /nationalStudentId|birthCertificate|civilRegistryOffice|"attributes"|password|secret|token|initial_password/i;

describeIntegration("API HTTP /api/v1/people/* (Fastify + Postgres réel) : matrice d'autorisation", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let academic: FakeAcademic;
  let http: HttpHarness;
  let tenant: string;
  let ctx: ReturnType<typeof ctxFor>;
  // jeu de données
  const classA = newId();
  const classB = newId();
  const year = newId();
  const parentIdentity = newId();
  const otherParentIdentity = newId();
  const teacherIdentity = newId();
  const studentIdentity = newId();
  let child: Awaited<ReturnType<typeof mkStudent>>;
  let otherChild: Awaited<ReturnType<typeof mkStudent>>;
  let classmate: Awaited<ReturnType<typeof mkStudent>>;
  let outsider: Awaited<ReturnType<typeof mkStudent>>;
  let parent: Awaited<ReturnType<typeof mkGuardian>>;
  let linkId: string;
  let teacher: Awaited<ReturnType<typeof mkStaff>>;
  let contractId: string;
  let accounts: FakeAccounts;

  beforeAll(async () => {
    db = await createPeopleTestDb();
    academic = new FakeAcademic();
    accounts = new FakeAccounts();
    world = makeWorld(db, { academic, storage: new FakeStorage(), accounts });
    tenant = await db.createTenant("ecole-http");
    ctx = ctxFor(tenant);
    http = await buildHarness(createPeopleDeps({ db: db.tenantDb, clock: world.clock, audit: world.audit, academic, storage: new FakeStorage(), accounts, enrollments: createProjectionEnrollmentDirectory(db.tenantDb) }), { tenant });

    child = await mkStudent(world.deps, ctx, { nationalStudentId: `NAT-${word()}`, birthCertificateNumber: "ACTE-77", attributes: { a: 1 } }, { email: "enfant@example.test", phone: "+2250707070701", addressLine: "Rue des Écoles" });
    otherChild = await mkStudent(world.deps, ctx);
    classmate = await mkStudent(world.deps, ctx);
    outsider = await mkStudent(world.deps, ctx);
    await giveEnrollment(db, tenant, child.id, { classroomId: classA, yearId: year, classroomName: "6e A" });
    await giveEnrollment(db, tenant, classmate.id, { classroomId: classA, yearId: year, classroomName: "6e A" });
    await giveEnrollment(db, tenant, outsider.id, { classroomId: classB, yearId: year, classroomName: "6e B" });
    parent = await mkGuardian(world.deps, ctx, { phone: "+2250101010101" });
    await giveIdentity(db, parent.personId, parentIdentity);
    linkId = (await link(world.deps, ctx, child.id, parent.id, { isPrimaryContact: true, canPickup: false })).id;
    const otherParent = await mkGuardian(world.deps, ctx);
    await giveIdentity(db, otherParent.personId, otherParentIdentity);
    await link(world.deps, ctx, otherChild.id, otherParent.id, { isPrimaryContact: true });
    unwrap(await addEmergencyContact(world.deps, ctx, child.id, { contactName: "Tante Awa", phone: "0102030405" }));
    await giveIdentity(db, child.personId, studentIdentity);

    teacher = await mkStaff(world.deps, ctx, {}, { email: "prof@example.test", phone: "+2250909090909" });
    await giveIdentity(db, teacher.personId, teacherIdentity);
    const node = academic.addNode({ label: "Mathématiques" });
    academic.classrooms.set(classA, { id: classA, academicYearId: year, status: "ACTIVE" });
    academic.classroomNodes.set(classA, [node.id]);
    academic.classrooms.set(classB, { id: classB, academicYearId: year, status: "ACTIVE" });
    academic.classroomNodes.set(classB, [node.id]);
    unwrap(await createTeachingAssignment(world.deps, ctx, { staffId: teacher.id, academicYearId: year, classroomId: classA, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" }));
    contractId = unwrap(await addContract(world.deps, ctx, teacher.id, { contractTypeCode: "CDI", startsOn: "2020-01-01" })).id;
  });
  afterAll(async () => {
    await http.close();
    await db.drop();
  });

  // ----------------------------------------------------------------------------------------------------------------
  describe("secrétariat : cycle de vie d'un dossier", () => {
    it("crée (201), signale un doublon (409), valide sans écrire, lit, modifie, suit l'historique", async () => {
      const draft = person({ lastName: "Konaté", firstName: "Mariam", birthDate: "2011-02-02" });
      const created = await http.call("POST", "/students", { body: { person: draft } });
      expect(created.status).toBe(201);
      expect(peopleStudentDetailDtoSchema.safeParse(created.json.student).success).toBe(true);
      expect(created.headers["cache-control"]).toBe("no-store");
      const id = created.json.student.id as string;
      const dup = await http.call("POST", "/students", { body: { person: { ...draft, lastName: "KONATE" } } });
      expect(dup.status).toBe(409);
      expect(dup.json.code).toBe("people.possible_duplicate");
      expect(dup.json.details.candidates).toHaveLength(1);
      expect(dup.json.details.candidates[0].roles).toEqual(["STUDENT"]); // le secrétariat voit les élèves
      expect(dup.json.requestId).toBeTruthy();
      const val = await http.call("POST", "/students", { body: { person: { ...draft, lastName: "KONATE" }, validateOnly: true } });
      expect(val.status).toBe(200);
      expect(val.json).toMatchObject({ valid: true });
      expect(val.json.duplicates).toHaveLength(1);
      const noSex = await http.call("POST", "/students", { body: { person: { lastName: "Sans", firstName: "Sexe" } } });
      expect(noSex.status).toBe(400);
      expect(noSex.json.code).toBe("people.sex_required");
      const replay = await http.call("POST", "/students", { body: { person: person(), externalRef: "HTTP-1" } });
      const replay2 = await http.call("POST", "/students", { body: { person: person(), externalRef: "HTTP-1" } });
      expect([replay.status, replay2.status]).toEqual([201, 200]);
      expect(replay2.json.replayed).toBe(true);
      const got = await http.call("GET", `/students/${id}`);
      expect(got.status).toBe(200);
      expect(got.json).toMatchObject({ access: "FULL", id });
      const patched = await http.call("PATCH", `/students/${id}`, { body: { person: { city: "Abidjan" } } });
      expect(patched.status).toBe(200);
      expect(patched.json.city).toBe("Abidjan");
      const status = await http.call("POST", `/students/${id}/status`, { body: { status: "EXCLUDED" }, mfa: true });
      expect(status.status).toBe(400); // motif obligatoire
      expect(status.json.code).toBe("people.reason_required");
      const status2 = await http.call("POST", `/students/${id}/status`, { body: { status: "EXCLUDED", reasonText: "Conseil de discipline" }, mfa: true });
      expect(status2.status).toBe(200);
      const history = await http.call("GET", `/students/${id}/history`);
      expect(history.json.items.map((h: { toStatus: string }) => h.toStatus)).toEqual(["EXCLUDED", "ACTIVE"]);
    });

    it("liste : aucun champ sensible, plafond de pagination, filtre par classe, recherche", async () => {
      const list = await http.call("GET", "/students", { query: { limit: "200" } });
      expect(list.status).toBe(200);
      expect(peopleStudentListDtoSchema.safeParse(list.json).success).toBe(true);
      expect(list.text).not.toMatch(SENSITIVE_KEYS);
      expect(list.text).not.toMatch(/enfant@example\.test|\+2250707070701|Rue des Écoles/); // ni coordonnées, ni adresse dans une liste
      expect((await http.call("GET", "/students", { query: { limit: "1000" } })).status).toBe(400);
      expect((await http.call("GET", "/students", { query: { classroomId: classA } })).json.items.map((i: { id: string }) => i.id).sort()).toEqual([child.id, classmate.id].sort());
      expect((await http.call("GET", "/students", { query: { q: child.lastName.toLowerCase() } })).json.items.map((i: { id: string }) => i.id)).toEqual([child.id]);
      expect((await http.call("GET", "/students", { query: { q: "x", classroomId: "pas-un-uuid" } })).status).toBe(400);
    });

    it("champs sensibles : permission dédiée + MFA, lecture auditée ; l'écriture sensible exige la même permission", async () => {
      const noMfa = await http.call("GET", `/students/${child.id}/sensitive`);
      expect(noMfa.status).toBe(403);
      expect(noMfa.json.code).toBe("rbac.mfa_required");
      const before = world.audit.find("people.student.sensitive_read").length;
      const ok = await http.call("GET", `/students/${child.id}/sensitive`, { mfa: true });
      expect(ok.status).toBe(200);
      expect(peopleStudentSensitiveDtoSchema.safeParse(ok.json).success).toBe(true);
      expect(ok.json.birthCertificateNumber).toBe("ACTE-77");
      expect(world.audit.find("people.student.sensitive_read")).toHaveLength(before + 1);
      // la fiche ordinaire n'expose jamais ces champs
      const plain = await http.call("GET", `/students/${child.id}`);
      expect(plain.text).not.toMatch(SENSITIVE_KEYS);
      // écrire un champ sensible sans MFA : refusé
      const write = await http.call("PATCH", `/students/${child.id}`, { body: { civilRegistryOffice: "Mairie" } });
      expect(write.status).toBe(403);
      const write2 = await http.call("PATCH", `/students/${child.id}`, { body: { civilRegistryOffice: "Mairie" }, mfa: true });
      expect(write2.status).toBe(200);
    });

    it("validation stricte : champ inconnu, UUID invalide, corps invalide ; erreurs sans fuite interne", async () => {
      const unknownField = await http.call("POST", "/students", { body: { person: person(), initialPassword: "x" } });
      expect(unknownField.status).toBe(400);
      expect(unknownField.json.kind).toBe("validation");
      expect((await http.call("GET", "/students/pas-un-uuid")).status).toBe(400);
      const bad = await http.call("POST", "/students", { rawBody: "{ pas du json", contentType: "application/json" });
      expect(bad.status).toBe(400);
      expect(bad.text).not.toMatch(/at \w+ \(|node_modules|SELECT /);
      expect((await http.call("GET", `/students/${newId()}`)).status).toBe(404);
    });

    it("tuteurs et liens : création, lien avec drapeaux prudents, changement réservé à guardian.manage, clôture", async () => {
      const g = await http.call("POST", "/guardians", { body: { person: person({ sex: "M", email: `${word()}@example.test` }) } });
      expect(g.status).toBe(201);
      const gid = g.json.guardian.id as string;
      const l = await http.call("POST", `/students/${otherChild.id}/guardians`, { body: { guardianId: gid, relationshipCode: "UNCLE_AUNT" } });
      expect(l.status).toBe(201);
      expect(l.json).toMatchObject({ canPickup: false, hasLegalCustody: false });
      expect((await http.call("PATCH", `/students/${otherChild.id}/guardians/${l.json.id}`, { body: { canPickup: true } })).json.canPickup).toBe(true);
      expect((await http.call("GET", `/students/${otherChild.id}/guardians`)).json.items).toHaveLength(2);
      const closed = await http.call("DELETE", `/students/${otherChild.id}/guardians/${l.json.id}`, { query: { reason: "Fin de tutelle" } });
      expect(closed.status).toBe(200);
      expect(closed.json.validTo).toBe("2025-09-01");
      expect((await http.call("GET", `/students/${otherChild.id}/guardians`)).json.items).toHaveLength(1);
      expect((await http.call("GET", `/guardians/${gid}`)).status).toBe(200);
      expect((await http.call("GET", "/guardians", { query: { studentId: child.id } })).json.items.map((x: { id: string }) => x.id)).toEqual([parent.id]);
    });

    it("export CSV : audité, plafonné, sans champ sensible ; invitation au portail sans mot de passe", async () => {
      const csv = await http.call("GET", "/students/export", { mfa: true });
      expect(csv.status).toBe(200);
      expect(String(csv.headers["content-type"])).toContain("text/csv");
      expect(csv.text).toContain("Matricule");
      expect(csv.text).not.toMatch(SENSITIVE_KEYS);
      expect((await http.call("GET", "/students/export")).status).toBe(403); // MFA
      const inv = await http.call("POST", `/persons/${parent.personId}/portal-invitation`, { body: {}, role: "secretariat" });
      expect(inv.status).toBe(200); // l'identité existe déjà : rôle accordé, pas de second compte
      expect(inv.json).toMatchObject({ invited: false, role: "parent" });
      const fresh = await mkGuardian(world.deps, ctx, { email: "nouveau.parent@example.test" });
      const inv2 = await http.call("POST", `/persons/${fresh.personId}/portal-invitation`, { body: { channel: "EMAIL" } });
      expect(inv2.status).toBe(201);
      expect(inv2.text).not.toMatch(/password|motdepasse|jeton|token/i);
    });

    it("photo : octets bruts contrôlés, URL signée, suppression", async () => {
      const put = await http.call("PUT", `/students/${child.id}/photo`, { rawBody: Buffer.from(JPEG_BYTES), contentType: "image/jpeg" });
      expect(put.status).toBe(200);
      const url = await http.call("GET", `/students/${child.id}/photo`);
      expect(url.json.url).toMatch(/^https:\/\//);
      const svg = await http.call("PUT", `/students/${child.id}/photo`, { rawBody: "<svg onload=alert(1)>", contentType: "image/png" });
      expect(svg.status).toBe(400);
      expect(svg.json.code).toBe("people.invalid_image");
      expect((await http.call("DELETE", `/students/${child.id}/photo`)).status).toBe(200);
    });

    it("référentiels et paramètres réservés à people.settings.manage", async () => {
      expect((await http.call("GET", "/reference/relationship-types", { role: "secretariat" })).status).toBe(200);
      expect((await http.call("PUT", "/reference/relationship-types", { role: "secretariat", body: { code: "PARRAIN", label: "Parrain", kind: "OTHER" } })).status).toBe(403);
      expect((await http.call("PUT", "/reference/relationship-types", { role: "directeur", body: { code: "PARRAIN", label: "Parrain", kind: "OTHER" } })).status).toBe(200);
      expect((await http.call("GET", "/settings", { role: "secretariat" })).status).toBe(403);
      const s = await http.call("PUT", "/settings", { role: "directeur", body: { duplicateCheckEnabled: false } });
      expect(s.json.duplicateCheckEnabled).toBe(false);
      await http.call("PUT", "/settings", { role: "directeur", body: { duplicateCheckEnabled: true } });
      expect((await http.call("PUT", "/settings", { role: "directeur", body: { studentNumberPattern: "x" } })).status).toBe(400);
    });
  });

  // ----------------------------------------------------------------------------------------------------------------
  describe("parent : ne voit que SES enfants", () => {
    const as = { role: "parent" as const, user: parentIdentity };

    it("GET /children : seulement ses enfants ; GET /children/:id : 404 pour tout autre élève", async () => {
      const list = await http.call("GET", "/children", as);
      expect(list.status).toBe(200);
      expect(list.json.items.map((i: { id: string }) => i.id)).toEqual([child.id]);
      expect(list.text).not.toMatch(SENSITIVE_KEYS);
      const own = await http.call("GET", `/children/${child.id}`, as);
      expect(own.status).toBe(200);
      expect(peopleChildDtoSchema.safeParse(own.json).success).toBe(true);
      expect(own.text).not.toMatch(SENSITIVE_KEYS);
      expect(own.json.emergencyContacts).toHaveLength(1);
      for (const other of [otherChild.id, classmate.id, outsider.id, newId()]) {
        const r = await http.call("GET", `/children/${other}`, as);
        expect(r.status, other).toBe(404);
        expect(r.json.code).toBe("people.student_not_found");
      }
    });

    it("n'a accès à AUCUN endpoint d'administration ni à ceux d'un autre profil (403)", async () => {
      const forbidden: Array<[string, string, unknown?]> = [
        ["GET", "/students"],
        ["GET", `/students/${child.id}`],
        ["GET", `/students/${child.id}/sensitive`],
        ["GET", `/students/${child.id}/history`],
        ["GET", `/students/${child.id}/guardians`],
        ["GET", `/students/${child.id}/emergency-contacts`],
        ["PATCH", `/students/${child.id}`, { person: { city: "X" } }],
        ["POST", `/students/${child.id}/status`, { status: "WITHDRAWN", reasonText: "x" }],
        ["POST", "/students", { person: person() }],
        ["GET", "/students/export"],
        ["GET", "/guardians"],
        ["PATCH", `/students/${child.id}/guardians/${linkId}`, { canPickup: true }], // un tuteur ne modifie JAMAIS ses drapeaux
        ["DELETE", `/students/${child.id}/guardians/${linkId}`],
        ["GET", "/staff"],
        ["GET", `/staff/${teacher.id}/contracts`],
        ["GET", "/teaching-assignments/unstaffed?yearId=" + year],
        ["GET", "/me/student"],
        ["GET", "/me/staff"],
        ["GET", "/settings"],
        ["POST", `/students/${child.id}/anonymize`, { reason: "x" }],
        ["POST", `/persons/${parent.personId}/portal-invitation`, {}],
      ];
      for (const [method, url, body] of forbidden) {
        const r = await http.call(method as "GET", url, { ...as, ...(body ? { body } : {}), mfa: true });
        expect(r.status, `${method} ${url}`).toBe(403);
      }
    });

    it("met à jour SES coordonnées et les contacts d'urgence de SON enfant, pas ceux d'un autre", async () => {
      const mine = await http.call("PATCH", "/me/guardian", { ...as, body: { phone: "+2250202020202", city: "Bouaké" } });
      expect(mine.status).toBe(200);
      const reject = await http.call("PATCH", "/me/guardian", { ...as, body: { lastName: "Pirate" } });
      expect(reject.status).toBe(400); // jamais l'identité
      const viaContact = await http.call("PATCH", "/me/contact", { ...as, body: { addressLine: "Quartier Commerce" } });
      expect(viaContact.status).toBe(200);
      const contactId = (await http.call("GET", `/children/${child.id}`, as)).json.emergencyContacts[0].id as string;
      const upd = await http.call("PATCH", `/children/${child.id}/emergency-contacts/${contactId}`, { ...as, body: { phone: "0111111111" } });
      expect(upd.status).toBe(200);
      const foreign = await http.call("PATCH", `/children/${outsider.id}/emergency-contacts/${newId()}`, { ...as, body: { phone: "0111111111" } });
      expect(foreign.status).toBe(404);
      expect(world.audit.find("people.guardian.own_contact_updated").length).toBeGreaterThanOrEqual(2);
    });

    it("l'identité vient de request.ctx : un en-tête X-User-Id ou X-Student-Id ne change rien", async () => {
      const spoof = await http.call("GET", "/children", { ...as, headers: { "x-user-id": otherParentIdentity, "x-student-id": otherChild.id, "x-tenant-id": newId() } });
      expect(spoof.json.items.map((i: { id: string }) => i.id)).toEqual([child.id]);
      const other = await http.call("GET", "/children", { role: "parent", user: otherParentIdentity });
      expect(other.json.items.map((i: { id: string }) => i.id)).toEqual([otherChild.id]);
    });

    it("lien clos ou portail coupé : l'accès disparaît immédiatement (404)", async () => {
      const g = await mkGuardian(world.deps, ctx);
      const identity = await giveIdentity(db, g.personId);
      const kid = await mkStudent(world.deps, ctx);
      const l = await link(world.deps, ctx, kid.id, g.id);
      expect((await http.call("GET", `/children/${kid.id}`, { role: "parent", user: identity })).status).toBe(200);
      await http.call("PATCH", `/students/${kid.id}/guardians/${l.id}`, { body: { portalAccess: false } });
      expect((await http.call("GET", `/children/${kid.id}`, { role: "parent", user: identity })).status).toBe(404);
      await http.call("PATCH", `/students/${kid.id}/guardians/${l.id}`, { body: { portalAccess: true } });
      await http.call("DELETE", `/students/${kid.id}/guardians/${l.id}`);
      expect((await http.call("GET", "/children", { role: "parent", user: identity })).json.items).toEqual([]);
    });
  });

  // ----------------------------------------------------------------------------------------------------------------
  describe("élève : son propre dossier seulement", () => {
    const as = { role: "eleve" as const, user: studentIdentity };
    it("GET /me/student, PATCH de ses coordonnées ; rien d'autre", async () => {
      const me = await http.call("GET", "/me/student", as);
      expect(me.status).toBe(200);
      expect(me.json).toMatchObject({ id: child.id, access: "SELF" });
      expect(me.text).not.toMatch(SENSITIVE_KEYS);
      expect((await http.call("PATCH", "/me/student", { ...as, body: { phone: "+2250303030303" } })).status).toBe(200);
      expect((await http.call("PATCH", "/me/student", { ...as, body: { firstName: "Autre" } })).status).toBe(400);
      for (const url of ["/students", `/students/${child.id}`, "/children", `/children/${child.id}`, "/guardians", "/staff"]) {
        expect((await http.call("GET", url, as)).status, url).toBe(403);
      }
      const noRecord = await http.call("GET", "/me/student", { role: "eleve", user: newId() });
      expect(noRecord.status).toBe(404); // jamais « la fiche la plus récente »
    });
  });

  // ----------------------------------------------------------------------------------------------------------------
  describe("enseignant : les élèves de SES classes seulement", () => {
    const as = { role: "enseignant" as const, user: teacherIdentity };

    it("liste restreinte aux classes où il est affecté aujourd'hui", async () => {
      const list = await http.call("GET", "/students", as);
      expect(list.status).toBe(200);
      expect(list.json.items.map((i: { id: string }) => i.id).sort()).toEqual([child.id, classmate.id].sort());
      expect(list.text).not.toMatch(SENSITIVE_KEYS);
      // un filtre sur une classe qui n'est pas la sienne ne contourne rien
      const other = await http.call("GET", "/students", { ...as, query: { classroomId: classB } });
      expect(other.json.items).toEqual([]);
    });

    it("fiche d'un élève de sa classe : niveau CLASS (coordonnées et adresse de l'élève masquées) ; autre classe : 404", async () => {
      const own = await http.call("GET", `/students/${child.id}`, as);
      expect(own.status).toBe(200);
      expect(peopleStudentDetailDtoSchema.safeParse(own.json).success).toBe(true);
      expect(own.json).toMatchObject({ access: "CLASS", email: null, phone: null, addressLine: null, birthPlace: null });
      expect(own.json.primaryGuardian).toMatchObject({ displayName: expect.any(String) });
      expect(own.json.primaryGuardian.phone).toBe("+2250202020202"); // le tuteur à joindre : fiche utile
      expect(own.text).not.toMatch(SENSITIVE_KEYS);
      expect((await http.call("GET", `/students/${outsider.id}`, as)).status).toBe(404);
      expect((await http.call("GET", `/students/${otherChild.id}`, as)).status).toBe(404);
      expect((await http.call("GET", `/students/${child.id}/emergency-contacts`, as)).status).toBe(200);
      expect((await http.call("GET", `/students/${outsider.id}/emergency-contacts`, as)).status).toBe(404);
    });

    it("n'écrit rien, ne lit ni sensible, ni historique, ni tuteurs, ni personnel", async () => {
      const denied: Array<[string, string, unknown?]> = [
        ["GET", `/students/${child.id}/sensitive`],
        ["GET", `/students/${child.id}/history`],
        ["GET", `/students/${child.id}/guardians`],
        ["PATCH", `/students/${child.id}`, { person: { city: "X" } }],
        ["POST", `/students/${child.id}/status`, { status: "WITHDRAWN", reasonText: "x" }],
        ["POST", "/students", { person: person() }],
        ["GET", "/students/export"],
        ["GET", "/guardians"],
        ["GET", "/staff"],
        ["GET", `/staff/${teacher.id}/contracts`],
        ["PATCH", `/staff/${teacher.id}/contracts/${contractId}`, { status: "CANCELLED" }],
        ["POST", `/staff/${teacher.id}/contracts`, { contractTypeCode: "CDI", startsOn: "2026-01-01" }],
        ["POST", `/staff/${teacher.id}/status`, { status: "LEFT", reasonText: "x" }],
        ["PATCH", `/staff/${teacher.id}`, { jobTitle: "Directeur" }],
        ["POST", "/teaching-assignments", { staffId: teacher.id, academicYearId: year, classroomId: classA, roleCode: "HOMEROOM", startsOn: "2025-09-01" }],
        ["GET", "/settings"],
      ];
      for (const [method, url, body] of denied) {
        const r = await http.call(method as "GET", url, { ...as, ...(body ? { body } : {}), mfa: true });
        expect(r.status, `${method} ${url}`).toBe(403);
      }
    });

    it("portail : mon profil, mes classes, mes affectations, mes contrats ; il met à jour ses coordonnées et disponibilités, jamais son statut ni son contrat", async () => {
      const me = await http.call("GET", "/me/staff", as);
      expect(me.status).toBe(200);
      expect(peopleStaffDetailDtoSchema.safeParse(me.json).success).toBe(true);
      expect(me.json.id).toBe(teacher.id);
      expect((await http.call("GET", "/me/classes", as)).json.items.map((c: { classroomId: string }) => c.classroomId)).toEqual([classA]);
      expect((await http.call("GET", "/me/assignments", as)).json.items).toHaveLength(1);
      const contracts = await http.call("GET", "/me/contracts", as);
      expect(contracts.status).toBe(200);
      expect(peopleContractDtoSchema.safeParse(contracts.json.items[0]).success).toBe(true);
      const upd = await http.call("PATCH", "/me/staff", { ...as, body: { contact: { phone: "+2250808080808" }, availabilities: [{ weekday: 2, startTime: "08:00", endTime: "12:00", kind: "UNAVAILABLE", reason: "Autre établissement" }] } });
      expect(upd.status).toBe(200);
      const attempt = await http.call("PATCH", "/me/staff", { ...as, body: { status: "LEFT", contact: { phone: "+2250808080808" } } });
      expect(attempt.status).toBe(400);
      // un autre enseignant ne voit pas les contrats de celui-ci
      const colleague = await mkStaff(world.deps, ctx);
      const colleagueIdentity = await giveIdentity(db, colleague.personId);
      const mine = await http.call("GET", "/me/contracts", { role: "enseignant", user: colleagueIdentity });
      expect(mine.json.items).toEqual([]);
    });

    it("GARDE-FOU : avec le modèle d'enseignant ACTUEL d'rbac (student.read + student.list) il reste limité à ses classes", async () => {
      const cur = { role: "enseignant_actuel" as const, user: teacherIdentity };
      const list = await http.call("GET", "/students", cur);
      expect(list.status).toBe(200);
      expect(list.json.items.map((i: { id: string }) => i.id).sort()).toEqual([child.id, classmate.id].sort());
      expect((await http.call("GET", `/students/${child.id}`, cur)).json.access).toBe("CLASS");
      expect((await http.call("GET", `/students/${outsider.id}`, cur)).status).toBe(404);
      // lectures « tous les élèves » (historique, inscriptions, antécédents) refusées même pour sa propre classe
      for (const sub of ["history", "enrollments", "prior-education"]) {
        expect((await http.call("GET", `/students/${child.id}/${sub}`, cur)).status, sub).toBe(403);
      }
      // un membre du personnel enseignant qui détient aussi student.update (administration) garde la lecture complète
      const admin = await http.call("GET", `/students/${outsider.id}`, { role: "secretariat", user: teacherIdentity });
      expect(admin.json.access).toBe("FULL");
      // un enseignant parti (LEFT) reste restreint : plus aucune classe, plus aucun élève
      const gone = await mkStaff(world.deps, ctx);
      const goneId = await giveIdentity(db, gone.personId);
      unwrap(await (await import("../../application/staff")).changeStaffStatus(world.deps, ctx, gone.id, { status: "LEFT", reasonText: "Départ" }));
      expect((await http.call("GET", "/students", { role: "enseignant_actuel", user: goneId })).json.items).toEqual([]);
      expect((await http.call("GET", `/students/${child.id}`, { role: "enseignant_actuel", user: goneId })).status).toBe(404);
    });

    it("après la fin de son affectation il ne voit plus la classe ni ses élèves", async () => {
      const t = await mkStaff(world.deps, ctx);
      const id = await giveIdentity(db, t.personId);
      const node = academic.addNode();
      const cls = newId();
      academic.classrooms.set(cls, { id: cls, academicYearId: year, status: "ACTIVE" });
      academic.classroomNodes.set(cls, [node.id]);
      const kid = await mkStudent(world.deps, ctx);
      await giveEnrollment(db, tenant, kid.id, { classroomId: cls, yearId: year });
      const a = unwrap(await createTeachingAssignment(world.deps, ctx, { staffId: t.id, academicYearId: year, classroomId: cls, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" }));
      const view = { role: "enseignant" as const, user: id };
      expect((await http.call("GET", `/students/${kid.id}`, view)).status).toBe(200);
      const ended = await http.call("POST", `/teaching-assignments/${a.assignment.id}/end`, { role: "directeur_etudes", body: { endsOn: "2025-08-31" } });
      expect(ended.status).toBe(400); // antérieure au début
      const ended2 = await http.call("POST", `/teaching-assignments/${a.assignment.id}/end`, { role: "directeur_etudes", body: { endsOn: "2025-09-01" } });
      expect(ended2.status).toBe(200);
      world.clock.advance(2 * 86_400_000);
      expect((await http.call("GET", `/students/${kid.id}`, view)).status).toBe(404);
      expect((await http.call("GET", "/me/classes", view)).json.items).toEqual([]);
      world.clock.advance(-2 * 86_400_000);
    });
  });

  // ----------------------------------------------------------------------------------------------------------------
  describe("autres profils", () => {
    it("éducateur : lecture de tous les élèves et tuteurs, aucune écriture", async () => {
      const as = { role: "educateur" as const, user: newId() };
      expect((await http.call("GET", "/students", as)).json.total).toBeGreaterThan(3);
      expect((await http.call("GET", `/students/${outsider.id}`, as)).json.access).toBe("FULL");
      expect((await http.call("GET", "/guardians", as)).status).toBe(200);
      expect((await http.call("POST", "/students", { ...as, body: { person: person() } })).status).toBe(403);
      expect((await http.call("GET", `/students/${child.id}/sensitive`, { ...as, mfa: true })).status).toBe(403);
    });

    it("directeur des études : gère les affectations et lit le personnel, sans contrats ni création de personnel", async () => {
      const as = { role: "directeur_etudes" as const, user: newId() };
      expect((await http.call("GET", "/staff", as)).status).toBe(200);
      expect((await http.call("GET", `/staff/${teacher.id}`, as)).status).toBe(200);
      expect((await http.call("GET", `/staff/${teacher.id}/contracts`, as)).status).toBe(403);
      expect((await http.call("POST", "/staff", { ...as, body: { person: person(), categoryCode: "TEACHER" } })).status).toBe(403);
      const unstaffed = await http.call("GET", "/teaching-assignments/unstaffed", { ...as, query: { yearId: year, classroomId: classB } });
      expect(unstaffed.status).toBe(200);
      expect(unstaffed.json.items).toHaveLength(1); // la classe B n'a pas de responsable pour « Mathématiques »
      const node = academic.classroomNodes.get(classB)?.[0] as string;
      const second = await mkStaff(world.deps, ctx);
      const created = await http.call("POST", "/teaching-assignments", { ...as, body: { staffId: second.id, academicYearId: year, classroomId: classB, curriculumNodeId: node, roleCode: "LEAD", startsOn: "2025-09-01" } });
      expect(created.status).toBe(201);
      const conflict = await http.call("POST", "/teaching-assignments", { ...as, body: { staffId: teacher.id, academicYearId: year, classroomId: classB, curriculumNodeId: node, roleCode: "LEAD", startsOn: "2025-09-01" } });
      expect(conflict.status).toBe(409);
      expect(conflict.json.code).toBe("people.assignment_conflict");
      const replaced = await http.call("POST", `/teaching-assignments/${created.json.assignment.id}/replace`, { ...as, body: { newStaffId: teacher.id, effectiveOn: "2025-09-01", reason: "Réaffectation" } });
      expect(replaced.status).toBe(200);
      expect((await http.call("GET", `/classrooms/${classB}/assignments`, as)).json.items.some((a: { staffId: string; status: string }) => a.staffId === teacher.id && a.status === "ACTIVE")).toBe(true);
      expect((await http.call("GET", `/staff/${teacher.id}/load`, { ...as, query: { yearId: year } })).status).toBe(200);
      expect((await http.call("GET", `/staff/${teacher.id}/assignments`, as)).json.items.length).toBeGreaterThanOrEqual(1);
    });

    it("économe : lit le personnel (staff.read), jamais les contrats ni les élèves en écriture", async () => {
      const as = { role: "econome" as const, user: newId() };
      expect((await http.call("GET", "/staff", as)).status).toBe(200); // staff.read suffit à lister (modèle de l'économe)
      expect((await http.call("GET", `/staff/${teacher.id}`, as)).status).toBe(200);
      expect((await http.call("GET", `/staff/${teacher.id}/contracts`, as)).status).toBe(403);
      expect((await http.call("GET", `/students/${child.id}`, as)).status).toBe(200);
      expect((await http.call("PATCH", `/students/${child.id}`, { ...as, body: { person: { city: "X" } } })).status).toBe(403);
    });

    it("direction : gère le personnel, les contrats (MFA) et l'anonymisation exige archivage + conservation", async () => {
      const as = { role: "directeur" as const, user: newId(), mfa: true };
      const created = await http.call("POST", "/staff", { ...as, body: { person: person({ email: `${word()}@example.test` }), categoryCode: "TEACHER" } });
      expect(created.status).toBe(201);
      const sid = created.json.staff.id as string;
      const c = await http.call("POST", `/staff/${sid}/contracts`, { ...as, body: { contractTypeCode: "CDD", startsOn: "2025-09-01", endsOn: "2026-06-30" } });
      expect(c.status).toBe(201);
      expect((await http.call("POST", `/staff/${sid}/contracts`, { ...as, body: { contractTypeCode: "CDD", startsOn: "2026-01-01" } })).status).toBe(409);
      expect((await http.call("POST", `/staff/${sid}/contracts`, { role: "directeur", body: { contractTypeCode: "CDI", startsOn: "2026-01-01" } })).status).toBe(403); // sans MFA
      expect((await http.call("POST", `/staff/${sid}/contracts/${c.json.id}/end`, { ...as, body: { endsOn: "2025-12-31" } })).json.status).toBe("ENDED");
      expect((await http.call("POST", `/staff/${sid}/status`, { ...as, body: { status: "LEFT", reasonText: "Fin de mission" } })).json.status).toBe("LEFT");
      const q = await http.call("POST", `/staff/${sid}/qualifications`, { ...as, body: { kind: "DIPLOMA", label: "Master", expiresOn: "2025-10-10" } });
      expect(q.status).toBe(201);
      expect((await http.call("GET", "/staff/expiring-qualifications", as)).status).toBe(200);
      const anon = await http.call("POST", `/students/${child.id}/anonymize`, { ...as, body: { reason: "Demande" } });
      expect(anon.status).toBe(409);
      expect(anon.json.code).toBe("people.not_archived");
    });

    it("sans authentification : 401 ; autre tenant : aucune donnée", async () => {
      expect((await http.call("GET", "/students", { anonymous: true })).status).toBe(401);
      expect((await http.call("GET", "/children", { anonymous: true })).status).toBe(401);
      const foreignTenant = await db.createTenant("autre-ecole-http");
      expect((await http.call("GET", `/students/${child.id}`, { tenant: foreignTenant })).status).toBe(404);
      expect((await http.call("GET", "/students", { tenant: foreignTenant })).json.total).toBe(0);
      expect((await http.call("GET", "/children", { role: "parent", user: parentIdentity, tenant: foreignTenant })).json.items).toEqual([]);
    });
  });
});
