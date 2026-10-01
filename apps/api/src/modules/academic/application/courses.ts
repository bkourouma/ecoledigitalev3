/**
 * Sélections de cours (options, inscription à la carte, reprise de dette, rattrapage) : éligibilité dans l'ORDRE
 * FIGÉ de la spec, réservation de place avec expiration, confirmation, annulation, achèvement, libre-service.
 *
 * Même contrôle pour TOUS les chemins (catalogue, administrateur, libre-service, validation finale) : l'administrateur
 * n'est plus exempté (bug legacy) ; une dérogation est un `override` motivé, audité, qui ne dépasse jamais la capacité.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { AcademicAddCourseBody, AcademicOverride } from "@ecoledigitale/contracts/src/v2/academic";
import { ancestorsOf } from "../domain/curriculum";
import { courseConfirmationPolicyFor, initialCourseStatus } from "../domain/enrollment";
import { AcademicCode, conflict, notFound, validation } from "../domain/errors";
import { AcademicEvents } from "../domain/events";
import { applyOverride, evaluateEligibility, type EligibilityFacts, type EligibilityResult } from "../domain/offering";
import type { Classroom, CurriculumNode, Enrollment, EnrollmentCourse, InstitutionSettings, Offering } from "../domain/records";
import * as cal from "../infrastructure/calendar-repository";
import * as classroomsRepo from "../infrastructure/classroom-repository";
import * as cur from "../infrastructure/curriculum-repository";
import * as enr from "../infrastructure/enrollment-repository";
import { mapDbError } from "../infrastructure/db-errors";
import * as ref from "../infrastructure/reference-repository";
import { loadClassroomInScope } from "./calendar";
import { EventBuffer, inReadTx, inTx, type AcademicDeps } from "./deps";
import { cancelCourseInTx, confirmCourseInTx, coursePayload, emitOfferingChange, loadCourseInScope, loadEnrollmentInScope, offeringStatusOf, writeHistory } from "./enrollment-core";
import { checkStudentEnrollable, createEnrollmentInTx } from "./enrollments";
import { hasValidated, prerequisiteStatusInTx } from "./curriculum";
import { loadSettings } from "./reference";

// ---------------------------------------------------------------------------
// Éligibilité
// ---------------------------------------------------------------------------

export interface EligibilityReport extends EligibilityResult {
  offeringId: string;
  studentId: string;
  missingPrerequisiteDetails: Array<{ lineageId: string; nodeId: string | null; code: string | null; label: string | null }>;
}

async function periodStateOfNode(tx: Tx, classroom: Classroom, node: CurriculumNode, nodes: readonly CurriculumNode[], slotCodes: ReadonlySet<string>): Promise<EligibilityFacts["periodState"]> {
  // Nœud de période = le nœud lui-même ou son ancêtre le plus proche dont le type porte un créneau de période.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain = [node, ...ancestorsOf(node.id, byId).map((id) => byId.get(id) as CurriculumNode)];
  const slotNode = chain.find((n) => slotCodes.has(n.nodeTypeCode) && n.periodTypeCode !== null && n.periodOrdinal !== null);
  if (!slotNode) return null;
  const period = await cal.findPeriodBySlot(tx, classroom.academicYearId, slotNode.periodTypeCode as string, slotNode.periodOrdinal as number);
  if (!period) return null;
  const eff = await cal.effectiveState(tx, classroom.id, period.id);
  return eff ? eff.state : null;
}

async function buildFacts(
  deps: AcademicDeps,
  ctx: RequestContext,
  tx: Tx,
  input: { offering: Offering; classroom: Classroom; studentId: string },
): Promise<{ facts: EligibilityFacts; node: CurriculumNode; missing: Array<{ lineageId: string; nodeId: string | null; code: string | null; label: string | null }> } | null> {
  const { offering, classroom, studentId } = input;
  const node = await cur.getNode(tx, offering.curriculumNodeId);
  if (!node) return null;
  const nodes = await cur.listNodes(tx, node.versionId);
  const types = await ref.listNodeTypes(tx);
  const slotCodes = new Set(types.filter((t) => t.requiresPeriodSlot).map((t) => t.code));
  const prereq = await prerequisiteStatusInTx(deps, tx, ctx, studentId, node);
  const facts: EligibilityFacts = {
    offering: { status: offering.status, capacity: offering.capacity, registrationOpensAt: offering.registrationOpensAt, registrationClosesAt: offering.registrationClosesAt },
    periodState: await periodStateOfNode(tx, classroom, node, nodes, slotCodes),
    now: deps.clock.now(),
    hasLiveDuplicate: await enr.hasLiveDuplicate(tx, studentId, classroom.academicYearId, node.id),
    heldByOthers: await enr.heldByOthers(tx, offering.id, studentId),
    missingPrerequisites: prereq.missing.map((m) => m.lineageId),
    alreadyCompleted: await hasValidated(deps, tx, ctx, studentId, node.lineageId),
  };
  return { facts, node, missing: prereq.missing };
}

/** Éligibilité d'un apprenant à une offre (lecture pure). */
export async function checkOfferingEligibility(deps: AcademicDeps, ctx: RequestContext, input: { offeringId: string; studentId: string }): Promise<Result<EligibilityReport, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const offering = await classroomsRepo.getOffering(tx, input.offeringId);
    if (!offering) return err(notFound(AcademicCode.OFFERING_NOT_FOUND, "Offre", input.offeringId));
    const c = await loadClassroomInScope(tx, ctx, offering.classroomId);
    if (!c.ok) return err(notFound(AcademicCode.OFFERING_NOT_FOUND, "Offre", input.offeringId));
    const built = await buildFacts(deps, ctx, tx, { offering, classroom: c.value, studentId: input.studentId });
    if (!built) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", offering.curriculumNodeId));
    const result = evaluateEligibility(built.facts);
    return ok({ ...result, offeringId: offering.id, studentId: input.studentId, missingPrerequisiteDetails: built.missing });
  });
}

/** Évalue l'éligibilité dans une transaction ouverte (catalogue). */
export async function evaluateForStudent(deps: AcademicDeps, ctx: RequestContext, tx: Tx, offering: Offering, classroom: Classroom, studentId: string): Promise<EligibilityResult> {
  const built = await buildFacts(deps, ctx, tx, { offering, classroom, studentId });
  if (!built) {
    return { eligible: false, failure: { code: AcademicCode.OFFERING_NOT_OPEN, message: "Offre indisponible.", overridable: false }, missingPrerequisites: [], warnings: [], remainingPlaces: null };
  }
  return evaluateEligibility(built.facts);
}

function failureToError(report: EligibilityResult, missing: EligibilityReport["missingPrerequisiteDetails"]): AppError {
  const f = report.failure as NonNullable<EligibilityResult["failure"]>;
  return conflict(f.code, f.message, { overridable: f.overridable, ...(missing.length > 0 ? { missing } : {}) });
}

// ---------------------------------------------------------------------------
// Ajout d'une sélection
// ---------------------------------------------------------------------------

export interface AddCourseResult {
  course: EnrollmentCourse;
  warnings: Array<{ code: string; message: string }>;
}

async function nodeInScopeOfInstitution(tx: Tx, ctx: RequestContext, nodeId: string): Promise<Result<CurriculumNode, AppError>> {
  const node = await cur.getNode(tx, nodeId);
  if (!node) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", nodeId));
  const version = await cur.getVersion(tx, node.versionId);
  const program = version ? await cur.getProgram(tx, version.programId) : null;
  if (!program || (ctx.institutionId && program.institutionId !== ctx.institutionId)) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", nodeId));
  return ok(node);
}

/** Expiration PARESSEUSE de MES réservations échues sur ce nœud : libère la place avant un nouvel ajout (pas de blocage jusqu'au job). */
async function expireOwnStaleHolds(deps: AcademicDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, enrollment: Enrollment, nodeId: string): Promise<void> {
  for (const stale of await enr.listOwnExpiredHoldsForNode(tx, enrollment.id, nodeId)) {
    await cancelCourseInTx(deps, ctx, tx, events, { course: stale, enrollment, reason: "hold_expired", event: AcademicEvents.COURSE_EXPIRED });
  }
}

/** Ajoute une sélection dans une transaction DÉJÀ ouverte (réutilisé par le libre-service). */
export async function addCourseInTx(
  deps: AcademicDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  enrollment: Enrollment,
  input: { curriculumNodeId?: string | undefined; offeringId?: string | undefined; source?: AcademicAddCourseBody["source"]; override?: AcademicOverride | undefined; settings?: InstitutionSettings },
): Promise<Result<AddCourseResult, AppError>> {
  if (enrollment.status !== "PENDING" && enrollment.status !== "ACTIVE") {
    return err(conflict(AcademicCode.ENROLLMENT_TRANSITION, `L'inscription est ${enrollment.status} : on n'y ajoute plus de cours.`, { status: enrollment.status }));
  }
  const settings = input.settings ?? (await loadSettings(tx, enrollment.institutionId));
  const source = input.source ?? (input.offeringId ? "A_LA_CARTE" : "OPTION");
  const warnings: AddCourseResult["warnings"] = [];
  let nodeId = input.curriculumNodeId ?? null;
  let offering: Offering | null = null;
  let holdExpiresAt: string | null = null;
  let overrideBypassed: string[] = [];

  if (input.override && input.override.reason.trim().length < 5) {
    return err(validation(AcademicCode.OVERRIDE_REASON_REQUIRED, "Une dérogation exige un motif de 5 caractères minimum.", "override.reason"));
  }

  if (input.offeringId) {
    offering = await classroomsRepo.getOffering(tx, input.offeringId);
    if (!offering) return err(notFound(AcademicCode.OFFERING_NOT_FOUND, "Offre", input.offeringId));
    if (nodeId && nodeId !== offering.curriculumNodeId) return err(validation(AcademicCode.COURSE_OFFERING_NODE_MISMATCH, "Le nœud ne correspond pas à l'offre.", "curriculumNodeId"));
    nodeId = offering.curriculumNodeId;
  }
  if (!nodeId) return err(validation(AcademicCode.INVALID_INPUT, "Un nœud de curriculum ou une offre est requis.", "curriculumNodeId"));

  const node = await nodeInScopeOfInstitution(tx, ctx, nodeId);
  if (!node.ok) return node;
  if (node.value.isTransversal && source === "A_LA_CARTE") return err(validation(AcademicCode.COURSE_TRANSVERSAL, "Une matière transversale ne s'achète pas à la carte.", "curriculumNodeId"));
  if (node.value.status !== "ACTIVE") return err(validation(AcademicCode.OFFERING_NODE_INACTIVE, "Le nœud est inactif.", "curriculumNodeId"));

  await expireOwnStaleHolds(deps, ctx, tx, events, enrollment, nodeId);

  if (source === "A_LA_CARTE") {
    if (enrollment.mode !== "A_LA_CARTE") return err(conflict(AcademicCode.ENROLLMENT_MODE_MISMATCH, "L'inscription à la carte exige une inscription de mode « à la carte »."));
    if (!offering) return err(validation(AcademicCode.INVALID_INPUT, "Une inscription à la carte désigne une offre.", "offeringId"));
    if (offering.classroomId !== enrollment.classroomId) return err(validation(AcademicCode.COURSE_OFFERING_OTHER_CLASS, "L'offre n'appartient pas à la classe de l'inscription.", "offeringId"));
    const classroom = (await classroomsRepo.getClassroom(tx, offering.classroomId)) as Classroom;
    const fresh = (await classroomsRepo.getOffering(tx, offering.id)) as Offering;
    const built = await buildFacts(deps, ctx, tx, { offering: fresh, classroom, studentId: enrollment.studentId });
    if (!built) return err(notFound(AcademicCode.NODE_NOT_FOUND, "Nœud de curriculum", nodeId));
    const verdict = applyOverride(built.facts, input.override);
    if (!verdict.allowed) {
      if (verdict.result.eligible) {
        // Seul l'avertissement « déjà validée » subsiste : il exige une dérogation motivée.
        return err(conflict(AcademicCode.ALREADY_COMPLETED, "Cette unité est déjà validée : une dérogation motivée est requise pour la suivre à nouveau.", { overridable: true }));
      }
      return err(failureToError(verdict.result, built.missing));
    }
    overrideBypassed = verdict.bypassed;
    for (const w of verdict.result.warnings) warnings.push({ code: w.code, message: w.message });
    if (settings.pendingHoldMinutes !== null) holdExpiresAt = new Date(deps.clock.now().getTime() + settings.pendingHoldMinutes * 60_000).toISOString();
  } else if (offering && offering.status === "CANCELLED") {
    return err(conflict(AcademicCode.OFFERING_NOT_OPEN, "L'offre est annulée."));
  }

  const policy = courseConfirmationPolicyFor(source, settings.courseConfirmationPolicy);
  const status = initialCourseStatus(policy, enrollment.status);
  const before = await offeringStatusOf(tx, offering?.id ?? null);
  const id = deps.newId();
  await enr.insertCourse(tx, { id, enrollmentId: enrollment.id, curriculumNodeId: nodeId, offeringId: offering?.id ?? null, source, status, holdExpiresAt: status === "PENDING" ? holdExpiresAt : null, requestedAt: deps.clock.now().toISOString() });
  const course = (await enr.getCourse(tx, id)) as EnrollmentCourse;
  const reasonText = input.override ? `dérogation : ${input.override.reason.trim()}` : null;
  await writeHistory(deps, ctx, tx, enrollment.id, { kind: "COURSE", from: null, to: { courseId: id, nodeId, source, status, offeringId: offering?.id ?? null, ...(overrideBypassed.length > 0 ? { overrideBypassed } : {}) }, reason: reasonText });
  events.add(AcademicEvents.COURSE_REQUESTED, coursePayload(enrollment, course, node.value, reasonText), { type: "enrollment_course", id });
  if (status === "CONFIRMED") events.add(AcademicEvents.COURSE_CONFIRMED, coursePayload(enrollment, course, node.value, "politique de confirmation"), { type: "enrollment_course", id });
  if (input.override) {
    events.audit({
      action: "academic.enrollment.override",
      resourceType: "enrollment_course",
      resourceId: id,
      sensitive: true,
      reason: input.override.reason.trim(),
      metadata: { enrollmentId: enrollment.id, bypassed: overrideBypassed, offeringId: offering?.id ?? null },
    });
  }
  await emitOfferingChange(tx, events, offering?.id ?? null, before);

  if (offering) {
    const conflicts = await deps.ports.schedule.checkStudentOffering(ctx, { enrollmentId: enrollment.id, offeringId: offering.id });
    for (const c of conflicts.conflicts) warnings.push({ code: "academic.schedule_conflict", message: c.description });
  }
  return ok({ course, warnings });
}

export async function addEnrollmentCourse(deps: AcademicDeps, ctx: RequestContext, enrollmentId: string, input: AcademicAddCourseBody): Promise<Result<AddCourseResult, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadEnrollmentInScope(tx, ctx, enrollmentId, true);
    if (!l.ok) return l;
    const events = new EventBuffer(deps, ctx);
    const r = await addCourseInTx(deps, ctx, tx, events, l.value, input);
    if (!r.ok) return r;
    await events.flush(tx);
    return r;
  });
}

/**
 * API du registre d'inscriptions aux cours (`course_registrations`, consommée par 011 / `higher`) : inscrit à un
 * nœud en option, reprise de dette ou rattrapage, avec motif.
 */
export async function registerCourse(
  deps: AcademicDeps,
  ctx: RequestContext,
  input: { enrollmentId: string; curriculumNodeId: string; offeringId?: string | null | undefined; kind: "OPTION" | "CARRY_OVER" | "RESIT"; reason?: string | undefined },
): Promise<Result<AddCourseResult, AppError>> {
  return addEnrollmentCourse(deps, ctx, input.enrollmentId, {
    curriculumNodeId: input.curriculumNodeId,
    ...(input.offeringId ? { offeringId: input.offeringId } : {}),
    source: input.kind,
  });
}

// ---------------------------------------------------------------------------
// Libre-service (AC5.1c) : s'inscrire soi-même à une offre ouverte
// ---------------------------------------------------------------------------

export async function selfEnrollToOffering(deps: AcademicDeps, ctx: RequestContext, input: { offeringId: string }): Promise<Result<AddCourseResult & { enrollment: Enrollment }, AppError>> {
  if (!ctx.userId) return err(validation(AcademicCode.STUDENT_NOT_FOUND, "Le libre-service exige un utilisateur.", "actor"));
  const lookup = deps.ports.students.findStudentByUserId;
  const mine = lookup ? await lookup.call(deps.ports.students, ctx, ctx.userId) : null;
  if (!mine) return err(notFound(AcademicCode.STUDENT_NOT_FOUND, "Dossier apprenant de l'utilisateur"));
  const student = await checkStudentEnrollable(deps, ctx, mine.studentId);
  if (!student.ok) return student;

  return inTx(deps, ctx, async (tx) => {
    const offering = await classroomsRepo.getOffering(tx, input.offeringId);
    if (!offering) return err(notFound(AcademicCode.OFFERING_NOT_FOUND, "Offre", input.offeringId));
    const c = await loadClassroomInScope(tx, ctx, offering.classroomId);
    if (!c.ok) return err(notFound(AcademicCode.OFFERING_NOT_FOUND, "Offre", input.offeringId));
    const events = new EventBuffer(deps, ctx);
    // Une inscription par (apprenant, classe) : on réutilise la vivante, sinon on la crée en mode « à la carte ».
    let enrollment = await enr.findLiveEnrollmentInClass(tx, student.value.studentId, c.value.id);
    if (enrollment && enrollment.mode !== "A_LA_CARTE") return err(conflict(AcademicCode.ENROLLMENT_MODE_MISMATCH, "Vous êtes déjà inscrit dans cette classe en inscription de classe."));
    if (!enrollment) {
      const created = await createEnrollmentInTx(deps, ctx, tx, events, { studentId: student.value.studentId, classroomId: c.value.id, mode: "A_LA_CARTE", sourceKind: "ONLINE" }, student.value);
      if (!created.ok) return created;
      enrollment = created.value;
    }
    const added = await addCourseInTx(deps, ctx, tx, events, enrollment, { offeringId: input.offeringId, source: "A_LA_CARTE" });
    if (!added.ok) return added;
    await events.flush(tx);
    return ok({ ...added.value, enrollment });
  });
}

// ---------------------------------------------------------------------------
// Confirmation, annulation, achèvement
// ---------------------------------------------------------------------------

export type ConfirmOutcome = { kind: "confirmed" | "reinstated"; course: EnrollmentCourse } | { kind: "orphan"; course: EnrollmentCourse };

/**
 * Confirme une sélection (`PENDING -> CONFIRMED`). Si sa réservation a expiré entre-temps, la place a pu être reprise :
 * on la rétablit (nouvelle sélection) si elle existe encore ; sinon `orphan` (finance décide du remboursement).
 */
export async function confirmCourseInTxWithReinstate(
  deps: AcademicDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  course: EnrollmentCourse,
  enrollment: Enrollment,
  reason: string | null,
): Promise<Result<ConfirmOutcome, AppError>> {
  if (enrollment.status !== "ACTIVE" && enrollment.status !== "COMPLETED") {
    return err(conflict(AcademicCode.COURSE_ENROLLMENT_NOT_ACTIVE, `L'inscription est ${enrollment.status} : confirmez-la d'abord.`, { status: enrollment.status }));
  }
  const expired = course.status === "PENDING" && course.holdExpiresAt !== null && new Date(course.holdExpiresAt).getTime() <= deps.clock.now().getTime();
  if (course.status === "PENDING" && !expired) {
    await confirmCourseInTx(deps, ctx, tx, events, { course, enrollment, reason });
    return ok({ kind: "confirmed", course: (await enr.getCourse(tx, course.id)) as EnrollmentCourse });
  }
  if (course.status === "PENDING" || course.status === "CANCELLED") return reinstateCourse(deps, ctx, tx, events, course, enrollment, reason);
  return err(conflict(AcademicCode.COURSE_TRANSITION, `La sélection est ${course.status} : elle ne peut pas être confirmée.`, { from: course.status, to: "CONFIRMED" }));
}

/** Rétablit une sélection annulée/expirée : nouvelle ligne `CONFIRMED` si la place existe encore, sinon `orphan`. */
async function reinstateCourse(deps: AcademicDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, course: EnrollmentCourse, enrollment: Enrollment, reason: string | null): Promise<Result<ConfirmOutcome, AppError>> {
  if (course.status === "PENDING") await cancelCourseInTx(deps, ctx, tx, events, { course, enrollment, reason: "hold_expired", event: AcademicEvents.COURSE_EXPIRED });
  const id = deps.newId();
  const before = await offeringStatusOf(tx, course.offeringId);
  try {
    await tx.transaction(async (sp) => {
      await enr.insertCourse(sp, { id, enrollmentId: enrollment.id, curriculumNodeId: course.curriculumNodeId, offeringId: course.offeringId, source: course.source, status: "CONFIRMED", holdExpiresAt: null, requestedAt: deps.clock.now().toISOString() });
    });
  } catch (e) {
    // Plus de place (ou nœud pris ailleurs) : l'encaissement ne se perd pas en silence.
    if (!mapDbError(e)) throw e;
    return ok({ kind: "orphan", course });
  }
  const created = (await enr.getCourse(tx, id)) as EnrollmentCourse;
  const node = await cur.getNode(tx, course.curriculumNodeId);
  await writeHistory(deps, ctx, tx, enrollment.id, { kind: "COURSE", from: { courseId: course.id, status: course.status }, to: { courseId: id, nodeId: course.curriculumNodeId, status: "CONFIRMED" }, reason: reason ?? "rétablie après paiement" });
  events.add(AcademicEvents.COURSE_REQUESTED, coursePayload(enrollment, created, node, "rétablie après paiement"), { type: "enrollment_course", id });
  events.add(AcademicEvents.COURSE_CONFIRMED, coursePayload(enrollment, created, node, "rétablie après paiement"), { type: "enrollment_course", id });
  await emitOfferingChange(tx, events, course.offeringId, before);
  return ok({ kind: "reinstated", course: created });
}

export async function confirmEnrollmentCourse(deps: AcademicDeps, ctx: RequestContext, id: string, reason?: string | null): Promise<Result<ConfirmOutcome, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadCourseInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const events = new EventBuffer(deps, ctx);
    const r = await confirmCourseInTxWithReinstate(deps, ctx, tx, events, l.value.course, l.value.enrollment, reason ?? null);
    if (!r.ok) return r;
    // Confirmation manuelle d'une réservation expirée dont la place a été reprise : refus explicite et réessayable.
    if (r.value.kind === "orphan") return err(conflict(AcademicCode.OFFERING_FULL, "La réservation a expiré et la place n'est plus disponible.", { enrollmentCourseId: id }));
    await events.flush(tx);
    return r;
  });
}

export async function cancelEnrollmentCourse(deps: AcademicDeps, ctx: RequestContext, id: string, reason: string): Promise<Result<EnrollmentCourse, AppError>> {
  const why = reason?.trim() ?? "";
  if (why.length < 5) return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const l = await loadCourseInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const { course, enrollment } = l.value;
    if (course.status !== "PENDING" && course.status !== "CONFIRMED") return err(conflict(AcademicCode.COURSE_TRANSITION, `La sélection est ${course.status} : elle ne peut pas être annulée.`, { from: course.status, to: "CANCELLED" }));
    const events = new EventBuffer(deps, ctx);
    await cancelCourseInTx(deps, ctx, tx, events, { course, enrollment, reason: why, event: AcademicEvents.COURSE_CANCELLED });
    await events.flush(tx);
    return ok((await enr.getCourse(tx, id)) as EnrollmentCourse);
  });
}

/** `CONFIRMED -> COMPLETED` : l'unité est terminée/validée (appelé par 011 / 019). Définitif. */
export async function completeEnrollmentCourse(deps: AcademicDeps, ctx: RequestContext, input: { enrollmentCourseId: string; completedAt?: string | undefined; outcomeRef?: string | null | undefined }): Promise<Result<EnrollmentCourse, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadCourseInScope(tx, ctx, input.enrollmentCourseId, true);
    if (!l.ok) return l;
    const { course, enrollment } = l.value;
    if (course.status !== "CONFIRMED") return err(conflict(AcademicCode.COURSE_TRANSITION, `La sélection est ${course.status} : seule une sélection confirmée s'achève.`, { from: course.status, to: "COMPLETED" }));
    await enr.setCourseStatus(tx, course.id, { status: "COMPLETED", completedAt: input.completedAt ?? null });
    await writeHistory(deps, ctx, tx, enrollment.id, { kind: "COURSE", from: { courseId: course.id, status: "CONFIRMED" }, to: { courseId: course.id, nodeId: course.curriculumNodeId, status: "COMPLETED", outcomeRef: input.outcomeRef ?? null }, reason: null });
    const updated = (await enr.getCourse(tx, course.id)) as EnrollmentCourse;
    const node = await cur.getNode(tx, course.curriculumNodeId);
    const events = new EventBuffer(deps, ctx);
    events.add(AcademicEvents.COURSE_COMPLETED, coursePayload(enrollment, updated, node, null), { type: "enrollment_course", id: course.id });
    await events.flush(tx);
    return ok(updated);
  });
}

export async function listEnrollmentCourses(deps: AcademicDeps, ctx: RequestContext, enrollmentId: string): Promise<Result<EnrollmentCourse[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const e = await loadEnrollmentInScope(tx, ctx, enrollmentId);
    if (!e.ok) return e;
    return ok(await enr.listCourses(tx, enrollmentId));
  });
}

// ---------------------------------------------------------------------------
// Job `academic.expire-holds` (AC5.4)
// ---------------------------------------------------------------------------

/** Passe en `CANCELLED` (motif `hold_expired`) les réservations échues, libère la place et republie `…expired`. */
export async function expirePendingHolds(deps: AcademicDeps, ctx: RequestContext, options: { limit?: number } = {}): Promise<Result<{ expired: string[] }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const expired: string[] = [];
    const events = new EventBuffer(deps, ctx);
    for (const course of await enr.listExpiredHolds(tx, options.limit ?? 500)) {
      const enrollment = await enr.getEnrollment(tx, course.enrollmentId);
      if (!enrollment) continue;
      await cancelCourseInTx(deps, ctx, tx, events, { course, enrollment, reason: "hold_expired", event: AcademicEvents.COURSE_EXPIRED });
      expired.push(course.id);
    }
    await events.flush(tx);
    return ok({ expired });
  });
}
