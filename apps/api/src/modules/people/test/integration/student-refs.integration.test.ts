/**
 * `resolveStudentRefs` (extension additive pour les imports 031) : un matricule d'origine OU un matricule de la
 * plateforme devient un identifiant d'élève, par lots (une requête), sans fuite entre tenants.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { resolveStudentRefs, STUDENT_REFS_MAX } from "../../application/student-refs";
import { createPeopleTestDb, ctxFor, describeIntegration, makeWorld, type PeopleTestDb, type TestWorld } from "../support/db";
import { mkStudent } from "../support/scenario";

describeIntegration("people : résolution de références d'élèves d'un fichier", () => {
  let db: PeopleTestDb;
  let world: TestWorld;
  let tenant: string;
  let other: string;
  beforeAll(async () => {
    db = await createPeopleTestDb();
    world = makeWorld(db);
    tenant = await db.createTenant("ecole-refs-a");
    other = await db.createTenant("ecole-refs-b");
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("résout le matricule d'origine et le matricule de la plateforme, insensible à la casse, et ignore les inconnus", async () => {
    const ctx = ctxFor(tenant);
    const a = await mkStudent(world.deps, ctx, { externalRef: "ORIG-A-001" });
    const b = await mkStudent(world.deps, ctx, { externalRef: "orig-b-002" });
    const c = await mkStudent(world.deps, ctx);
    const r = unwrap(await resolveStudentRefs(world.deps, ctx, ["orig-a-001", " ORIG-B-002 ", a.studentNumber, "INCONNU-9", "", "orig-a-001"]));
    const byRef = new Map(r.map((m) => [m.ref, m]));
    expect(byRef.get("orig-a-001")).toMatchObject({ studentId: a.id, matchedBy: "EXTERNAL_REF" });
    expect(byRef.get("ORIG-B-002")).toMatchObject({ studentId: b.id, matchedBy: "EXTERNAL_REF" });
    expect(byRef.get(a.studentNumber)).toMatchObject({ studentId: a.id, matchedBy: "STUDENT_NUMBER" });
    expect(byRef.has("INCONNU-9")).toBe(false);
    expect(r.filter((m) => m.ref === "orig-a-001")).toHaveLength(1); // dédoublonné (même graphie demandée deux fois)
    expect(unwrap(await resolveStudentRefs(world.deps, ctx, [c.studentNumber]))[0]?.studentId).toBe(c.id);
  });

  it("n'expose jamais un élève d'un autre tenant (RLS) et plafonne le lot", async () => {
    const ctxA = ctxFor(tenant);
    const ctxB = ctxFor(other);
    await mkStudent(world.deps, ctxA, { externalRef: "SHARED-REF" });
    const mine = await mkStudent(world.deps, ctxB, { externalRef: "SHARED-REF" });
    expect(unwrap(await resolveStudentRefs(world.deps, ctxB, ["SHARED-REF"])).map((m) => m.studentId)).toEqual([mine.id]);
    expect(unwrap(await resolveStudentRefs(world.deps, ctxA, ["SHARED-REF"])).map((m) => m.studentId)).not.toContain(mine.id);
    const tooMany = await resolveStudentRefs(world.deps, ctxA, Array.from({ length: STUDENT_REFS_MAX + 1 }, (_, i) => `R${i}`));
    expect(tooMany.ok).toBe(false);
  });
});
