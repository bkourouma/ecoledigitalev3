/**
 * GED assemblée sur Postgres réel avec les VRAIS adaptateurs (people + iam + entitlements -> documents, aucun annuaire en
 * mémoire) : liens de tutelle et fiches réels (`identity_id`), comptes réels (`iam.memberships`), usage de stockage dans
 * `entitlements.usage_counters`, cloisonnement par tenant de l'annuaire.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, newId, unwrap, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { createGuardian, createStaff, linkGuardian, unlinkGuardian } from "../../src/modules/people";
import {
  InMemoryStorage,
  createDocument,
  createDocumentsDeps,
  getDocument,
  listDocuments,
  type ActorCaps,
  type DocumentsDeps,
} from "../../src/modules/documents";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const pdf = (n: string): Uint8Array => new TextEncoder().encode(`%PDF-1.4\n% ${n} ${Math.random()}\n%%EOF\n`);

const CAPS = {
  secretary: { read: true, readRestricted: true, upload: true, share: true, historyRead: true } satisfies ActorCaps,
  parent: { childRead: true, childUpload: true } satisfies ActorCaps,
  student: { selfRead: true, selfUpload: true } satisfies ActorCaps,
  teacher: { read: true, ownRead: true, ownUpload: true } satisfies ActorCaps,
};

function expectErr<T>(r: Result<T, AppError>, code: string): void {
  expect(r.ok, `attendu : erreur « ${code} »`).toBe(false);
  if (!r.ok) expect(r.error.code).toBe(code);
}

describeIntegration("GED : people + iam + entitlements -> documents (adaptateurs réels)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let deps: DocumentsDeps;
  let storage: InMemoryStorage;
  const u = {
    father: newId(),
    mother: newId(),
    guardian2: newId(),
    former: newId(),
    student1: newId(),
    teacher: newId(),
    secretary: newId(),
    ghost: newId(),
  };
  const ctxOf = (userId: string, tenantId = w.tenantId): RequestContext => createRequestContext({ tenantId, userId });

  let seq = 0;
  const addGuardian = async (studentId: string, identity: string, code: "FATHER" | "MOTHER" | "LEGAL_GUARDIAN", name: string) => {
    seq += 1;
    const g = unwrap(await createGuardian(w.kit.people, w.director, { person: { lastName: name, firstName: `Tuteur${seq}`, sex: code === "MOTHER" ? "F" : "M", birthDate: `19${70 + seq}-05-0${seq}`, email: `g${identity.slice(-12)}@example.test` } })).guardian;
    await w.db.admin.query("UPDATE people.persons SET identity_id = $2 WHERE id = $1", [g.personId, identity]);
    const link = unwrap(await linkGuardian(w.kit.people, w.director, studentId, { guardianId: g.id, relationshipCode: code }));
    return { guardian: g, link };
  };
  /** Compte réel : identité + appartenance au tenant (existence du compte pour le partage). */
  const addAccount = async (identity: string, email: string, tenantId = w.tenantId): Promise<void> => {
    await w.db.admin.query("INSERT INTO iam.identities (id, email, status, created_at, updated_at) VALUES ($1, $2, 'active', now(), now()) ON CONFLICT (id) DO NOTHING", [identity, email]);
    await w.db.admin.query("INSERT INTO iam.memberships (id, tenant_id, identity_id, status, base_role, roles, created_at, updated_at) VALUES ($1, $2, $3, 'active', 'parent', ARRAY['parent'], now(), now())", [newId(), tenantId, identity]);
  };

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 2 });
    storage = new InMemoryStorage(() => w.clock.now());
    deps = createDocumentsDeps({ db: w.tenantDb, clock: w.clock, ports: { ...w.ports.documents, storage, planQuota: async () => 1024 * 1024 * 1024 } });
    const [p1, p2] = school.pupils;
    await w.db.admin.query("UPDATE people.persons SET identity_id = $2 WHERE id = (SELECT person_id FROM people.students WHERE id = $1)", [p1!.studentId, u.student1]);
    await addGuardian(p1!.studentId, u.father, "FATHER", "PERE");
    await addGuardian(p1!.studentId, u.mother, "MOTHER", "MERE");
    await addGuardian(p2!.studentId, u.guardian2, "LEGAL_GUARDIAN", "TUTEUR2");
    const former = await addGuardian(p1!.studentId, u.former, "LEGAL_GUARDIAN", "ANCIEN");
    unwrap(await unlinkGuardian(w.kit.people, w.director, p1!.studentId, former.link.id, { reason: "Fin de la tutelle" }));
    u.teacher = school.teacher.ctx.userId as string;
    for (const [id, email] of [[u.father, "pere@example.test"], [u.mother, "mere@example.test"], [u.guardian2, "tuteur2@example.test"], [u.former, "ancien@example.test"], [u.student1, "etudiant1@example.test"], [u.teacher, "ens@example.test"], [u.secretary, "secretaire@example.test"]] as const) {
      await addAccount(id, email);
    }
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  it("liens de l'appelant relus à chaque appel : tuteur lié, tuteur dont le lien est clos, compte d'élève, personnel, compte sans fiche", async () => {
    const owners = w.ports.documents.owners!;
    const [p1, p2] = school.pupils;
    expect(await owners.resolveActorLinks(ctxOf(u.father))).toEqual({ studentId: null, childStudentIds: [p1!.studentId], staffId: null });
    expect((await owners.resolveActorLinks(ctxOf(u.mother))).childStudentIds).toEqual([p1!.studentId]);
    expect((await owners.resolveActorLinks(ctxOf(u.guardian2))).childStudentIds).toEqual([p2!.studentId]);
    expect((await owners.resolveActorLinks(ctxOf(u.former))).childStudentIds).toEqual([]); // lien clos
    expect(await owners.resolveActorLinks(ctxOf(u.student1))).toMatchObject({ studentId: p1!.studentId, childStudentIds: [] });
    expect(await owners.resolveActorLinks(ctxOf(u.teacher))).toMatchObject({ staffId: school.teacher.staffId, studentId: null });
    expect(await owners.resolveActorLinks(ctxOf(u.ghost))).toEqual({ studentId: null, childStudentIds: [], staffId: null }); // échec fermé
  });

  it("existence et noms des propriétaires : réels, indiscernables s'ils sont inconnus ; cloisonnés par tenant", async () => {
    const owners = w.ports.documents.owners!;
    const [p1] = school.pupils;
    const unknown = newId();
    expect([...(await owners.existingOwners(ctxOf(u.secretary), "STUDENT", [p1!.studentId, unknown]))]).toEqual([p1!.studentId]);
    expect((await owners.ownerNames(ctxOf(u.secretary), "STUDENT", [p1!.studentId])).get(p1!.studentId)).toContain("ETUDIANT1");
    expect([...(await owners.existingOwners(ctxOf(u.secretary), "STAFF", [school.teacher.staffId]))]).toEqual([school.teacher.staffId]);
    // un autre tenant ne voit pas les fiches du premier
    const otherTenant = newId();
    await w.db.admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [otherTenant, `other-${otherTenant.slice(-8)}`, "Autre école"]);
    expect([...(await owners.existingOwners(ctxOf(u.secretary, otherTenant), "STUDENT", [p1!.studentId]))]).toEqual([]);
    expect((await owners.ownerNames(ctxOf(u.secretary, otherTenant), "STAFF", [school.teacher.staffId])).size).toBe(0);
  });

  it("comptes : nom de la fiche liée, sinon partie locale de l'e-mail ; inconnus et comptes d'un autre tenant absents ; recherche et tuteurs d'un élève", async () => {
    const owners = w.ports.documents.owners!;
    const [p1] = school.pupils;
    const names = await owners.userNames(ctxOf(u.secretary), [u.father, u.secretary, u.ghost]);
    expect(names.get(u.father)).toContain("PERE");
    expect(names.get(u.secretary)).toBe("secretaire"); // aucune fiche : partie locale seulement, jamais le domaine
    expect(names.has(u.ghost)).toBe(false);
    // un compte membre d'un AUTRE tenant seulement n'existe pas ici
    const foreign = newId();
    const otherTenant = newId();
    await w.db.admin.query("INSERT INTO kernel.tenants (id, slug, name) VALUES ($1, $2, $3)", [otherTenant, `foreign-${otherTenant.slice(-8)}`, "Tenant étranger"]);
    await addAccount(foreign, "etranger@example.test", otherTenant);
    expect((await owners.userNames(ctxOf(u.secretary), [foreign])).size).toBe(0);
    expect((await owners.searchUsers(ctxOf(u.secretary), "PERE", 10)).map((p) => p.id)).toContain(u.father);
    expect((await owners.searchUsers(ctxOf(u.secretary), "a", 10))).toEqual([]); // moins de 2 caractères
    const guardians = (await owners.guardianUsers(ctxOf(u.secretary), p1!.studentId)).map((g) => g.id).sort();
    expect(guardians).toEqual([u.father, u.mother].sort()); // pas le tuteur dont le lien est clos
    expect((await owners.searchOwners(ctxOf(u.secretary), "STUDENT", "ETUDIANT1", 5)).map((p) => p.id)[0]).toBe(p1!.studentId); // recherche approchante : la meilleure réponse d'abord
    expect((await owners.searchOwners(ctxOf(u.secretary), "STAFF", "ENSEIGNANT", 5)).map((p) => p.id)).toContain(school.teacher.staffId);
  });

  it("AC-4 de bout en bout : dépôt du secrétariat pour l'élève 1 ; ses deux tuteurs et lui-même lisent ; le tuteur d'un autre élève, l'ancien tuteur et l'enseignant non", async () => {
    const [p1, p2] = school.pupils;
    const identity = await adminRows<{ id: string }>(w, "SELECT 1 AS id"); // force l'amorçage du tenant avant la lecture des catégories
    void identity;
    const { listCategories } = await import("../../src/modules/documents");
    const cats = unwrap(await listCategories(deps, ctxOf(u.secretary), { caps: CAPS.secretary }));
    const idCategory = cats.find((c) => c.code === "STUDENT_IDENTITY")!.id;
    const doc = unwrap(
      await createDocument(deps, ctxOf(u.secretary), {
        caps: CAPS.secretary,
        fields: { categoryId: idCategory, title: "Acte de naissance", ownerType: "STUDENT", ownerId: p1!.studentId, visibility: "INHERIT", tags: [], metadata: {} },
        file: { fileName: "acte.pdf", bytes: pdf("acte") },
      }),
    );
    expect(doc.ownerName).toContain("ETUDIANT1"); // nom réel de la fiche

    const visibleTo = async (user: string, caps: ActorCaps): Promise<boolean> => (await getDocument(deps, ctxOf(user), { caps, documentId: doc.id })).ok;
    expect(await visibleTo(u.father, CAPS.parent)).toBe(true);
    expect(await visibleTo(u.mother, CAPS.parent)).toBe(true);
    expect(await visibleTo(u.student1, CAPS.student)).toBe(true);
    expect(await visibleTo(u.guardian2, CAPS.parent)).toBe(false); // tuteur d'un autre élève
    expect(await visibleTo(u.former, CAPS.parent)).toBe(false); // lien clos
    expect(await visibleTo(u.teacher, CAPS.teacher)).toBe(false); // RESTRICTED
    expect(await visibleTo(u.ghost, CAPS.parent)).toBe(false); // compte sans fiche liée
    expect(unwrap(await listDocuments(deps, ctxOf(u.father), { caps: CAPS.parent, query: {} })).items.map((d) => d.id)).toEqual([doc.id]);
    expect(unwrap(await listDocuments(deps, ctxOf(u.guardian2), { caps: CAPS.parent, query: {} })).items).toEqual([]);

    // le lien clos le reste : un parent dépose pour SON enfant, jamais pour celui d'un autre
    const own = await createDocument(deps, ctxOf(u.father), { caps: CAPS.parent, fields: { categoryId: idCategory, title: "Certificat de scolarité", ownerType: "STUDENT", ownerId: p1!.studentId, visibility: "INHERIT", tags: [], metadata: {} }, file: { fileName: "cs.pdf", bytes: pdf("cs") } });
    expect(own.ok).toBe(true);
    expectErr(await createDocument(deps, ctxOf(u.father), { caps: CAPS.parent, fields: { categoryId: idCategory, title: "Autre enfant", ownerType: "STUDENT", ownerId: p2!.studentId, visibility: "INHERIT", tags: [], metadata: {} }, file: { fileName: "x.pdf", bytes: pdf("x") } }), "documents.forbidden");
    expectErr(await createDocument(deps, ctxOf(u.former), { caps: CAPS.parent, fields: { categoryId: idCategory, title: "Ancien tuteur", ownerType: "STUDENT", ownerId: p1!.studentId, visibility: "INHERIT", tags: [], metadata: {} }, file: { fileName: "y.pdf", bytes: pdf("y") } }), "documents.forbidden");

    // partage à un compte réel
    const { shareDocument } = await import("../../src/modules/documents");
    unwrap(await shareDocument(deps, ctxOf(u.secretary), { caps: CAPS.secretary, documentId: doc.id, body: { userId: u.teacher, level: "READ" } }));
    expect(await visibleTo(u.teacher, CAPS.teacher)).toBe(true);
    expectErr(await shareDocument(deps, ctxOf(u.secretary), { caps: CAPS.secretary, documentId: doc.id, body: { userId: u.ghost, level: "READ" } }), "documents.share_invalid"); // pas membre du tenant
  });

  it("AC-11 : l'usage de stockage est reporté à entitlements (jauge du mois, dernière valeur)", async () => {
    const [p1] = school.pupils;
    const { listCategories } = await import("../../src/modules/documents");
    const cats = unwrap(await listCategories(deps, ctxOf(u.secretary), { caps: CAPS.secretary }));
    const bytes = pdf("usage");
    unwrap(
      await createDocument(deps, ctxOf(u.secretary), {
        caps: CAPS.secretary,
        fields: { categoryId: cats.find((c) => c.code === "STUDENT_ENROLLMENT")!.id, title: "Usage", ownerType: "STUDENT", ownerId: p1!.studentId, visibility: "INHERIT", tags: [], metadata: {} },
        file: { fileName: "usage.pdf", bytes },
      }),
    );
    const used = (await adminRows<{ n: string }>(w, "SELECT coalesce(sum(size_bytes), 0)::text AS n FROM documents.versions WHERE tenant_id = $1 AND state = 'ACTIVE'", [w.tenantId]))[0]!.n;
    const counter = await adminRows<{ value: string; metric: string }>(w, "SELECT metric, value::text FROM entitlements.usage_counters WHERE tenant_id = $1 AND metric = 'STORAGE_BYTES'", [w.tenantId]);
    expect(counter).toEqual([{ metric: "STORAGE_BYTES", value: used }]);
    expect(Number(used)).toBeGreaterThanOrEqual(bytes.length);
  });
});
