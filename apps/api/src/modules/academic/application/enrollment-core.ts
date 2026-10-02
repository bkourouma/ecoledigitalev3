/**
 * Briques communes des inscriptions et des sélections de cours : chargement dans le périmètre, historique
 * (append-only), charges utiles d'événements, confirmation et annulation d'une sélection, suivi des changements de
 * statut d'offre posés par le déclencheur de capacité.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AcademicOfferingStatus } from "@ecoledigitale/contracts/src/v2/academic";
import { AcademicCode, notFound } from "../domain/errors";
import { AcademicEvents } from "../domain/events";
import type { HistoryDraft } from "../domain/enrollment";
import type { Classroom, CurriculumNode, Enrollment, EnrollmentCourse } from "../domain/records";
import * as classroomsRepo from "../infrastructure/classroom-repository";
import * as cur from "../infrastructure/curriculum-repository";
import * as enr from "../infrastructure/enrollment-repository";
import { EventBuffer, actorId, inScope, type AcademicDeps } from "./deps";

export async function loadEnrollmentInScope(tx: Tx, ctx: RequestContext, id: string, forUpdate = false): Promise<Result<Enrollment, AppError>> {
  const e = await enr.getEnrollment(tx, id, { forUpdate });
  if (!e || !inScope(ctx, e)) return err(notFound(AcademicCode.ENROLLMENT_NOT_FOUND, "Inscription", id));
  return ok(e);
}

export async function loadCourseInScope(tx: Tx, ctx: RequestContext, id: string, forUpdate = false): Promise<Result<{ course: EnrollmentCourse; enrollment: Enrollment }, AppError>> {
  const course = await enr.getCourse(tx, id, { forUpdate });
  if (!course) return err(notFound(AcademicCode.COURSE_NOT_FOUND, "Sélection de cours", id));
  const enrollment = await loadEnrollmentInScope(tx, ctx, course.enrollmentId, forUpdate);
  if (!enrollment.ok) return err(notFound(AcademicCode.COURSE_NOT_FOUND, "Sélection de cours", id));
  return ok({ course, enrollment: enrollment.value });
}

export async function writeHistory(deps: AcademicDeps, ctx: RequestContext, tx: Tx, enrollmentId: string, draft: HistoryDraft): Promise<void> {
  await enr.insertHistory(tx, { id: deps.newId(), enrollmentId, kind: draft.kind, from: draft.from, to: draft.to, reason: draft.reason, actorId: actorId(ctx) });
}

/** Faits de la classe que la projection de `people` ne peut pas relire (elle ne lit jamais le schéma d'academic). */
export type EnrollmentClassroomFacts = Pick<Classroom, "name" | "programId" | "gradeLevelId">;

export function enrollmentPayload(e: Enrollment, previousStatus: Enrollment["status"] | null, reason: string | null, classroom: EnrollmentClassroomFacts | null = null): Record<string, unknown> & { v: 1 } {
  return {
    v: 1,
    institutionId: e.institutionId,
    academicYearId: e.academicYearId,
    enrollmentId: e.id,
    studentId: e.studentId,
    classroomId: e.classroomId,
    ...(classroom ? { classroomName: classroom.name, programId: classroom.programId, gradeLevelId: classroom.gradeLevelId } : {}),
    enrolledOn: e.enrolledOn,
    status: e.status,
    previousStatus,
    mode: e.mode,
    fundingType: e.fundingType,
    registrationNumber: e.registrationNumber,
    reason,
  };
}

export function coursePayload(e: Enrollment, c: EnrollmentCourse, node: Pick<CurriculumNode, "lineageId" | "credits"> | null, reason: string | null = null): Record<string, unknown> & { v: 1 } {
  return {
    v: 1,
    institutionId: e.institutionId,
    academicYearId: e.academicYearId,
    enrollmentId: e.id,
    studentId: e.studentId,
    classroomId: e.classroomId,
    enrollmentCourseId: c.id,
    curriculumNodeId: c.curriculumNodeId,
    lineageId: node?.lineageId ?? c.curriculumNodeId,
    offeringId: c.offeringId,
    source: c.source,
    status: c.status,
    credits: node?.credits ?? null,
    holdExpiresAt: c.holdExpiresAt,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Sélections : confirmation et annulation (historique + événements + places libérées)
// ---------------------------------------------------------------------------

export async function offeringStatusOf(tx: Tx, offeringId: string | null): Promise<AcademicOfferingStatus | null> {
  if (!offeringId) return null;
  return (await classroomsRepo.getOffering(tx, offeringId))?.status ?? null;
}

/**
 * Le déclencheur `sync_offering_fullness` a pu faire basculer l'offre `OPEN <-> FULL` pendant l'opération :
 * on publie le changement (`academic.offering.full`, ou `academic.offering.opened` quand une place se libère).
 */
export async function emitOfferingChange(tx: Tx, events: EventBuffer, offeringId: string | null, before: AcademicOfferingStatus | null): Promise<void> {
  if (!offeringId || !before) return;
  const offering = await classroomsRepo.getOffering(tx, offeringId);
  if (!offering || offering.status === before) return;
  if (offering.status !== "FULL" && offering.status !== "OPEN") return;
  const classroom = (await classroomsRepo.getClassroom(tx, offering.classroomId)) as Classroom;
  const node = await cur.getNode(tx, offering.curriculumNodeId);
  events.add(
    offering.status === "FULL" ? AcademicEvents.OFFERING_FULL : AcademicEvents.OFFERING_OPENED,
    {
      v: 1,
      institutionId: classroom.institutionId,
      academicYearId: classroom.academicYearId,
      offeringId: offering.id,
      classroomId: offering.classroomId,
      curriculumNodeId: offering.curriculumNodeId,
      lineageId: node?.lineageId ?? null,
      status: offering.status,
      reason: offering.status === "OPEN" ? "place_freed" : null,
    },
    { type: "offering", id: offering.id },
  );
}

export async function confirmCourseInTx(
  deps: AcademicDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  input: { course: EnrollmentCourse; enrollment: Enrollment; reason: string | null },
): Promise<void> {
  const { course, enrollment } = input;
  await enr.setCourseStatus(tx, course.id, { status: "CONFIRMED" });
  await writeHistory(deps, ctx, tx, enrollment.id, { kind: "COURSE", from: { courseId: course.id, nodeId: course.curriculumNodeId, status: course.status }, to: { courseId: course.id, nodeId: course.curriculumNodeId, status: "CONFIRMED" }, reason: input.reason });
  const node = await cur.getNode(tx, course.curriculumNodeId);
  events.add(AcademicEvents.COURSE_CONFIRMED, coursePayload(enrollment, { ...course, status: "CONFIRMED" }, node, input.reason), { type: "enrollment_course", id: course.id });
}

export async function cancelCourseInTx(
  deps: AcademicDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  input: { course: EnrollmentCourse; enrollment: Enrollment; reason: string; event: typeof AcademicEvents.COURSE_CANCELLED | typeof AcademicEvents.COURSE_EXPIRED },
): Promise<void> {
  const { course, enrollment } = input;
  const before = await offeringStatusOf(tx, course.offeringId);
  await enr.setCourseStatus(tx, course.id, { status: "CANCELLED", reason: input.reason });
  await writeHistory(deps, ctx, tx, enrollment.id, { kind: "COURSE", from: { courseId: course.id, nodeId: course.curriculumNodeId, status: course.status }, to: { courseId: course.id, nodeId: course.curriculumNodeId, status: "CANCELLED" }, reason: input.reason });
  const node = await cur.getNode(tx, course.curriculumNodeId);
  events.add(input.event, coursePayload(enrollment, { ...course, status: "CANCELLED" }, node, input.reason), { type: "enrollment_course", id: course.id });
  await emitOfferingChange(tx, events, course.offeringId, before);
}
