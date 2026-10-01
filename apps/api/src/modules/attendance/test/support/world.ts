/**
 * Monde de test : deps du module avec ports EN MÉMOIRE, horloge figée, audit enregistré, et une « école » prête à
 * l'emploi (établissement, année, périodes imbriquées, classe, enseignants, élèves, parents).
 */
import { ManualClock, newId, createRequestContext, type RequestContext } from "@ecoledigitale/kernel";
import { createAttendanceDeps, type AttendanceDeps, type CallerCaps } from "../../application/deps";
import { RecordingAudit, type OccurrenceInfo } from "../../application/ports";
import { inMemoryPorts, type InMemoryWorld } from "../../infrastructure/in-memory-ports";
import type { AttendanceTestDb } from "./db";

export interface TestWorld {
  readonly deps: AttendanceDeps;
  readonly clock: ManualClock;
  readonly audit: RecordingAudit;
  readonly ports: InMemoryWorld;
}

export function makeWorld(db: AttendanceTestDb, startsAt = "2025-10-01T08:00:00.000Z"): TestWorld {
  const clock = new ManualClock(startsAt);
  const audit = new RecordingAudit();
  const ports = inMemoryPorts();
  const deps = createAttendanceDeps({ db: db.tenantDb, clock, audit, ports });
  return { deps, clock, audit, ports };
}

export interface Student {
  readonly studentId: string;
  readonly enrollmentId: string;
  readonly name: string;
}

export interface School {
  readonly tenantId: string;
  readonly institutionId: string;
  readonly yearId: string;
  readonly classroomId: string;
  readonly nodeId: string;
  /** Semestre 1 (parent) et trimestre 1 (enfant) : périodes imbriquées. */
  readonly semesterId: string;
  readonly termId: string;
  readonly students: Student[];
  readonly teacher: { userId: string; staffId: string; ctx: RequestContext };
  readonly coTeacher: { userId: string; staffId: string; ctx: RequestContext };
  readonly outsider: { userId: string; staffId: string; ctx: RequestContext };
  readonly admin: { userId: string; ctx: RequestContext };
  readonly guardian: { userId: string; ctx: RequestContext; studentId: string };
  readonly otherGuardian: { userId: string; ctx: RequestContext };
  readonly pupil: { userId: string; ctx: RequestContext; studentId: string };
}

export const CAPS = {
  teacher: { } as CallerCaps,
  admin: { manage: true, validate: true, reopen: true, justificationDecide: true, justificationRead: true, justificationSubmit: true, staffRecord: true, staffRead: true, leaveDecide: true, leaveRequest: true, settingsManage: true } as CallerCaps,
  guardian: { childJustify: true } as CallerCaps,
  pupil: { selfJustify: true } as CallerCaps,
};

export async function seedSchool(db: AttendanceTestDb, world: TestWorld, options: { students?: number } = {}): Promise<School> {
  const tenantId = await db.createTenant();
  const institutionId = newId();
  const yearId = newId();
  const classroomId = newId();
  const nodeId = newId();
  const semesterId = newId();
  const termId = newId();
  const { ports } = world;

  ports.roster.addClassroom({ classroomId, institutionId, academicYearId: yearId, educationLevelCode: "SECONDARY_1", active: true });
  ports.periods.add({ periodId: semesterId, academicYearId: yearId, startsOn: "2025-09-01", endsOn: "2026-01-31", parentPeriodId: null });
  ports.periods.add({ periodId: termId, academicYearId: yearId, startsOn: "2025-09-01", endsOn: "2025-12-20", parentPeriodId: semesterId });

  const students: Student[] = [];
  for (let i = 0; i < (options.students ?? 5); i += 1) {
    const studentId = newId();
    const enrollmentId = newId();
    const name = `Élève ${String(i + 1).padStart(2, "0")}`;
    ports.roster.addEnrollment({
      enrollmentId, studentId, classroomId, institutionId, academicYearId: yearId, active: true,
      academicYearStart: "2025-09-01", academicYearEnd: "2026-06-30", names: name,
    });
    ports.people.addStudent(studentId, name);
    students.push({ studentId, enrollmentId, name });
  }

  const person = (staffName: string) => {
    const userId = newId();
    const staffId = newId();
    ports.people.addStaff(staffId, userId, staffName);
    return { userId, staffId, ctx: createRequestContext({ tenantId, userId, roles: ["enseignant"] }) };
  };
  const teacher = person("Mme Koné");
  const coTeacher = person("M. Traoré");
  const outsider = person("M. Diallo");
  ports.people.assign(teacher.staffId, classroomId);

  const adminId = newId();
  const guardianId = newId();
  const otherGuardianId = newId();
  const pupilId = newId();
  const first = students[0] as Student;
  ports.people.addGuardian(guardianId, first.studentId);
  ports.people.addStudentUser(pupilId, first.studentId);

  return {
    tenantId, institutionId, yearId, classroomId, nodeId, semesterId, termId, students, teacher, coTeacher, outsider,
    admin: { userId: adminId, ctx: createRequestContext({ tenantId, userId: adminId, roles: ["directeur"], mfa: true }) },
    guardian: { userId: guardianId, ctx: createRequestContext({ tenantId, userId: guardianId, roles: ["parent"] }), studentId: first.studentId },
    otherGuardian: { userId: otherGuardianId, ctx: createRequestContext({ tenantId, userId: otherGuardianId, roles: ["parent"] }) },
    pupil: { userId: pupilId, ctx: createRequestContext({ tenantId, userId: pupilId, roles: ["eleve"] }), studentId: first.studentId },
  };
}

let seq = 0;
/** Ajoute une occurrence planifiée de 60 min ; l'enseignant `teacher` et `coTeacher` en sont intervenants par défaut. */
export function addOccurrence(world: TestWorld, school: School, patch: Partial<OccurrenceInfo> = {}): OccurrenceInfo {
  seq += 1;
  const date = patch.date ?? "2025-10-01";
  const hour = 8 + (seq % 8);
  const startsAt = patch.startsAt ?? new Date(`${date}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  const occurrence: OccurrenceInfo = {
    occurrenceId: newId(),
    classroomId: school.classroomId,
    institutionId: school.institutionId,
    academicYearId: school.yearId,
    curriculumNodeId: school.nodeId,
    offeringId: null,
    date,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60_000),
    durationMinutes: 60,
    status: "PLANNED",
    staff: [
      { staffId: school.teacher.staffId, role: "LEAD" },
      { staffId: school.coTeacher.staffId, role: "CO_TEACHER" },
    ],
    ...patch,
  };
  world.ports.occurrences.add(occurrence);
  return occurrence;
}
