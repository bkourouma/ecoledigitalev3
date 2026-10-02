/**
 * Monde de test : deps du module avec ports EN MÉMOIRE, horloge figée, audit enregistré, et un établissement prêt à l'emploi
 * (année, période, classe, élèves avec résultats FIGÉS DE DÉMONSTRATION, direction, secrétariat, enseignants, tuteur, élève) dont les
 * référentiels viennent du MODÈLE DE PACK livré (instanciation idempotente). Aucune valeur réglementaire : tout est de démonstration.
 */
import { ManualClock, createRequestContext, newId, unwrap, type RequestContext } from "@ecoledigitale/kernel";
import type { CouncilsCouncilDto } from "@ecoledigitale/contracts/src/v2/councils";
import { createCouncilsDeps, type CallerCaps, type CouncilsDeps } from "../../application/deps";
import { RecordingAudit } from "../../application/ports";
import { addParticipant, createCouncil, setPresence } from "../../application/councils";
import { instantiateCouncilsReferenceData } from "../../application/template";
import { inMemoryPorts, type InMemoryWorld } from "../../infrastructure/in-memory-ports";
import type { ResultsFacts } from "../../domain/facts";
import type { ModuleTestDb } from "./db";

export const DIRECTOR_CAPS: CallerCaps = {
  read: true,
  manage: true,
  prepare: true,
  sessionRun: true,
  proposalWrite: true,
  decisionRecord: true,
  minutesGenerate: true,
  minutesRead: true,
  minutesSign: true,
  minutesRevoke: true,
  unlockRequest: true,
  unlockApprove: true,
  effectManage: true,
  exclusionApply: true,
  settingsManage: true,
  orientationRead: true,
  orientationManage: true,
  orientationOverride: true,
};
export const SECRETARY_CAPS: CallerCaps = { read: true, manage: true, prepare: true, minutesGenerate: true, minutesRead: true, minutesSign: true, unlockRequest: true };
export const TEACHER_CAPS: CallerCaps = { proposalWrite: true };
export const GUARDIAN_CAPS: CallerCaps = { childRead: true };
export const PUPIL_CAPS: CallerCaps = { selfRead: true };

export interface Person {
  readonly userId: string;
  readonly staffId: string;
  readonly name: string;
  readonly ctx: RequestContext;
}

export interface Student {
  readonly studentId: string;
  readonly enrollmentId: string;
  readonly name: string;
}

export const SAMPLE_RESULTS = (suggest: { decision?: string; distinction?: string; appreciation?: string } = {}): ResultsFacts => ({
  status: "FINAL",
  average: "12.50",
  averageDisplay: "12,50",
  rank: 1,
  cohortSize: 4,
  mentionCode: "M1",
  missingResults: false,
  ruleVersionRef: "CI-SECONDARY-PLACEHOLDER@1",
  ruleSourceKind: "placeholder",
  suggestions: [
    ...(suggest.decision === undefined ? [{ kind: "DECISION" as const, code: "PROMOTED", ref: "CI-SECONDARY-PLACEHOLDER@1" }] : suggest.decision ? [{ kind: "DECISION" as const, code: suggest.decision, ref: "CI-SECONDARY-PLACEHOLDER@1" }] : []),
    ...(suggest.distinction ? [{ kind: "DISTINCTION" as const, code: suggest.distinction, ref: "CI-SECONDARY-PLACEHOLDER@1" }] : []),
    ...(suggest.appreciation ? [{ kind: "APPRECIATION" as const, code: suggest.appreciation, ref: "CI-SECONDARY-PLACEHOLDER@1" }] : []),
  ],
  appreciations: [],
});

export interface TestWorld {
  readonly db: ModuleTestDb;
  readonly deps: CouncilsDeps;
  readonly clock: ManualClock;
  readonly audit: RecordingAudit;
  readonly ports: InMemoryWorld;
  readonly tenantId: string;
  readonly institutionId: string;
  readonly yearId: string;
  readonly periodId: string;
  readonly classroomId: string;
  readonly otherClassroomId: string;
  readonly stateId: string;
  readonly yearStateId: string;
  readonly students: Student[];
  readonly director: Person;
  readonly director2: Person;
  readonly secretary: Person;
  readonly homeroom: Person;
  readonly teacher: Person;
  readonly outsiderTeacher: Person;
  readonly guardian: { userId: string; ctx: RequestContext };
  readonly otherGuardian: { userId: string; ctx: RequestContext };
  readonly pupil: { userId: string; ctx: RequestContext };
  readonly types: Readonly<Record<"PERIOD" | "YEAR", string>>;
  readonly decisionTypes: Readonly<Record<string, string>>;
  readonly programId: string;
  readonly gradeLevelId: string;
  person(name: string): Person;
  systemCtx(): RequestContext;
  ctxOf(userId: string): RequestContext;
}

export async function makeWorld(db: ModuleTestDb, startsAt = "2026-11-02T08:00:00.000Z"): Promise<TestWorld> {
  const clock = new ManualClock(startsAt);
  const audit = new RecordingAudit();
  const ports = inMemoryPorts();
  const deps = createCouncilsDeps({ db: db.tenantDb, clock, audit, ports });
  const tenantId = await db.createTenant(`t-${newId().slice(-10)}`);
  const institutionId = newId();
  const yearId = newId();
  const periodId = newId();
  const classroomId = newId();
  const otherClassroomId = newId();
  const programId = newId();
  const gradeLevelId = newId();
  const stateId = newId();
  const yearStateId = newId();

  ports.addClassroom({ classroomId, name: "6e A", institutionId, academicYearId: yearId, gradeLevelId, gradeLevelCode: "6E", programId, active: true });
  ports.addClassroom({ classroomId: otherClassroomId, name: "5e B", institutionId, academicYearId: yearId, gradeLevelId, gradeLevelCode: "5E", programId, active: true });
  ports.addPeriod({ periodId, academicYearId: yearId, label: "Trimestre 1", startsOn: "2026-09-01", endsOn: "2026-12-20" });
  ports.setState(classroomId, periodId, { stateId, status: "GRADING_LOCKED", ruleVersionRef: "CI-SECONDARY-PLACEHOLDER@1", ruleSourceKind: "placeholder" });
  ports.setState(classroomId, null, { stateId: yearStateId, status: "GRADING_LOCKED", ruleVersionRef: "CI-SECONDARY-PLACEHOLDER@1", ruleSourceKind: "placeholder" });
  ports.setAllowedYearEndCodes(["PROMOTED", "REPEAT", "EXAM_REFERRAL"]);

  const person = (name: string): Person => {
    const userId = newId();
    const staffId = newId();
    ports.linkUserToStaff(userId, staffId, name);
    return { userId, staffId, name, ctx: createRequestContext({ tenantId, userId, roles: [] }) };
  };
  const director = person("Directeur A");
  const director2 = person("Directeur B");
  const secretary = person("Secrétaire C");
  const homeroom = person("Professeur principal D");
  const teacher = person("Enseignant E");
  const outsiderTeacher = person("Enseignant F");
  ports.addAssignment(classroomId, { staffId: homeroom.staffId, displayName: homeroom.name, assignmentRole: "HOMEROOM", coversAllSubjects: false });
  ports.addAssignment(classroomId, { staffId: teacher.staffId, displayName: teacher.name, assignmentRole: "LEAD", coversAllSubjects: false });
  ports.addAssignment(otherClassroomId, { staffId: outsiderTeacher.staffId, displayName: outsiderTeacher.name, assignmentRole: "LEAD", coversAllSubjects: false });

  const students: Student[] = [];
  for (let i = 1; i <= 4; i += 1) {
    const studentId = newId();
    const enrollmentId = newId();
    const name = `Élève ${String(i).padStart(2, "0")}`;
    ports.addEnrollment({ enrollmentId, studentId, classroomId, institutionId, academicYearId: yearId, programId, gradeLevelId, active: true, displayName: name });
    ports.setResultsFacts(enrollmentId, SAMPLE_RESULTS());
    students.push({ studentId, enrollmentId, name });
  }
  const guardianUser = newId();
  const otherGuardianUser = newId();
  const pupilUser = newId();
  const first = students[0] as Student;
  ports.addGuardian(guardianUser, first.studentId);
  ports.addGuardian(otherGuardianUser, (students[1] as Student).studentId);
  ports.linkStudentUser(pupilUser, first.studentId);

  const directorCtx = director.ctx;
  const template = unwrap(await instantiateCouncilsReferenceData(deps, directorCtx, { institutionId }));
  void template;
  // identifiants des types livrés (données du modèle de pack)
  const { getReference } = await import("../../application/reference");
  const ref = unwrap(await getReference(deps, directorCtx));
  const typeId = (code: string): string => (ref.councilTypes.find((t) => t.code === code) as { id: string }).id;
  const decisionTypes = Object.fromEntries(ref.decisionTypes.map((t) => [t.code, t.id]));

  return {
    db,
    deps,
    clock,
    audit,
    ports,
    tenantId,
    institutionId,
    yearId,
    periodId,
    classroomId,
    otherClassroomId,
    stateId,
    yearStateId,
    students,
    director,
    director2,
    secretary,
    homeroom,
    teacher,
    outsiderTeacher,
    guardian: { userId: guardianUser, ctx: createRequestContext({ tenantId, userId: guardianUser, roles: [] }) },
    otherGuardian: { userId: otherGuardianUser, ctx: createRequestContext({ tenantId, userId: otherGuardianUser, roles: [] }) },
    pupil: { userId: pupilUser, ctx: createRequestContext({ tenantId, userId: pupilUser, roles: [] }) },
    types: { PERIOD: typeId("PERIOD_COUNCIL"), YEAR: typeId("YEAR_END_COUNCIL") },
    decisionTypes,
    programId,
    gradeLevelId,
    person,
    systemCtx: () => createRequestContext({ tenantId, actor: "system", roles: [] }),
    ctxOf: (userId) => createRequestContext({ tenantId, userId, roles: [] }),
  };
}

export interface FreshClass {
  readonly classroomId: string;
  readonly periodId: string;
  readonly students: Student[];
}

/** Classe supplémentaire (autre séance possible : un seul conseil vivant par classe, type et période), avec ses élèves et ses résultats. */
export function freshClassroom(w: TestWorld, options: { students?: number; teachers?: Person[] } = {}): FreshClass {
  const classroomId = newId();
  const periodId = newId();
  w.ports.addClassroom({ classroomId, name: `Classe ${classroomId.slice(0, 4)}`, institutionId: w.institutionId, academicYearId: w.yearId, gradeLevelId: w.gradeLevelId, gradeLevelCode: "6E", programId: w.programId, active: true });
  w.ports.addPeriod({ periodId, academicYearId: w.yearId, label: "Trimestre 2", startsOn: "2027-01-05", endsOn: "2027-03-30" });
  w.ports.setState(classroomId, periodId, { stateId: newId(), status: "GRADING_LOCKED", ruleVersionRef: "CI-SECONDARY-PLACEHOLDER@1", ruleSourceKind: "placeholder" });
  w.ports.setState(classroomId, null, { stateId: newId(), status: "GRADING_LOCKED", ruleVersionRef: "CI-SECONDARY-PLACEHOLDER@1", ruleSourceKind: "placeholder" });
  for (const t of options.teachers ?? []) w.ports.addAssignment(classroomId, { staffId: t.staffId, displayName: t.name, assignmentRole: "LEAD", coversAllSubjects: false });
  const students: Student[] = [];
  for (let i = 1; i <= (options.students ?? 0); i += 1) {
    const studentId = newId();
    const enrollmentId = newId();
    const name = `Élève ${String(i).padStart(2, "0")} (${classroomId.slice(0, 4)})`;
    w.ports.addEnrollment({ enrollmentId, studentId, classroomId, institutionId: w.institutionId, academicYearId: w.yearId, programId: w.programId, gradeLevelId: w.gradeLevelId, active: true, displayName: name });
    w.ports.setResultsFacts(enrollmentId, SAMPLE_RESULTS());
    students.push({ studentId, enrollmentId, name });
  }
  return { classroomId, periodId, students };
}

/** Séance sur une classe donnée avec les participants habituels (tous présents sauf indication contraire). */
export async function councilOn(
  w: TestWorld,
  cls: FreshClass,
  options: { scope?: "PERIOD" | "YEAR"; typeId?: string; present?: boolean; roles?: Array<{ person: Person; roleCode: string; fn?: "PRESIDENT" | "SECRETARY" }> } = {},
): Promise<CouncilsCouncilDto> {
  const scope = options.scope ?? "PERIOD";
  const council = unwrap(await createCouncil(w.deps, w.director.ctx, { classroomId: cls.classroomId, ...(scope === "PERIOD" ? { academicPeriodId: cls.periodId } : {}), councilTypeId: options.typeId ?? (scope === "PERIOD" ? w.types.PERIOD : w.types.YEAR) }));
  const roles = options.roles ?? [
    { person: w.director, roleCode: "PRESIDENT", fn: "PRESIDENT" as const },
    { person: w.secretary, roleCode: "SECRETARY", fn: "SECRETARY" as const },
    { person: w.homeroom, roleCode: "HOMEROOM_TEACHER" },
    { person: w.teacher, roleCode: "TEACHER" },
  ];
  for (const r of roles) {
    const p = unwrap(await addParticipant(w.deps, w.director.ctx, council.id, { roleCode: r.roleCode, staffId: r.person.staffId, ...(r.fn ? { councilFunction: r.fn } : {}) }));
    if (options.present !== false) unwrap(await setPresence(w.deps, w.director.ctx, council.id, p.id, "PRESENT"));
  }
  return council;
}

/** Séance de période planifiée : président (direction), secrétaire, professeur principal, enseignant — tous présents. */
export async function plannedCouncil(w: TestWorld, options: { scope?: "PERIOD" | "YEAR"; present?: boolean } = {}): Promise<CouncilsCouncilDto> {
  const scope = options.scope ?? "PERIOD";
  const council = unwrap(await createCouncil(w.deps, w.director.ctx, { classroomId: w.classroomId, ...(scope === "PERIOD" ? { academicPeriodId: w.periodId } : {}), councilTypeId: scope === "PERIOD" ? w.types.PERIOD : w.types.YEAR, scheduledAt: "2026-11-10T10:00:00.000Z", location: "Salle des professeurs" }));
  const add = async (p: Person, roleCode: string, fn?: "PRESIDENT" | "SECRETARY"): Promise<string> => {
    const r = unwrap(await addParticipant(w.deps, w.director.ctx, council.id, { roleCode, staffId: p.staffId, ...(fn ? { councilFunction: fn } : {}) }));
    if (options.present !== false) unwrap(await setPresence(w.deps, w.director.ctx, council.id, r.id, "PRESENT"));
    return r.id;
  };
  await add(w.director, "PRESIDENT", "PRESIDENT");
  await add(w.secretary, "SECRETARY", "SECRETARY");
  await add(w.homeroom, "HOMEROOM_TEACHER");
  await add(w.teacher, "TEACHER");
  return council;
}
