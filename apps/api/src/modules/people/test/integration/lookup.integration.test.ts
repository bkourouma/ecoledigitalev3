/**
 * Résolution de noms par lots (Postgres réel) : `GET /students/lookup`, `GET /staff/lookup` et leurs équivalents publics
 * (`lookupStudents`, `lookupStaff`, `getDisplayNamesOfStudents`, `getDisplayNamesOfStaff`).
 *
 * Preuves : isolation inter-tenants (la RLS), périmètre de l'appelant (secrétariat, enseignant, parent, élève, personnel),
 * `missing` indiscernable (inconnu ≡ autre tenant ≡ hors périmètre), plafond, doublons, identifiants mal formés, réponse
 * minimale (aucune donnée sensible), une seule instruction SQL pour N identifiants.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, newId, unwrap } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import {
  PEOPLE_LOOKUP_MAX_IDS,
  peopleLookupQuerySchema,
  peopleStaffLookupResponseSchema,
  peopleStudentLookupResponseSchema,
} from "@ecoledigitale/contracts/src/v2/people";
import { createGuardian } from "../../application/guardians";
import { createPeopleDeps } from "../../application/deps";
import { resolveStudentLookupScope } from "../../application/access";
import { LOOKUP_MAX_IDS, getDisplayNamesOfStaff, getDisplayNamesOfStudents, lookupStaff, lookupStudents } from "../../application/lookup";
import { createTeachingAssignment } from "../../application/teaching";
import { createProjectionEnrollmentDirectory } from "../../infrastructure/projection-enrollment-directory";
import { createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { FakeAcademic } from "../support/fake-academic";
import { buildHarness, type HttpHarness, type TestRole } from "../support/http-harness";
import { giveEnrollment, giveIdentity, link, mkGuardian, mkStaff, mkStudent } from "../support/scenario";

const SENSITIVE_KEYS = /"(nationalStudentId|birthCertificate\w*|civilRegistryOffice|attributes|birthDate|birthPlace|otherNames|email|phone\w*|addressLine|city|identityId|hasPhoto|sex|externalRef|currentEnrollment|jobTitle|plannedHours|personId|lastName|firstName|categoryCode)"/;
const SENSITIVE_VALUES = /NAT-LOOKUP-1|ACTE-1|@example|\+2250|Rue Secr/;
const ITEM_KEYS_STUDENT = ["displayName", "id", "status", "studentNumber"];
const ITEM_KEYS_STAFF = ["displayName", "id", "staffNumber", "status"];

describeIntegration("people : résolution de noms par lots (Postgres réel)", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let academic: FakeAcademic;
  let http: HttpHarness;
  let tenant: string;
  let otherTenant: string;
  let otherHttp: HttpHarness;
  const classA = newId();
  const classB = newId();
  const year = newId();
  const parentIdentity = newId();
  const lonelyParentIdentity = newId();
  const teacherIdentity = newId();
  const studentIdentity = newId();
  let child: Awaited<ReturnType<typeof mkStudent>>; // enfant du parent, classe A, compte élève
  let classmate: Awaited<ReturnType<typeof mkStudent>>; // classe A
  let outsider: Awaited<ReturnType<typeof mkStudent>>; // classe B
  let loner: Awaited<ReturnType<typeof mkStudent>>; // aucune classe
  let foreign: Awaited<ReturnType<typeof mkStudent>>; // AUTRE tenant
  let teacher: Awaited<ReturnType<typeof mkStaff>>;
  let colleague: Awaited<ReturnType<typeof mkStaff>>;
  let foreignStaff: Awaited<ReturnType<typeof mkStaff>>;
  let queries = 0;
  let transactions = 0;

  beforeAll(async () => {
    db = await createPeopleTestDb();
    academic = new FakeAcademic();
    world = makeWorld(db, { academic });
    tenant = await db.createTenant("ecole-lookup-a");
    otherTenant = await db.createTenant("ecole-lookup-b");
    const ctx = ctxFor(tenant);
    const otherCtx = ctxFor(otherTenant);
    // un TenantDb « espion » : compte les transactions et les instructions SQL des cas d'usage
    const spy = {
      run: (c: unknown, fn: (tx: any) => Promise<unknown>, options?: unknown) => {
        transactions += 1;
        return (db.tenantDb as any).run(
          c,
          (tx: any) =>
            fn(
              new Proxy(tx, {
                get(target, prop, receiver) {
                  const v = Reflect.get(target, prop, receiver);
                  if (typeof v === "function" && (prop === "query" || prop === "many" || prop === "queryOne")) {
                    return (...args: unknown[]) => {
                      queries += 1;
                      return v.apply(target, args);
                    };
                  }
                  return typeof v === "function" ? v.bind(target) : v;
                },
              }),
            ),
          options,
        );
      },
    } as unknown as TenantDb;
    const deps = createPeopleDeps({ db: spy, clock: world.clock, audit: world.audit, academic, enrollments: createProjectionEnrollmentDirectory(db.tenantDb) });
    http = await buildHarness(deps, { tenant });
    otherHttp = await buildHarness(createPeopleDeps({ db: db.tenantDb, clock: world.clock, audit: world.audit, academic, enrollments: createProjectionEnrollmentDirectory(db.tenantDb) }), { tenant: otherTenant });

    child = await mkStudent(world.deps, ctx, { nationalStudentId: "NAT-LOOKUP-1", birthCertificateNumber: "ACTE-1", attributes: { secret: 1 } }, { email: "enfant@example.test", phone: "+2250707070701", addressLine: "Rue Secrète" });
    classmate = await mkStudent(world.deps, ctx);
    outsider = await mkStudent(world.deps, ctx);
    loner = await mkStudent(world.deps, ctx);
    foreign = await mkStudent(world.deps, otherCtx);
    await giveEnrollment(db, tenant, child.id, { classroomId: classA, yearId: year });
    await giveEnrollment(db, tenant, classmate.id, { classroomId: classA, yearId: year });
    await giveEnrollment(db, tenant, outsider.id, { classroomId: classB, yearId: year });
    await giveIdentity(db, child.personId, studentIdentity);

    const parent = await mkGuardian(world.deps, ctx);
    await giveIdentity(db, parent.personId, parentIdentity);
    await link(world.deps, ctx, child.id, parent.id, { isPrimaryContact: true });
    const lonely = await mkGuardian(world.deps, ctx);
    await giveIdentity(db, lonely.personId, lonelyParentIdentity); // aucun enfant lié

    teacher = await mkStaff(world.deps, ctx, {}, { email: "prof@example.test", phone: "+2250909090909" });
    colleague = await mkStaff(world.deps, ctx);
    foreignStaff = await mkStaff(world.deps, otherCtx);
    await giveIdentity(db, teacher.personId, teacherIdentity);
    const node = academic.addNode({ label: "Mathématiques" });
    for (const c of [classA, classB]) {
      academic.classrooms.set(c, { id: c, academicYearId: year, status: "ACTIVE" });
      academic.classroomNodes.set(c, [node.id]);
    }
    unwrap(await createTeachingAssignment(world.deps, ctx, { staffId: teacher.id, academicYearId: year, classroomId: classA, curriculumNodeId: node.id, roleCode: "LEAD", startsOn: "2025-09-01" }));
  });
  afterAll(async () => {
    await http.close();
    await otherHttp.close();
    await db.drop();
  });

  const get = (h: HttpHarness, path: string, ids: string[] | string, o: { role?: TestRole; user?: string; anonymous?: boolean } = {}) =>
    h.call("GET", `${path}?ids=${Array.isArray(ids) ? ids.join(",") : ids}`, { role: "secretariat", ...o });
  const idsOf = (res: { json: any }) => (res.json.items as Array<{ id: string }>).map((i) => i.id);

  // ---------------------------------------------------------------------------------------------- élèves : secrétariat
  it("secrétariat : élèves du tenant restitués dans l'ordre demandé ; inconnus ET autre tenant dans `missing` ; conforme au contrat", async () => {
    const unknown = newId();
    const res = await get(http, "/students/lookup", [loner.id, child.id, unknown, classmate.id, foreign.id]);
    expect(res.status).toBe(200);
    expect(peopleStudentLookupResponseSchema.safeParse(res.json).success).toBe(true);
    expect(idsOf(res)).toEqual([loner.id, child.id, classmate.id]);
    expect(res.json.missing).toEqual([unknown, foreign.id]);
    expect(res.headers["cache-control"]).toBe("no-store");
    const item = res.json.items.find((i: { id: string }) => i.id === child.id);
    expect(Object.keys(item).sort()).toEqual(ITEM_KEYS_STUDENT);
    expect(item).toMatchObject({ id: child.id, displayName: child.displayName, studentNumber: child.studentNumber, status: child.status });
  });

  it("réponse minimale : aucune donnée sensible ni de contact, ni nom séparé, ni photo, ni inscription", async () => {
    const res = await get(http, "/students/lookup", [child.id, classmate.id, outsider.id]);
    expect(res.text).not.toMatch(SENSITIVE_KEYS);
    expect(res.text).not.toMatch(SENSITIVE_VALUES);
    expect(res.text).not.toContain("NAT-LOOKUP-1");
    const staff = await get(http, "/staff/lookup", [teacher.id, colleague.id], { role: "directeur" });
    expect(staff.text).not.toMatch(SENSITIVE_KEYS);
    expect(staff.text).not.toMatch(SENSITIVE_VALUES);
    expect(staff.text).not.toContain(teacherIdentity);
  });

  it("doublons ignorés (ordre de première apparition), paramètre répété accepté, espaces tolérés", async () => {
    const res = await get(http, "/students/lookup", [child.id, child.id, classmate.id, child.id, classmate.id]);
    expect(idsOf(res)).toEqual([child.id, classmate.id]);
    expect(res.json.missing).toEqual([]);
    const unknown = newId();
    const dupMissing = await get(http, "/students/lookup", [unknown, unknown, unknown]);
    expect(dupMissing.json).toEqual({ items: [], missing: [unknown] });
    const repeated = await http.call("GET", `/students/lookup?ids=${child.id}&ids=${classmate.id}`, { role: "secretariat" });
    expect(idsOf(repeated)).toEqual([child.id, classmate.id]);
    const spaced = await http.call("GET", `/students/lookup?ids=${encodeURIComponent(` ${child.id} , ${classmate.id} `)}`, { role: "secretariat" });
    expect(idsOf(spaced)).toEqual([child.id, classmate.id]);
  });

  it(`plafond : ${PEOPLE_LOOKUP_MAX_IDS} identifiants DISTINCTS acceptés (même répétés), un de plus refusé (400) ; entrées invalides refusées`, async () => {
    const hundred = Array.from({ length: PEOPLE_LOOKUP_MAX_IDS }, () => newId());
    const ok = await get(http, "/students/lookup", [...hundred, ...hundred.slice(0, 10)]);
    expect(ok.status).toBe(200);
    expect(ok.json.missing).toEqual(hundred);
    const tooMany = await get(http, "/students/lookup", [...hundred, newId()]);
    expect(tooMany.status).toBe(400);
    expect(tooMany.json.code).toBeTruthy();
    expect((await get(http, "/staff/lookup", [...hundred, newId()], { role: "directeur" })).status).toBe(400);
    for (const bad of ["", "pas-un-uuid", `${child.id},`, `${child.id},,${classmate.id}`, `${child.id},x`, "1; DROP TABLE people.students"]) {
      const res = await http.call("GET", `/students/lookup?ids=${encodeURIComponent(bad)}`, { role: "secretariat" });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await http.call("GET", "/students/lookup", { role: "secretariat" })).status).toBe(400); // ids absent
    expect((await http.call("GET", `/students/lookup?ids=${child.id}&extra=1`, { role: "secretariat" })).status).toBe(400); // paramètre inconnu
  });

  // ---------------------------------------------------------------------------------------------- périmètre
  it("enseignant : les élèves de SES classes seulement ; hors classe ≡ inconnu ≡ autre tenant (même `missing`), jamais 403/404 par id", async () => {
    const unknown = newId();
    const res = await get(http, "/students/lookup", [child.id, classmate.id, outsider.id, loner.id, unknown, foreign.id], { role: "enseignant", user: teacherIdentity });
    expect(res.status).toBe(200);
    expect(idsOf(res)).toEqual([child.id, classmate.id]);
    expect(res.json.missing).toEqual([outsider.id, loner.id, unknown, foreign.id]); // indiscernables
    // l'ancien modèle d'enseignant (student.read + student.list) est restreint par le garde-fou de people
    const legacy = await get(http, "/students/lookup", [child.id, outsider.id], { role: "enseignant_actuel", user: teacherIdentity });
    expect(idsOf(legacy)).toEqual([child.id]);
    expect(legacy.json.missing).toEqual([outsider.id]);
    // un enseignant sans aucune classe ne voit personne
    const idle = await get(http, "/students/lookup", [child.id], { role: "enseignant", user: newId() });
    expect(idle.json).toEqual({ items: [], missing: [child.id] });
  });

  it("parent : SES enfants seulement ; un parent sans lien ne voit personne", async () => {
    const res = await get(http, "/students/lookup", [child.id, classmate.id, outsider.id], { role: "parent", user: parentIdentity });
    expect(res.status).toBe(200);
    expect(idsOf(res)).toEqual([child.id]);
    expect(res.json.missing).toEqual([classmate.id, outsider.id]);
    const lonely = await get(http, "/students/lookup", [child.id], { role: "parent", user: lonelyParentIdentity });
    expect(lonely.json).toEqual({ items: [], missing: [child.id] });
    const stranger = await get(http, "/students/lookup", [child.id], { role: "parent", user: newId() });
    expect(stranger.json).toEqual({ items: [], missing: [child.id] });
  });

  it("élève : son propre dossier seulement", async () => {
    const res = await get(http, "/students/lookup", [child.id, classmate.id], { role: "eleve", user: studentIdentity });
    expect(idsOf(res)).toEqual([child.id]);
    expect(res.json.missing).toEqual([classmate.id]);
    const other = await get(http, "/students/lookup", [child.id], { role: "eleve", user: newId() });
    expect(other.json).toEqual({ items: [], missing: [child.id] });
  });

  it("sans permission applicable : 403 ; sans authentification : 401", async () => {
    expect((await get(http, "/students/lookup", [child.id], { role: "aucun" })).status).toBe(403);
    expect((await get(http, "/students/lookup", [child.id], { anonymous: true })).status).toBe(401);
    expect((await get(http, "/staff/lookup", [teacher.id], { role: "aucun" })).status).toBe(403);
    expect((await get(http, "/staff/lookup", [teacher.id], { anonymous: true })).status).toBe(401);
  });

  it("un parent qui est AUSSI enseignant cumule ses périmètres (classes ∪ enfants)", async () => {
    // la fiche de l'enseignant est aussi celle d'un tuteur de `outsider` (classe B, hors de ses classes)
    const guardian = unwrap(await createGuardian(world.deps, ctxFor(tenant), { personId: teacher.personId })).guardian;
    await link(world.deps, ctxFor(tenant), outsider.id, guardian.id, { isPrimaryContact: true });
    const can = async (p: string) => ["student.class.read", "student.child.read"].includes(p);
    const scope = unwrap(await resolveStudentLookupScope(world.deps, createRequestContext({ tenantId: tenant, userId: teacherIdentity, roles: [] }), can));
    expect(scope.kind).toBe("IDS");
    expect(scope.kind === "IDS" ? [...scope.ids].sort() : []).toEqual([child.id, classmate.id, outsider.id].sort());
    const ctx = createRequestContext({ tenantId: tenant, userId: teacherIdentity, roles: [] });
    const res = unwrap(await lookupStudents(world.deps, ctx, [child.id, outsider.id, loner.id], { scope }));
    expect(res.items.map((i) => i.id)).toEqual([child.id, outsider.id]);
    expect(res.missing).toEqual([loner.id]);
    // sans permission du tout : refus
    const none = await resolveStudentLookupScope(world.deps, ctx, async () => false);
    expect(none.ok).toBe(false);
  });

  // ---------------------------------------------------------------------------------------------- isolation inter-tenants
  it("isolation : un tenant ne résout JAMAIS les identifiants d'un autre (élèves et personnel), dans les deux sens", async () => {
    const fromB = await get(otherHttp, "/students/lookup", [child.id, classmate.id, foreign.id]);
    expect(idsOf(fromB)).toEqual([foreign.id]);
    expect(fromB.json.missing).toEqual([child.id, classmate.id]);
    const fromA = await get(http, "/students/lookup", [foreign.id]);
    expect(fromA.json).toEqual({ items: [], missing: [foreign.id] });
    const staffFromA = await get(http, "/staff/lookup", [foreignStaff.id, teacher.id], { role: "directeur" });
    expect(idsOf(staffFromA)).toEqual([teacher.id]);
    expect(staffFromA.json.missing).toEqual([foreignStaff.id]);
    const staffFromB = await get(otherHttp, "/staff/lookup", [teacher.id, colleague.id, foreignStaff.id], { role: "directeur" });
    expect(idsOf(staffFromB)).toEqual([foreignStaff.id]);
    // même par l'API publique, avec le contexte de l'AUTRE tenant
    const viaApi = unwrap(await lookupStudents(world.deps, ctxFor(otherTenant), [child.id, foreign.id]));
    expect(viaApi.items.map((i) => i.id)).toEqual([foreign.id]);
  });

  // ---------------------------------------------------------------------------------------------- personnel
  it("personnel : `staff.read` (économe) et direction voient tout le personnel du tenant ; réponse minimale conforme au contrat", async () => {
    for (const role of ["econome", "directeur"] as const) {
      const res = await get(http, "/staff/lookup", [colleague.id, teacher.id, newId()], { role });
      expect(res.status, role).toBe(200);
      expect(peopleStaffLookupResponseSchema.safeParse(res.json).success).toBe(true);
      expect(idsOf(res)).toEqual([colleague.id, teacher.id]);
      expect(Object.keys(res.json.items[0]).sort()).toEqual(ITEM_KEYS_STAFF);
      expect(res.json.items[0]).toMatchObject({ id: colleague.id, displayName: colleague.displayName, staffNumber: colleague.staffNumber, status: colleague.status });
    }
  });

  it("personnel : `staff.own.read` seul (enseignant) ne résout que SA fiche ; élèves et parents n'ont aucun accès (403)", async () => {
    const res = await get(http, "/staff/lookup", [teacher.id, colleague.id, foreignStaff.id], { role: "enseignant", user: teacherIdentity });
    expect(res.status).toBe(200);
    expect(idsOf(res)).toEqual([teacher.id]);
    expect(res.json.missing).toEqual([colleague.id, foreignStaff.id]);
    const noRecord = await get(http, "/staff/lookup", [teacher.id], { role: "enseignant", user: newId() });
    expect(noRecord.json).toEqual({ items: [], missing: [teacher.id] });
    expect((await get(http, "/staff/lookup", [teacher.id], { role: "parent", user: parentIdentity })).status).toBe(403);
    expect((await get(http, "/staff/lookup", [teacher.id], { role: "eleve", user: studentIdentity })).status).toBe(403);
  });

  // ---------------------------------------------------------------------------------------------- API publique
  it("API publique : `lookup*` (Result), plafond 500, identifiants mal formés refusés ; périmètre `IDS` appliqué avant la lecture", async () => {
    const many = Array.from({ length: LOOKUP_MAX_IDS + 1 }, () => newId());
    const tooMany = await lookupStudents(world.deps, ctxFor(tenant), many);
    expect(tooMany.ok).toBe(false);
    expect(!tooMany.ok && tooMany.error.httpStatus).toBe(400);
    expect((await lookupStaff(world.deps, ctxFor(tenant), many)).ok).toBe(false);
    const bad = await lookupStudents(world.deps, ctxFor(tenant), [child.id, "n'importe quoi"]);
    expect(bad.ok).toBe(false);
    expect(unwrap(await lookupStudents(world.deps, ctxFor(tenant), []))).toEqual({ items: [], missing: [] });
    const scoped = unwrap(await lookupStudents(world.deps, ctxFor(tenant), [child.id, classmate.id], { scope: { kind: "IDS", ids: [classmate.id] } }));
    expect(scoped.items.map((i) => i.id)).toEqual([classmate.id]);
    expect(scoped.missing).toEqual([child.id]);
    expect(unwrap(await lookupStudents(world.deps, ctxFor(tenant), [child.id], { scope: { kind: "IDS", ids: [] } }))).toEqual({ items: [], missing: [child.id] });
  });

  it("API publique : `getDisplayNamesOf*` renvoie une Map, découpe en lots de 500, ignore inconnus et invalides, ne lève jamais sur la taille", async () => {
    const noise = Array.from({ length: 1_100 }, () => newId());
    const names = await getDisplayNamesOfStudents(world.deps, ctxFor(tenant), [...noise, child.id, "invalide", classmate.id, child.id, foreign.id]);
    expect([...names.keys()].sort()).toEqual([child.id, classmate.id].sort());
    expect(names.get(child.id)).toBe(child.displayName);
    const staffNames = await getDisplayNamesOfStaff(world.deps, ctxFor(tenant), [...noise, teacher.id, colleague.id, "x", foreignStaff.id]);
    expect([...staffNames.keys()].sort()).toEqual([teacher.id, colleague.id].sort());
    expect(staffNames.get(teacher.id)).toBe(teacher.displayName);
    expect((await getDisplayNamesOfStudents(world.deps, ctxFor(tenant), [])).size).toBe(0);
  });

  it("une seule transaction et UNE instruction SQL pour N identifiants (pas de N+1)", async () => {
    const ids = [child.id, classmate.id, outsider.id, loner.id, ...Array.from({ length: 60 }, () => newId())];
    transactions = 0;
    queries = 0;
    const res = await get(http, "/students/lookup", ids, { role: "secretariat" });
    expect(res.status).toBe(200);
    expect(res.json.items).toHaveLength(4);
    expect(transactions).toBe(1);
    expect(queries).toBe(1);
    transactions = 0;
    queries = 0;
    expect((await get(http, "/staff/lookup", [teacher.id, colleague.id, ...Array.from({ length: 40 }, () => newId())], { role: "directeur" })).status).toBe(200);
    expect(transactions).toBe(1);
    expect(queries).toBe(1);
  });

  it("contrat d'entrée : peopleLookupQuerySchema dédoublonne, plafonne et refuse les segments vides", () => {
    const a = newId();
    const b = newId();
    expect(peopleLookupQuerySchema.parse({ ids: `${a},${b},${a}` }).ids).toEqual([a, b]);
    expect(peopleLookupQuerySchema.parse({ ids: [a, b] }).ids).toEqual([a, b]);
    expect(peopleLookupQuerySchema.safeParse({ ids: "" }).success).toBe(false);
    expect(peopleLookupQuerySchema.safeParse({ ids: `${a},` }).success).toBe(false);
    expect(peopleLookupQuerySchema.safeParse({ ids: Array.from({ length: PEOPLE_LOOKUP_MAX_IDS + 1 }, () => newId()).join(",") }).success).toBe(false);
    expect(peopleLookupQuerySchema.safeParse({ ids: a, autre: 1 }).success).toBe(false);
  });
});
