/**
 * Vie scolaire assemblée sur Postgres réel avec les VRAIS adaptateurs (academic + people + attendance + notifications ->
 * schoollife) : inscription et niveau réels, tutelle et périmètre d'enseignant réels, convocation mise en file par le module
 * `notifications`, suspension d'un élève par `people` UNIQUEMENT sur un acte humain, vue d'assiduité en lecture seule.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestContext, createSystemContext, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { createGuardian, linkGuardian } from "../../src/modules/people";
import { RecordingAudit, applyEffect, createConvocation, createSchoolLifeDeps, declareIncident, getFamilyLife, getStudentLife, notifyMeasure, proposeMeasure, sendConvocation, upsertEventType, validateMeasure, type CallerCaps, type SchoolLifeDeps } from "../../src/modules/schoollife";
import { describeIntegration } from "../helpers/fixtures";
import { adminRows, createAssemblyWorld, seedHigherSchool, type AssemblyWorld, type HigherSchool } from "./support/world";

const DIRECTION: CallerCaps = {
  read: true, readAll: true, restrictedRead: true, confidentialRead: true, incidentWrite: true, incidentReview: true, measurePropose: true, measureValidate: true,
  exclusionValidate: true, exclusionApply: true, measureRevoke: true, appealFile: true, appealDecide: true, noteWrite: true, convocationManage: true,
  conductManage: true, conductAdjust: true, settingsManage: true, can: async () => true,
};
const TEACHER: CallerCaps = { read: true, incidentWrite: true, noteWrite: true };
const PARENT: CallerCaps = { childRead: true, childAppeal: true, childAcknowledge: true };

describeIntegration("schoollife : adaptateurs réels (academic, people, attendance, notifications)", () => {
  let w: AssemblyWorld;
  let school: HigherSchool;
  let deps: SchoolLifeDeps;
  let audit: RecordingAudit;
  const parentUser = newId();
  const director2 = newId();
  const sys = (): RequestContext => createSystemContext(w.tenantId);
  const types: Record<string, string> = {};

  beforeAll(async () => {
    w = await createAssemblyWorld();
    school = await seedHigherSchool(w, { pupils: 2 });
    const p1 = school.pupils[0]!;
    // Tuteur AVEC compte (lien vivant) et tuteur SANS compte.
    const payer = unwrap(await createGuardian(w.kit.people, w.director, { person: { lastName: "PARENT", firstName: "Un", sex: "F", birthDate: "1975-05-05", email: "parent@famille.example.test", phone: "0707070707" } })).guardian;
    await w.db.admin.query("UPDATE people.persons SET identity_id = $2 WHERE id = $1", [payer.personId, parentUser]);
    unwrap(await linkGuardian(w.kit.people, w.director, p1.studentId, { guardianId: payer.id, relationshipCode: "FATHER", isFinancialResponsible: true }));
    audit = new RecordingAudit();
    deps = createSchoolLifeDeps({ db: w.tenantDb, clock: w.clock, audit, ports: w.ports.schoollife });
    const base = { requiresValidation: false, requiresFourEyes: false, notifyGuardians: false, visibleToGuardians: true, confidentialityDefault: "STANDARD" as const, appealable: false, isPlaceholder: true, sortOrder: 0, active: true };
    types.WARN = unwrap(await upsertEventType(deps, w.director, { ...base, code: "WARN", label: "Avertissement (test)", kind: "WARNING" })).id;
    types.INC = unwrap(await upsertEventType(deps, w.director, { ...base, code: "INC", label: "Incident (test)", kind: "INCIDENT" })).id;
    types.EXCL = unwrap(await upsertEventType(deps, w.director, { ...base, code: "EXCL", label: "Exclusion (test)", kind: "TEMP_EXCLUSION", requiresValidation: true, requiresFourEyes: true, requiresDates: true, notifyGuardians: true })).id;
  }, 300_000);
  afterAll(async () => {
    await w?.drop();
  });

  it("academic : inscription, niveau de la classe, effectif ; people : périmètre d'enseignant et tutelle relus à chaque appel", async () => {
    const p1 = school.pupils[0]!;
    const e = await w.ports.schoollife.enrollments!.getEnrollment(sys(), p1.enrollmentId);
    expect(e).toMatchObject({ enrollmentId: p1.enrollmentId, studentId: p1.studentId, classroomId: school.ref.classroomId, active: true });
    expect(e?.gradeLevelId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await w.ports.schoollife.enrollments!.getEnrollment(sys(), newId())).toBeNull();
    expect((await w.ports.schoollife.enrollments!.listEnrollmentsOfStudent(sys(), p1.studentId)).map((x) => x.enrollmentId)).toEqual([p1.enrollmentId]);
    const today = new Date().toISOString().slice(0, 10);
    expect((await w.ports.schoollife.enrollments!.getRoster(sys(), school.ref.classroomId, today)).map((r) => r.studentId).sort()).toEqual(school.pupils.map((p) => p.studentId).sort());
    const people = w.ports.schoollife.people!;
    expect(await people.staffCanReadStudent(school.teacher.ctx, p1.studentId)).toBe(true);
    expect(await people.staffCanReadStudent(createRequestContext({ tenantId: w.tenantId, userId: newId(), roles: [] }), p1.studentId)).toBe(false);
    expect(await people.isStaffAssignedToClassroom(school.teacher.ctx, school.teacher.ctx.userId as string, school.ref.classroomId)).toBe(true);
    expect(await people.isGuardianOfStudent(sys(), parentUser, p1.studentId)).toBe(true);
    expect(await people.isGuardianOfStudent(sys(), parentUser, school.pupils[1]!.studentId)).toBe(false);
    expect(await people.listChildrenOfGuardian(sys(), parentUser)).toEqual([p1.studentId]);
    const guardians = await people.listGuardiansOfStudent(sys(), p1.studentId);
    expect(guardians).toEqual([expect.objectContaining({ userId: parentUser, displayName: expect.stringContaining("PARENT") })]);
    expect((await people.getStudentNames(sys(), [p1.studentId])).get(p1.studentId)).toContain("ETUDIANT1");
  });

  it("parcours réel : incident par l'enseignant de la classe, avertissement, dossier avec VUE d'assiduité (lecture seule), vue parent", async () => {
    const p1 = school.pupils[0]!;
    const inc = unwrap(await declareIncident(deps, school.teacher.ctx, TEACHER, { typeId: types.INC!, occurredAt: new Date().toISOString(), description: "Fait de test", involvements: [{ enrollmentId: p1.enrollmentId, role: "AUTHOR" }] }));
    expect(inc.reportedBy).toBe(school.teacher.ctx.userId);
    // enseignant d'une autre classe / sans affectation : introuvable
    const stranger = createRequestContext({ tenantId: w.tenantId, userId: newId(), roles: [] });
    const refused = await declareIncident(deps, stranger, TEACHER, { typeId: types.INC!, occurredAt: new Date().toISOString(), description: "Hors périmètre", involvements: [{ enrollmentId: p1.enrollmentId, role: "AUTHOR" }] });
    expect(refused.ok).toBe(false);
    const warn = unwrap(await proposeMeasure(deps, w.director, DIRECTION, { enrollmentId: p1.enrollmentId, typeId: types.WARN!, reason: "Avertissement pour comportement" }));
    expect(warn.status).toBe("VALIDATED");
    const life = unwrap(await getStudentLife(deps, w.director, DIRECTION, { studentId: p1.studentId }));
    expect(life.attendance).toMatchObject({ available: true, absences: [] }); // vue réelle d'attendance : rien n'est copié ici
    expect(life.incidents).toHaveLength(1);
    expect(life.studentName).toContain("ETUDIANT1");
    const tables = await adminRows<{ table_name: string }>(w, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'schoollife' AND (table_name ILIKE '%absence%' OR table_name ILIKE '%late%' OR table_name ILIKE '%attendance%')");
    expect(tables).toEqual([]); // retards et absences ne sont jamais dupliqués
    const parent = createRequestContext({ tenantId: w.tenantId, userId: parentUser, roles: [] });
    const family = unwrap(await getFamilyLife(deps, parent, PARENT, { audience: "GUARDIAN", studentId: p1.studentId }));
    expect(family.items.map((i) => i.entityKind)).not.toContain("INCIDENT");
    const other = await getFamilyLife(deps, parent, PARENT, { audience: "GUARDIAN", studentId: school.pupils[1]!.studentId });
    expect(other.ok).toBe(false); // hors lien : 404
  });

  it("convocation : le module `notifications` met réellement en file la remise ; le motif disciplinaire n'est jamais dans le message", async () => {
    const p1 = school.pupils[0]!;
    const noon = new Date(w.clock.now());
    noon.setUTCHours(12, 0, 0, 0);
    w.clock.set(noon);
    const c = unwrap(await createConvocation(deps, w.director, DIRECTION, { enrollmentId: p1.enrollmentId, reasonKind: "DISCIPLINE", reason: "Entretien confidentiel suite à une sanction", scheduledAt: "2027-01-12T09:30:00Z", location: "Bureau de la direction" }));
    expect(c.guardianIds).toHaveLength(1);
    const sent = unwrap(await sendConvocation(deps, w.director, DIRECTION, c.id, { channels: ["IN_APP", "EMAIL"] }));
    expect(sent.status).toBe("SENT");
    const rows = await adminRows<{ template_code: string; channel: string; status: string; content: string | null }>(
      w,
      "SELECT template_code, channel, status, content::text AS content FROM notifications.deliveries WHERE template_code = 'convocation' ORDER BY created_at",
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r) => r.status === "PENDING")).toBe(true);
    const rendered = JSON.stringify(rows);
    expect(rendered).toMatch(/Bureau de la direction/);
    expect(rendered).not.toMatch(/Entretien confidentiel|sanction/);
    // un nouvel envoi de la même convocation est refusé (le statut suit la réalité)
    const again = await sendConvocation(deps, w.director, DIRECTION, c.id, { channels: ["IN_APP"] });
    expect(again.ok).toBe(false);
  });

  it("exclusion : l'effet reste AWAITING_HUMAN ; seul l'acte d'un humain suspend l'élève dans `people` (acteur système refusé)", async () => {
    const p2 = school.pupils[1]!;
    const proposer = ctxOfUser(newId());
    const ex = unwrap(await proposeMeasure(deps, proposer, { ...DIRECTION, can: async () => true }, { enrollmentId: p2.enrollmentId, typeId: types.EXCL!, reason: "Faits graves établis", startsOn: "2027-01-18", endsOn: "2027-01-20" }));
    const validator = ctxOfUser(director2);
    unwrap(await validateMeasure(deps, validator, DIRECTION, ex.id, {}));
    const effects = await adminRows<{ id: string; status: string }>(w, "SELECT id, status FROM schoollife.measure_effects WHERE measure_id = $1", [ex.id]);
    expect(effects).toEqual([{ id: expect.any(String), status: "AWAITING_HUMAN" }]);
    expect((await adminRows<{ status: string }>(w, "SELECT status FROM people.students WHERE id = $1", [p2.studentId]))[0]!.status).toBe("ACTIVE");
    const system = await applyEffect(deps, sys(), DIRECTION, effects[0]!.id, { status: "SUSPENDED" });
    expect(system.ok).toBe(false);
    const applied = unwrap(await applyEffect(deps, validator, DIRECTION, effects[0]!.id, { status: "SUSPENDED" }));
    expect(applied.status).toBe("APPLIED");
    expect((await adminRows<{ status: string }>(w, "SELECT status FROM people.students WHERE id = $1", [p2.studentId]))[0]!.status).toBe("SUSPENDED");
    expect(await adminRows(w, "SELECT 1 FROM people.student_status_history WHERE student_id = $1 AND to_status = 'SUSPENDED'", [p2.studentId])).toHaveLength(1);
    // notification de la mesure : aucun tuteur lié à cet élève -> refus explicite, la mesure reste VALIDATED
    const notify = await notifyMeasure(deps, validator, DIRECTION, ex.id);
    expect(notify.ok).toBe(false);
    expect(audit.actions()).toContain("schoollife.exclusion_effect.applied");
  });

  function ctxOfUser(userId: string): RequestContext {
    return createRequestContext({ tenantId: w.tenantId, userId, roles: [], mfa: true });
  }
});
