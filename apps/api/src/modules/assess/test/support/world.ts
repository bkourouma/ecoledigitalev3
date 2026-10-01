/**
 * Monde de test : un établissement (tenant) avec classe, période, matière, enseignants, direction, élèves et un tuteur,
 * branché sur les ports EN MÉMOIRE d'assess. Horloge manuelle, audit enregistré.
 */
import { ManualClock, newId, noopLogger, type RequestContext } from "@ecoledigitale/kernel";
import { createAssessDeps, type AssessCaps, type AssessDeps } from "../../application/deps";
import { instantiateAssessPack } from "../../application/types";
import { RecordingAudit } from "../../application/ports";
import { inMemoryPorts, type InMemoryWorld } from "../../infrastructure/in-memory-ports";
import type { AssessmentType } from "../../domain/types";
import { listAssessmentTypes } from "../../application/types";
import { ctxFor, type AssessTestDb } from "./db";

export interface TestWorld {
  deps: AssessDeps;
  clock: ManualClock;
  audit: RecordingAudit;
  ports: InMemoryWorld;
}

export function makeWorld(db: AssessTestDb, start = "2026-01-15T10:00:00.000Z"): TestWorld {
  const clock = new ManualClock(start);
  const audit = new RecordingAudit();
  const { world, ports } = inMemoryPorts();
  const deps = createAssessDeps({ db: db.tenantDb, clock, audit, ports, logger: noopLogger });
  return { deps, clock, audit, ports: world };
}

/** Capacités RBAC des profils de test. */
export const CAPS = {
  teacher: {} as AssessCaps,
  admin: { manage: true, review: true, validate: true, publish: true, reviseRequest: true, reviseApprove: true, typeManage: true } as AssessCaps,
  reviewer: { review: true } as AssessCaps,
  validator: { review: true, validate: true } as AssessCaps,
  publisher: { review: true, validate: true, publish: true } as AssessCaps,
  reviser: { reviseRequest: true } as AssessCaps,
  approver: { reviseApprove: true } as AssessCaps,
} as const;

export interface Person {
  userId: string;
  ctx: RequestContext;
  staffId: string;
}

export interface School {
  tenantId: string;
  classroomId: string;
  yearId: string;
  periodId: string;
  nodeId: string;
  nodeId2: string;
  teacher: Person;
  coTeacher: Person;
  director: Person;
  reviewer: Person;
  students: Array<{ enrollmentId: string; studentId: string }>;
  guardian: { userId: string; ctx: RequestContext; studentId: string };
  pupil: { userId: string; ctx: RequestContext; studentId: string };
  types: AssessmentType[];
  typeByCode(code: string): AssessmentType;
}

const person = (tenantId: string, roles: string[], world: TestWorld, mfa = false): Person => {
  const userId = newId();
  const staffId = newId();
  world.ports.teaching.staffByUser.set(userId, staffId);
  world.ports.names.names.set(userId, `Agent ${userId.slice(-4)}`);
  return { userId, ctx: ctxFor(tenantId, userId, roles, mfa), staffId };
};

export async function seedSchool(db: AssessTestDb, world: TestWorld, options: { students?: number; pack?: "classic" | "higher"; allowResit?: boolean } = {}): Promise<School> {
  const tenantId = await db.createTenant();
  const classroomId = newId();
  const yearId = newId();
  const periodId = newId();
  const nodeId = newId();
  const nodeId2 = newId();
  const teacher = person(tenantId, ["enseignant"], world);
  const coTeacher = person(tenantId, ["enseignant"], world);
  const director = person(tenantId, ["directeur"], world, true);
  const reviewer = person(tenantId, ["responsable_pedagogique"], world, true);

  world.ports.roster.classrooms.set(classroomId, { id: classroomId, academicYearId: yearId });
  world.ports.periods.periods.set(periodId, { id: periodId, academicYearId: yearId });
  world.ports.curriculum.nodes.set(nodeId, { id: nodeId, resitAllowed: options.allowResit ?? true });
  world.ports.curriculum.nodes.set(nodeId2, { id: nodeId2, resitAllowed: false });
  world.ports.teaching.assign(teacher.staffId, nodeId, classroomId);
  world.ports.teaching.assign(coTeacher.staffId, nodeId2, classroomId);

  const students = Array.from({ length: options.students ?? 5 }, () => ({ enrollmentId: newId(), studentId: newId() }));
  for (const s of students) world.ports.roster.enrollments.push({ enrollmentId: s.enrollmentId, studentId: s.studentId, classroomId, active: true });

  const guardianUser = newId();
  const pupilUser = newId();
  const first = students[0] as { enrollmentId: string; studentId: string };
  world.ports.guardianship.links.add(`${guardianUser}|${first.studentId}`);
  world.ports.guardianship.studentByUser.set(pupilUser, first.studentId);

  const seeded = await instantiateAssessPack(world.deps, director.ctx, { pack: options.pack === "higher" ? "HIGHER" : "PRIMARY" });
  if (!seeded.ok) throw seeded.error;
  const listed = await listAssessmentTypes(world.deps, director.ctx, { includeInactive: true });
  if (!listed.ok) throw listed.error;
  const types = listed.value;
  return {
    tenantId,
    classroomId,
    yearId,
    periodId,
    nodeId,
    nodeId2,
    teacher,
    coTeacher,
    director,
    reviewer,
    students,
    guardian: { userId: guardianUser, ctx: ctxFor(tenantId, guardianUser, ["parent"]), studentId: first.studentId },
    pupil: { userId: pupilUser, ctx: ctxFor(tenantId, pupilUser, ["eleve"]), studentId: first.studentId },
    types,
    typeByCode(code) {
      const t = types.find((x) => x.code === code);
      if (!t) throw new Error(`Type ${code} introuvable`);
      return t;
    },
  };
}
