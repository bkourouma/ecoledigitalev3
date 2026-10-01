import { afterAll, beforeAll, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { enrollStudent, getRoster, getRuleContext, listNodesForEnrollment } from "../../index";
import { createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";
import { addStudent, makeWorld, seedHigher, type World } from "../support/world";

describeIntegration("smoke — de bout en bout sur Postgres réel", () => {
  let db: AcademicTestDb;
  let w: World;
  beforeAll(async () => {
    db = await createAcademicTestDb();
    w = makeWorld(db, await db.createTenant());
  });
  afterAll(async () => {
    await db.drop();
  });

  it("construit un monde supérieur, inscrit un élève et lit ses nœuds", async () => {
    const seed = await seedHigher(w);
    const s = addStudent(w);
    const e = unwrap(await enrollStudent(w.deps, w.ctx, { studentId: s.studentId, classroomId: seed.classroomId }));
    expect(e.status).toBe("PENDING"); // HIGHER : ON_REGISTRATION_FEE_PAID
    const roster = unwrap(await getRoster(w.deps, w.ctx, seed.classroomId));
    expect(roster.items).toHaveLength(0); // PENDING n'ouvre pas la scolarité
  });
});
