import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { assertTenantIsolation, checkTenantIsolation } from "@ecoledigitale/database";
import allowlistDefault, { fixtures as peopleFixtures, peopleIsolationAllowlistTables, peopleTenantTables } from "../../../isolation-allowlist.people";
import { addEmergencyContact, addPriorEducation, getStudent, getStudentsByIds, listStudents } from "../../application/students";
import { listStudentDocuments, uploadStudentDocument } from "../../application/documents";
import { FakeStorage } from "../support/fakes";
import { addContract, addQualification, getStaff, listStaff, setAffiliations, setAvailabilities, setCompetencies } from "../../application/staff";
import { createTeachingAssignment, listAssignmentsForClassroom } from "../../application/teaching";
import { getGuardian, isGuardianOfStudent, listChildrenOfIdentity, listGuardians } from "../../application/guardians";
import { applyMembershipEvent } from "../../application/projection";
import { adminRows, createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { FakeAcademic } from "../support/fake-academic";
import { giveEnrollment, giveIdentity, link, mkGuardian, mkStaff, mkStudent } from "../support/scenario";

describeIntegration("isolation multi-tenant du schéma people (Postgres réel)", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let academic: FakeAcademic;
  let tenantA: string;
  let tenantB: string;
  let a: ReturnType<typeof ctxFor>;
  let b: ReturnType<typeof ctxFor>;
  let studentA: string;
  let guardianA: string;
  let staffA: string;
  const identityA = newId();

  beforeAll(async () => {
    db = await createPeopleTestDb();
    academic = new FakeAcademic();
    world = makeWorld(db, { academic, storage: new FakeStorage() });
    tenantA = await db.createTenant("tenant-a");
    tenantB = await db.createTenant("tenant-b");
    a = ctxFor(tenantA);
    b = ctxFor(tenantB);
    // Données COMPLÈTES chez A (chaque table du schéma) et quelques lignes chez B.
    const year = newId();
    const node = academic.addNode();
    const classroom = academic.addClassroom(year, [node]);
    const s = await mkStudent(world.deps, a, { nationalStudentId: "NAT-A", attributes: { x: 1 } });
    studentA = s.id;
    const g = await mkGuardian(world.deps, a);
    guardianA = g.id;
    await giveIdentity(db, g.personId, identityA);
    await link(world.deps, a, s.id, g.id, { isPrimaryContact: true });
    unwrap(await addEmergencyContact(world.deps, a, s.id, { contactName: "Oncle", phone: "0102030405" }));
    unwrap(await addPriorEducation(world.deps, a, s.id, { kind: "DIPLOMA", label: "BEPC", referenceNumber: "REF-1" }, { withSensitive: true }));
    unwrap(await uploadStudentDocument(world.deps, a, s.id, Uint8Array.from(Buffer.from("%PDF-1.7\n%%EOF")), { typeCode: "ID_CARD", fileName: "cni.pdf" }));
    await giveEnrollment(db, tenantA, s.id, { classroomId: classroom.id });
    const st = await mkStaff(world.deps, a);
    staffA = st.id;
    unwrap(await setAffiliations(world.deps, a, st.id, [{ institutionId: newId() }]));
    unwrap(await addContract(world.deps, a, st.id, { contractTypeCode: "CDI", startsOn: "2020-01-01" }));
    unwrap(await addQualification(world.deps, a, st.id, { kind: "DIPLOMA", label: "Licence" }));
    unwrap(await setCompetencies(world.deps, a, st.id, [{ subjectId: newId() }]));
    unwrap(await setAvailabilities(world.deps, a, st.id, [{ weekday: 1, startTime: "08:00", endTime: "10:00", kind: "UNAVAILABLE" }]));
    unwrap(await createTeachingAssignment(world.deps, a, { staffId: st.id, academicYearId: year, classroomId: classroom.id, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" }));
    await world.deps.db.run(a, (tx) =>
      applyMembershipEvent(tx, {
        id: newId(), type: "iam.membership.created", version: 1, tenantId: tenantA, occurredAt: "2025-09-01T08:00:00.000Z", payload: { v: 1, identityId: identityA, membershipId: newId(), roles: ["parent"], status: "active" },
      }),
    );
    await mkStudent(world.deps, b);
    await mkStaff(world.deps, b);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("test d'isolation générique : structure + comportement de chaque table du schéma people", async () => {
    const report = await checkTenantIsolation({ pool: db.appPool, schemas: ["people"], allowlist: peopleIsolationAllowlistTables, fixtures: peopleFixtures });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    expect(report.allowlisted).toEqual([]);
    const covered = new Set([...report.behavioural, ...report.structuralOnly.map((s) => s.table)]);
    expect([...covered].sort()).toEqual([...peopleTenantTables].sort());
    // les tables à CHECK ont une fixture : elles sont vérifiées en comportement ; les autres (clés composites) le sont ci-dessous
    for (const t of Object.keys(peopleFixtures)) expect(report.behavioural).toContain(t);
    expect(allowlistDefault).toEqual([]); // allowlist vide : aucune table globale
    // La version bloquante de la CI :
    await assertTenantIsolation({ pool: db.appPool, schemas: ["people"], allowlist: peopleIsolationAllowlistTables, fixtures: peopleFixtures });
  });

  it("aucune table du schéma n'échappe à la liste attendue ni à la RLS forcée", async () => {
    const tables = await adminRows<{ t: string }>(db, "SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema = 'people' AND table_type = 'BASE TABLE' ORDER BY 1");
    expect(tables.map((r) => r.t)).toEqual([...peopleTenantTables].sort());
    const noRls = await adminRows(db, "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'people' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)");
    expect(noRls).toEqual([]);
  });

  it("A/B sur de VRAIES données : B ne lit rien de A dans aucune table, ne modifie ni n'insère rien chez A", async () => {
    for (const table of peopleTenantTables) {
      const inA = Number((await adminRows<{ n: string }>(db, `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`, [tenantA]))[0]?.n);
      const seenByB = await db.tenantDb.run(b, async (tx) => Number((await tx.queryOne<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`, [tenantA]))?.n));
      expect(seenByB, `${table} vu par B`).toBe(0);
      const seenByA = await db.tenantDb.run(a, async (tx) => Number((await tx.queryOne<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))?.n));
      expect(seenByA, `${table} vu par A`).toBe(inA);
      // sauf les tables de configuration alimentées à l'usage, chaque table contient des données chez A
      if (!["people.number_sequences"].includes(table)) expect(inA, `${table} sans donnée chez A`).toBeGreaterThan(0);
    }
    // UPDATE / DELETE croisés : 0 ligne touchée
    const updated = await db.tenantDb.run(b, async (tx) => (await tx.query(`UPDATE people.persons SET city = 'X' WHERE tenant_id = $1`, [tenantA])).rowCount);
    expect(updated).toBe(0);
    const deleted = await db.tenantDb.run(b, async (tx) => (await tx.query(`DELETE FROM people.student_prior_education WHERE tenant_id = $1`, [tenantA])).rowCount);
    expect(deleted).toBe(0);
    // INSERT portant le tenant de A depuis B : refusé par la RLS
    await expect(
      db.tenantDb.run(b, (tx) => tx.query(`INSERT INTO people.relationship_types (id, tenant_id, code, label) VALUES ($1, $2, 'INTRUS', 'Intrus')`, [newId(), tenantA])),
    ).rejects.toThrow(/row-level security|sécurité au niveau/i);
    // sans contexte de tenant : rien n'est visible
    const bare = await db.appPool.query("SELECT count(*)::int AS n FROM people.persons");
    expect(bare.rows[0].n).toBe(0);
  });

  it("A/B via les cas d'usage : un autre tenant obtient 404 / listes vides / refus partout", async () => {
    expect((await getStudent(world.deps, b, studentA)).ok).toBe(false);
    expect(unwrap(await getStudentsByIds(world.deps, b, [studentA]))).toEqual([]);
    expect(unwrap(await listStudents(world.deps, b, {})).items.map((i) => i.id)).not.toContain(studentA);
    expect((await getGuardian(world.deps, b, guardianA)).ok).toBe(false);
    expect(unwrap(await listGuardians(world.deps, b, {})).items.map((i) => i.id)).not.toContain(guardianA);
    expect((await getStaff(world.deps, b, staffA)).ok).toBe(false);
    expect(unwrap(await listStaff(world.deps, b, {})).items.map((i) => i.id)).not.toContain(staffA);
    expect(await listStudentDocuments(world.deps, b, studentA)).toMatchObject({ ok: false, error: { code: "people.student_not_found" } });
    expect(unwrap(await listStudentDocuments(world.deps, a, studentA))).toHaveLength(1);
    expect(await isGuardianOfStudent(world.deps, b, identityA, studentA)).toBe(false);
    expect(unwrap(await listChildrenOfIdentity(world.deps, b, identityA))).toEqual([]);
    const fakeClass = [...academic.classrooms.keys()][0] as string;
    expect(unwrap(await listAssignmentsForClassroom(world.deps, b, fakeClass))).toEqual([]);
    expect(unwrap(await listAssignmentsForClassroom(world.deps, a, fakeClass))).toHaveLength(1);
  });

  it("une clé étrangère composite interdit de lier des lignes de deux tenants, même en connaissant les UUID", async () => {
    const gB = await mkGuardian(world.deps, b);
    // élève de A, tuteur de B : insertion directe (superuser, RLS contournée) refusée par la FK composite (tenant_id, id)
    await expect(
      db.admin.query(
        `INSERT INTO people.student_guardians (id, tenant_id, student_id, guardian_id, relationship_code) VALUES ($1, $2, $3, $4, 'FATHER')`,
        [newId(), tenantA, studentA, gB.id],
      ),
    ).rejects.toThrow(/foreign key|clé étrangère/i);
    await expect(
      db.admin.query(`INSERT INTO people.students (id, tenant_id, person_id, student_number, sequence_number) VALUES ($1, $2, $3, 'X-1', 999)`, [newId(), tenantA, gB.personId]),
    ).rejects.toThrow(/foreign key|clé étrangère/i);
  });
});
