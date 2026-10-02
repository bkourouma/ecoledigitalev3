/**
 * Conseils de classe : VRAIS adaptateurs (academic, people, tenancy) sur Postgres réel.
 * Effectif nommé, inscription, périmètre d'enseignant, tutelle relue (échec fermé), statut d'élève sur acte humain uniquement, modèle de pack.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, createSystemContext, newId, type RequestContext } from "@ecoledigitale/kernel";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

describeIntegration("councils : adaptateurs réels", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  const sys = (): RequestContext => createSystemContext(w.tenantId);

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 2 });
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  it("academic : classe, effectif nommé, inscription ; inconnu -> null", async () => {
    const p = w.ports.councils;
    const c = await p.academic!.getClassroom(sys(), school.ref.classroomId);
    expect(c).toMatchObject({ classroomId: school.ref.classroomId, active: true });
    expect(await p.academic!.getClassroom(sys(), newId())).toBeNull();
    const today = new Date().toISOString().slice(0, 10);
    const roster = await p.academic!.getRoster(sys(), school.ref.classroomId, today);
    expect(roster.map((r) => r.studentId).sort()).toEqual(school.pupils.map((x) => x.studentId).sort());
    expect(roster.every((r) => (r.displayName ?? "").includes("ETUDIANT"))).toBe(true);
    const e = await p.academic!.getEnrollment(sys(), school.pupils[0]!.enrollmentId);
    expect(e).toMatchObject({ studentId: school.pupils[0]!.studentId, active: true });
    expect(await p.academic!.getEnrollment(sys(), newId())).toBeNull();
    expect(await p.academic!.getPeriod(sys(), school.ref.academicPeriodId)).toMatchObject({ periodId: school.ref.academicPeriodId });
  });

  it("people : affectations, périmètre d'enseignant, tutelle (échec fermé sans lien)", async () => {
    const p = w.ports.councils;
    const today = new Date().toISOString().slice(0, 10);
    const assigns = await p.staff!.listAssignmentsForClassroom(sys(), school.ref.classroomId, today);
    expect(assigns.map((a) => a.staffId)).toContain(school.teacher.staffId);
    expect(await p.staff!.staffIdOfUser(sys(), school.teacher.ctx.userId as string)).toBe(school.teacher.staffId);
    expect(await p.staff!.isStaffAssignedToClassroom(sys(), school.teacher.ctx.userId as string, school.ref.classroomId)).toBe(true);
    expect(await p.staff!.isStaffAssignedToClassroom(sys(), newId(), school.ref.classroomId)).toBe(false);
    expect(await p.family!.isGuardianOfStudent(sys(), newId(), school.pupils[0]!.studentId)).toBe(false);
    expect((await p.family!.getStudentNames(sys(), [school.pupils[0]!.studentId])).get(school.pupils[0]!.studentId)).toContain("ETUDIANT1");
  });

  it("statut d'élève : un acteur système est refusé ; un humain habilité change le statut", async () => {
    const p = w.ports.councils;
    const sid = school.pupils[1]!.studentId;
    await expect(p.studentStatus!.changeStudentStatus(sys(), { studentId: sid, status: "SUSPENDED", reasonText: "test" })).rejects.toBeTruthy();
    expect((await adminRows<{ status: string }>(w, "SELECT status FROM people.students WHERE id = $1", [sid]))[0]!.status).toBe("ACTIVE");
    const human = createRequestContext({ tenantId: w.tenantId, userId: newId(), roles: ["directeur"], mfa: true });
    await p.studentStatus!.changeStudentStatus(human, { studentId: sid, status: "SUSPENDED", reasonText: "test" });
    expect((await adminRows<{ status: string }>(w, "SELECT status FROM people.students WHERE id = $1", [sid]))[0]!.status).toBe("SUSPENDED");
  });

  it("tenancy : un modèle de pack (ou le repli livré) est fourni", () => {
    expect(w.ports.councils.templates!.getSection("CI")).toBeTruthy();
  });
});
