import { afterAll, beforeAll, expect, it, vi } from "vitest";
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

  it("facturation à l'inscription (L-60) : inscription manuelle -> port appelé ; admission -> jamais ; échec du port -> inscription créée", async () => {
    const invoiceRegistrationFees = vi.fn(async () => {});
    const billed = makeWorld(db, await db.createTenant(), { ports: { billing: { invoiceRegistrationFees } } });
    const seed = await seedHigher(billed);
    const manual = unwrap(await enrollStudent(billed.deps, billed.ctx, { studentId: addStudent(billed).studentId, classroomId: seed.classroomId }));
    expect(invoiceRegistrationFees).toHaveBeenCalledTimes(1);
    expect(invoiceRegistrationFees).toHaveBeenCalledWith(expect.anything(), { enrollmentId: manual.id, studentId: manual.studentId });

    unwrap(await enrollStudent(billed.deps, billed.ctx, { studentId: addStudent(billed).studentId, classroomId: seed.classroomId, sourceKind: "ADMISSION" }));
    expect(invoiceRegistrationFees).toHaveBeenCalledTimes(1); // l'admission facture elle-même

    invoiceRegistrationFees.mockRejectedValueOnce(new Error("finance indisponible"));
    const resilient = unwrap(await enrollStudent(billed.deps, billed.ctx, { studentId: addStudent(billed).studentId, classroomId: seed.classroomId }));
    expect(resilient.id).toBeTruthy(); // l'échec de facturation ne défait pas l'inscription
  });
});
