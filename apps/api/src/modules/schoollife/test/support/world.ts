/**
 * Monde de test : deps du module avec ports EN MÉMOIRE, horloge figée, audit enregistré, et une « école » prête à l'emploi
 * (établissement, année, périodes, classe, élèves, tuteurs, enseignants, direction) + types d'événements de DÉMONSTRATION
 * (aucune valeur réglementaire : les types sont des données de test).
 */
import { ManualClock, createRequestContext, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import { createSchoolLifeDeps, type CallerCaps, type SchoolLifeDeps } from "../../application/deps";
import { RecordingAudit } from "../../application/ports";
import { upsertEventType, upsertSettings, upsertSeverity } from "../../application/reference";
import { inMemoryPorts, type InMemoryWorld } from "../../infrastructure/in-memory-ports";
import type { ModuleTestDb } from "./db";

export const DIRECTOR_CAPS_BASE: CallerCaps = {
  read: true,
  readAll: true,
  restrictedRead: true,
  confidentialRead: true,
  incidentWrite: true,
  incidentReview: true,
  measurePropose: true,
  measureValidate: true,
  exclusionValidate: true,
  exclusionApply: true,
  measureRevoke: true,
  appealFile: true,
  appealDecide: true,
  noteWrite: true,
  convocationManage: true,
  conductManage: true,
  conductAdjust: true,
  settingsManage: true,
};

/** Direction : tout, y compris la permission d'approbation propre à un type. */
export const DIRECTOR_CAPS: CallerCaps = { ...DIRECTOR_CAPS_BASE, can: async () => true };
/** Éducateur : saisie, instruction, proposition, convocations ; ni validation ni lecture restreinte. */
export const EDUCATOR_CAPS: CallerCaps = { read: true, readAll: true, incidentWrite: true, incidentReview: true, measurePropose: true, noteWrite: true, convocationManage: true };
/** Enseignant : déclare et rédige pour SES classes ; niveau standard. */
export const TEACHER_CAPS: CallerCaps = { read: true, incidentWrite: true, noteWrite: true };
export const GUARDIAN_CAPS: CallerCaps = { childRead: true, childAppeal: true, childAcknowledge: true };
export const PUPIL_CAPS: CallerCaps = { selfRead: true, selfAppeal: true };

export interface Student {
  readonly studentId: string;
  readonly enrollmentId: string;
  readonly name: string;
}

export interface Person {
  readonly userId: string;
  readonly ctx: RequestContext;
}

export interface TestWorld {
  readonly db: ModuleTestDb;
  readonly deps: SchoolLifeDeps;
  readonly clock: ManualClock;
  readonly audit: RecordingAudit;
  readonly ports: InMemoryWorld;
  readonly tenantId: string;
  readonly institutionId: string;
  readonly yearId: string;
  readonly termId: string;
  readonly classroomId: string;
  readonly otherClassroomId: string;
  readonly students: Student[];
  /** Élève d'une autre classe (hors périmètre de l'enseignant). */
  readonly outsiderStudent: Student;
  readonly educator: Person;
  readonly teacher: Person;
  readonly otherTeacher: Person;
  readonly director: Person;
  readonly director2: Person;
  readonly guardian: Person & { guardianId: string };
  readonly otherGuardian: Person & { guardianId: string };
  readonly pupil: Person;
  readonly types: Readonly<Record<"INC" | "SECRET_INC" | "WARN" | "SANC" | "HIDDEN_SANC" | "EXCL" | "ENC" | "OBS" | "SECRET_OBS", string>>;
  readonly severities: { readonly LOW: string; readonly HIGH: string };
  person(): Person;
  /** Contexte d'un acteur arbitraire du tenant du monde. */
  ctxOf(userId: string, options?: { actor?: "user" | "system" }): RequestContext;
  systemCtx(): RequestContext;
}

export async function makeWorld(db: ModuleTestDb, startsAt = "2026-11-02T08:00:00.000Z"): Promise<TestWorld> {
  const clock = new ManualClock(startsAt);
  const audit = new RecordingAudit();
  const ports = inMemoryPorts();
  const deps = createSchoolLifeDeps({ db: db.tenantDb, clock, audit, ports });
  const tenantId = await db.createTenant(`t-${newId().slice(-10)}`);
  const institutionId = newId();
  const yearId = newId();
  const termId = newId();
  const classroomId = newId();
  const otherClassroomId = newId();
  ports.periods.add({ periodId: termId, academicYearId: yearId, startsOn: "2026-09-01", endsOn: "2026-12-20" });
  const gradeLevelId = newId();

  const students: Student[] = [];
  const enroll = (name: string, classId: string): Student => {
    const studentId = newId();
    const enrollmentId = newId();
    ports.enrollments.add({ enrollmentId, studentId, classroomId: classId, institutionId, academicYearId: yearId, gradeLevelId, active: true });
    ports.people.addStudent(studentId, name);
    return { studentId, enrollmentId, name };
  };
  for (let i = 1; i <= 4; i += 1) students.push(enroll(`Élève ${String(i).padStart(2, "0")}`, classroomId));
  const outsiderStudent = enroll("Élève Autre Classe", otherClassroomId);

  const person = (): Person => {
    const userId = newId();
    return { userId, ctx: createRequestContext({ tenantId, userId, roles: [] }) };
  };
  const educator = person();
  const teacher = person();
  const otherTeacher = person();
  const director = person();
  const director2 = person();
  const pupilUser = person();
  ports.people.nameUser(educator.userId, "Mme Éducatrice");
  ports.people.nameUser(teacher.userId, "M. Enseignant");
  ports.people.nameUser(director.userId, "Directeur A");
  ports.people.nameUser(director2.userId, "Directeur B");
  ports.people.assignTeacher(teacher.userId, classroomId, students.map((s) => s.studentId));
  ports.people.assignTeacher(otherTeacher.userId, otherClassroomId, [outsiderStudent.studentId]);

  const guardianUser = person();
  const otherGuardianUser = person();
  const guardianId = newId();
  const otherGuardianId = newId();
  const first = students[0] as Student;
  ports.people.addGuardian(first.studentId, { guardianId, userId: guardianUser.userId, displayName: "Parent Un" });
  ports.people.addGuardian(first.studentId, { guardianId: newId(), userId: null, displayName: "Tuteur sans compte" });
  ports.people.addGuardian((students[1] as Student).studentId, { guardianId: otherGuardianId, userId: otherGuardianUser.userId, displayName: "Parent Deux" });
  ports.people.addStudent(first.studentId, first.name, pupilUser.userId);
  ports.people.nameUser(guardianUser.userId, "Parent Un");
  ports.people.nameUser(otherGuardianUser.userId, "Parent Deux");
  ports.people.nameUser(pupilUser.userId, "Élève Un");

  const world: TestWorld = {
    db,
    deps,
    clock,
    audit,
    ports,
    tenantId,
    institutionId,
    yearId,
    termId,
    classroomId,
    otherClassroomId,
    students,
    outsiderStudent,
    educator,
    teacher,
    otherTeacher,
    director,
    director2,
    guardian: { ...guardianUser, guardianId },
    otherGuardian: { ...otherGuardianUser, guardianId: otherGuardianId },
    pupil: pupilUser,
    types: {} as TestWorld["types"],
    severities: { LOW: "LOW", HIGH: "HIGH" },
    person,
    ctxOf: (userId, options) => createRequestContext({ tenantId, ...(options?.actor === "system" ? {} : { userId }), actor: options?.actor ?? "user", roles: [] }),
    systemCtx: () => createRequestContext({ tenantId, actor: "system", roles: [] }),
  };

  // Types de DÉMONSTRATION (données de test) : aucun n'existe dans le code livré.
  const dir = director.ctx;
  unwrap(await upsertSeverity(deps, dir, { code: "LOW", label: "Faible", rank: 1, active: true }));
  unwrap(await upsertSeverity(deps, dir, { code: "HIGH", label: "Élevée", rank: 2, active: true }));
  const base = { requiresValidation: false, requiresFourEyes: false, notifyGuardians: false, visibleToGuardians: true, confidentialityDefault: "STANDARD" as const, appealable: false, isPlaceholder: true, sortOrder: 0, active: true };
  const type = async (code: string, kind: Parameters<typeof upsertEventType>[2]["kind"], extra: Partial<Parameters<typeof upsertEventType>[2]> = {}): Promise<string> =>
    unwrap(await upsertEventType(deps, dir, { ...base, code, label: `Type ${code}`, kind, ...extra })).id;
  const types: Record<string, string> = {
    INC: await type("INC", "INCIDENT"),
    SECRET_INC: await type("SECRET_INC", "INCIDENT", { confidentialityDefault: "CONFIDENTIAL", visibleToGuardians: false }),
    WARN: await type("WARN", "WARNING"),
    SANC: await type("SANC", "SANCTION", { requiresValidation: true, requiresFourEyes: true, appealable: true, notifyGuardians: true, approverPermission: "schoollife.measure.validate" }),
    HIDDEN_SANC: await type("HIDDEN_SANC", "SANCTION", { requiresValidation: true, visibleToGuardians: false }),
    EXCL: await type("EXCL", "TEMP_EXCLUSION", { requiresValidation: true, requiresFourEyes: true, appealable: true, notifyGuardians: true }),
    ENC: await type("ENC", "ENCOURAGEMENT"),
    OBS: await type("OBS", "OBSERVATION", { visibleToGuardians: false, confidentialityDefault: "RESTRICTED" }),
    SECRET_OBS: await type("SECRET_OBS", "OBSERVATION", { visibleToGuardians: false, confidentialityDefault: "CONFIDENTIAL" }),
  };
  (world as { types: TestWorld["types"] }).types = types as TestWorld["types"];
  unwrap(await upsertSettings(deps, dir, { institutionId }));
  return world;
}

/** Activation des points de conduite et barème de DÉMONSTRATION (jamais réglementaire). */
export async function enableConduct(world: TestWorld, itemsByType: Record<string, number>, scale: { initial?: number; min?: number | null; max?: number | null; reset?: "PERIOD" | "YEAR" | "NEVER" } = {}): Promise<string> {
  const { createScale, setScaleItems, activateScale } = await import("../../application/conduct");
  const dir = world.director.ctx;
  unwrap(await upsertSettings(world.deps, dir, { institutionId: world.institutionId, conductPointsEnabled: true }));
  const created = unwrap(
    await createScale(world.deps, dir, {
      institutionId: world.institutionId,
      code: `DEMO_${newId().slice(-6).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`,
      label: "Barème de démonstration",
      initialPoints: scale.initial ?? 20,
      minPoints: scale.min === undefined ? 0 : scale.min,
      maxPoints: scale.max === undefined ? 20 : scale.max,
      resetScope: scale.reset ?? "YEAR",
      effectiveFrom: "2026-09-01",
      sourceKind: "placeholder",
    }),
  );
  unwrap(await setScaleItems(world.deps, dir, created.id, Object.entries(itemsByType).map(([k, v]) => ({ eventTypeId: world.types[k as keyof TestWorld["types"]], pointsDelta: v }))));
  unwrap(await activateScale(world.deps, dir, created.id));
  return created.id;
}
