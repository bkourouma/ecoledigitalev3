/**
 * Inscriptions : création (avec historique, financement, numéro d'inscription stable, confirmation selon la
 * politique de l'établissement), machine d'états, changement de classe, financement, issue de fin d'année.
 *
 * Un changement de classe ou d'année ne crée JAMAIS un nouvel élève : le dossier permanent (module people) ne
 * change pas, et l'`EnrollmentId` reste stable pour toute l'année.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type {
  AcademicEnrollBulkResult,
  AcademicEnrollStudentBody,
  AcademicRecordOutcomeBody,
} from "@ecoledigitale/contracts/src/v2/academic";
import { classroomAcceptsEnrollment } from "../domain/classroom";
import {
  ENROLLMENT_ACTIONS_REQUIRING_REASON,
  ENROLLMENT_ACTION_TARGETS,
  courseConfirmationPolicyFor,
  initialCourseStatus,
  initialEnrollmentStatus,
  manualConfirmationMode,
  normalizeFunding,
  OVERRIDE_REASON_MIN_LENGTH,
  statusHistory,
  validateEnrollmentAction,
  validateFunding,
  type EnrollmentAction,
} from "../domain/enrollment";
import { AcademicCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { AcademicEvents, ENROLLMENT_ACTION_EVENTS } from "../domain/events";
import { formatRegistrationNumber } from "../domain/registration-number";
import type { Classroom, Enrollment, EnrollmentCourse, HistoryEntry, InstitutionSettings, Placement } from "../domain/records";
import * as cal from "../infrastructure/calendar-repository";
import * as classroomsRepo from "../infrastructure/classroom-repository";
import * as cur from "../infrastructure/curriculum-repository";
import * as enr from "../infrastructure/enrollment-repository";
import * as ref from "../infrastructure/reference-repository";
import { loadClassroomInScope } from "./calendar";
import { EventBuffer, actorId, inReadTx, inTx, todayFor, type AcademicDeps } from "./deps";
import { cancelCourseInTx, confirmCourseInTx, enrollmentPayload, loadEnrollmentInScope, writeHistory } from "./enrollment-core";
import { loadSettings } from "./reference";
import type { StudentSummary } from "./ports";

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

export async function getEnrollment(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<Enrollment, AppError>> {
  return inReadTx(deps, ctx, (tx) => loadEnrollmentInScope(tx, ctx, id));
}

export async function getEnrollmentDetail(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
): Promise<Result<{ enrollment: Enrollment; courses: EnrollmentCourse[]; placements: Placement[] }, AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const e = await loadEnrollmentInScope(tx, ctx, id);
    if (!e.ok) return e;
    return ok({ enrollment: e.value, courses: await enr.listCourses(tx, id), placements: await enr.listPlacements(tx, id) });
  });
}

export async function listEnrollments(
  deps: AcademicDeps,
  ctx: RequestContext,
  filter: { institutionId?: string | null; academicYearId?: string | null; classroomId?: string | null; studentId?: string | null; status?: string | null; mode?: string | null; fundingType?: string | null; registrationNumber?: string | null; page?: number; pageSize?: number } = {},
): Promise<Result<{ items: Enrollment[]; total: number; page: number; pageSize: number }, AppError>> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? deps.config.defaultPageSize));
  return inReadTx(deps, ctx, async (tx) => {
    const r = await enr.listEnrollments(tx, {
      institutionId: filter.institutionId ?? ctx.institutionId ?? null,
      campusId: ctx.campusId ?? null,
      academicYearId: filter.academicYearId ?? null,
      classroomId: filter.classroomId ?? null,
      studentId: filter.studentId ?? null,
      status: filter.status ?? null,
      mode: filter.mode ?? null,
      fundingType: filter.fundingType ?? null,
      registrationNumber: filter.registrationNumber ?? null,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return ok({ ...r, page, pageSize });
  });
}

export async function listEnrollmentsByStudent(deps: AcademicDeps, ctx: RequestContext, studentId: string): Promise<Result<Enrollment[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => ok((await enr.listEnrollmentsByStudent(tx, studentId)).filter((e) => !ctx.institutionId || e.institutionId === ctx.institutionId)));
}

/** Historique restitué dans l'ordre : création, statuts, financement, placements, sélections, issue (AC4.7). */
export async function getEnrollmentHistory(deps: AcademicDeps, ctx: RequestContext, id: string): Promise<Result<HistoryEntry[], AppError>> {
  return inReadTx(deps, ctx, async (tx) => {
    const e = await loadEnrollmentInScope(tx, ctx, id);
    if (!e.ok) return e;
    return ok(await enr.listHistory(tx, id));
  });
}

// ---------------------------------------------------------------------------
// Numéro d'inscription (R23) : une fois par (apprenant, programme, niveau), stable aux réinscriptions
// ---------------------------------------------------------------------------

async function allocateRegistrationNumber(
  deps: AcademicDeps,
  tx: Tx,
  input: { classroom: Classroom; student: StudentSummary; settings: InstitutionSettings; yearStartsOn: string },
): Promise<Result<string | null, AppError>> {
  const pattern = input.settings.registrationNumberPattern;
  if (!pattern) return ok(null);
  const { classroom, student } = input;
  const existing = await enr.findRegistrationNumber(tx, classroom.institutionId, student.studentId, classroom.programId, classroom.gradeLevelId);
  if (existing) return ok(existing);
  if (student.sequenceNumber === null || student.sequenceNumber === undefined) {
    return err(validation(AcademicCode.REGISTRATION_SEQUENCE_MISSING, "Le dossier de l'apprenant n'a pas encore de numéro d'ordre : impossible de générer son numéro d'inscription.", "studentId"));
  }
  const program = await cur.getProgram(tx, classroom.programId);
  const grade = await ref.getGradeLevel(tx, classroom.gradeLevelId);
  let number: string;
  try {
    number = formatRegistrationNumber(pattern, {
      prefix: input.settings.registrationNumberPrefix,
      programCode: program?.code ?? "",
      gradeLevelCode: grade?.code ?? "",
      year: input.yearStartsOn.slice(0, 4),
      studentSeq: student.sequenceNumber,
    });
  } catch (e) {
    return err(validation(AcademicCode.REGISTRATION_PATTERN_INVALID, e instanceof Error ? e.message : "Motif de numéro d'inscription invalide.", "registrationNumberPattern"));
  }
  await enr.insertRegistrationNumber(tx, { id: deps.newId(), institutionId: classroom.institutionId, studentId: student.studentId, programId: classroom.programId, gradeLevelId: classroom.gradeLevelId, registrationNumber: number });
  // Deux créations concurrentes pour la même clé convergent : on relit le numéro retenu.
  return ok((await enr.findRegistrationNumber(tx, classroom.institutionId, student.studentId, classroom.programId, classroom.gradeLevelId)) ?? number);
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

export async function checkStudentEnrollable(deps: AcademicDeps, ctx: RequestContext, studentId: string, options: { admission?: boolean } = {}): Promise<Result<StudentSummary, AppError>> {
  const student = await deps.ports.students.getStudent(ctx, studentId);
  if (!student) return err(notFound(AcademicCode.STUDENT_NOT_FOUND, "Apprenant", studentId));
  // Une admission inscrit un dossier encore INACTIF (activé à la confirmation, spec 007) ; les autres parcours exigent un dossier actif.
  const allowed = options.admission ? deps.config.admissionEnrollableStudentStatuses : deps.config.enrollableStudentStatuses;
  if (!allowed.includes(student.status)) {
    return err(conflict(AcademicCode.STUDENT_NOT_ENROLLABLE, `Le dossier de l'apprenant est ${student.status} : il ne peut pas être inscrit.`, { status: student.status }));
  }
  return ok(student);
}

/**
 * Crée l'inscription d'un apprenant dans une classe (AC4.1). Vérifie l'apprenant (port `StudentDirectory`), la
 * classe, l'unicité (une inscription vivante par classe ; une inscription de classe par année et établissement),
 * le financement et la capacité dure (déclencheur). Chaque refus renvoie un code `academic.*` stable.
 */
export async function enrollStudent(deps: AcademicDeps, ctx: RequestContext, input: AcademicEnrollStudentBody): Promise<Result<Enrollment, AppError>> {
  const student = await checkStudentEnrollable(deps, ctx, input.studentId, { admission: input.sourceKind === "ADMISSION" });
  if (!student.ok) return student;
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const created = await createEnrollmentInTx(deps, ctx, tx, events, input, student.value);
    if (!created.ok) return created;
    await events.flush(tx);
    return created;
  });
}

export async function createEnrollmentInTx(
  deps: AcademicDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  input: AcademicEnrollStudentBody,
  student: StudentSummary,
): Promise<Result<Enrollment, AppError>> {
  const loaded = await loadClassroomInScope(tx, ctx, input.classroomId);
  if (!loaded.ok) return loaded;
  const classroom = loaded.value;
  if (!classroomAcceptsEnrollment(classroom.status)) return err(conflict(AcademicCode.CLASSROOM_NOT_OPEN, `La classe est ${classroom.status} : elle n'accepte plus d'inscription.`, { status: classroom.status }));
  const year = await cal.getYear(tx, classroom.academicYearId);
  if (!year || (year.status !== "DRAFT" && year.status !== "OPEN")) return err(conflict(AcademicCode.YEAR_NOT_OPEN, "L'année de la classe n'accepte plus d'inscription."));
  const mode = input.mode ?? "CLASS";

  // Unicité (messages explicites ; les index uniques partiels restent le dernier rempart sous concurrence).
  if (await enr.findLiveEnrollmentInClass(tx, student.studentId, classroom.id)) {
    return err(conflict(AcademicCode.ALREADY_ENROLLED, "L'apprenant a déjà une inscription vivante dans cette classe."));
  }
  if (mode === "CLASS") {
    const other = await enr.findClassModeEnrollmentOfYear(tx, student.studentId, classroom.academicYearId, classroom.institutionId);
    if (other) return err(conflict(AcademicCode.CLASS_ENROLLMENT_EXISTS, "L'apprenant a déjà une inscription de classe cette année dans cet établissement.", { enrollmentId: other.id }));
  }

  // Financement (donnée du pack) : le type et l'exigence de référence viennent des référentiels.
  const fundingCode = input.fundingType ?? "PRIVATE";
  const fundingDef = (await ref.listFundingTypes(tx)).find((f) => f.code === fundingCode);
  const funding = { fundingType: fundingCode, assignmentReference: input.assignmentReference ?? null, funderLabel: input.funderLabel ?? null };
  const fundingProblem = validateFunding(fundingDef, funding);
  if (fundingProblem) return err(fundingProblem);
  const norm = normalizeFunding(funding);

  const settings = await loadSettings(tx, classroom.institutionId);
  const number = await allocateRegistrationNumber(deps, tx, { classroom, student, settings, yearStartsOn: year.startsOn });
  if (!number.ok) return number;

  let feeDue: boolean | null = null;
  if (settings.enrollmentConfirmationPolicy === "ON_REGISTRATION_FEE_PAID") {
    feeDue = await deps.ports.registrationFee.registrationFeeDue(ctx, {
      studentId: student.studentId,
      classroomId: classroom.id,
      institutionId: classroom.institutionId,
      academicYearId: classroom.academicYearId,
      programId: classroom.programId,
      gradeLevelId: classroom.gradeLevelId,
      fundingType: fundingCode,
    });
  }
  const status = initialEnrollmentStatus(settings.enrollmentConfirmationPolicy, feeDue);
  const enrolledOn = input.enrolledOn ?? (await todayFor(deps, ctx, classroom.institutionId));

  const id = deps.newId();
  await enr.insertEnrollment(tx, {
    id,
    institutionId: classroom.institutionId,
    campusId: classroom.campusId,
    academicYearId: classroom.academicYearId,
    studentId: student.studentId,
    classroomId: classroom.id,
    mode,
    status,
    registrationNumber: number.value,
    enrolledOn,
    isRepeating: input.isRepeating ?? false,
    isTransferIn: input.isTransferIn ?? false,
    originSchool: input.originSchool ?? null,
    previousEnrollmentId: input.previousEnrollmentId ?? null,
    fundingType: fundingCode,
    assignmentReference: norm.assignmentReference,
    assignmentIssuedOn: input.assignmentIssuedOn ?? null,
    funderLabel: norm.funderLabel,
    fundingNotes: input.fundingNotes ?? null,
    sourceKind: input.sourceKind ?? "MANUAL",
    sourceRef: input.sourceRef ?? null,
    confirmedAt: status === "ACTIVE",
  });
  await enr.insertPlacement(tx, { id: deps.newId(), enrollmentId: id, classroomId: classroom.id, startsOn: enrolledOn, reason: null, createdBy: actorId(ctx) });
  await writeHistory(deps, ctx, tx, id, {
    kind: "CREATED",
    from: null,
    to: { status, classroomId: classroom.id, mode, fundingType: fundingCode, assignmentReference: norm.assignmentReference, registrationNumber: number.value },
    reason: input.note ?? null,
  });
  const created = (await enr.getEnrollment(tx, id)) as Enrollment;
  events.add(AcademicEvents.ENROLLMENT_CREATED, enrollmentPayload(created, null, null, classroom), { type: "enrollment", id });
  if (status === "ACTIVE") events.add(AcademicEvents.ENROLLMENT_CONFIRMED, enrollmentPayload(created, "PENDING", "politique de confirmation", classroom), { type: "enrollment", id });
  return ok(created);
}

/** Inscription en lot, idempotente : une inscription vivante existante est « ignorée », un échec n'arrête pas le lot. */
export async function enrollStudentsBulk(deps: AcademicDeps, ctx: RequestContext, items: readonly AcademicEnrollStudentBody[]): Promise<Result<AcademicEnrollBulkResult, AppError>> {
  const result: AcademicEnrollBulkResult = { created: [], skipped: [], failed: [] };
  for (const [index, item] of items.entries()) {
    const r = await enrollStudent(deps, ctx, item);
    if (r.ok) {
      result.created.push(r.value);
    } else if (r.error.code === AcademicCode.ALREADY_ENROLLED) {
      const existing = await inReadTx(deps, ctx, async (tx) => ok(await enr.findLiveEnrollmentInClass(tx, item.studentId, item.classroomId)));
      if (existing.ok && existing.value) result.skipped.push({ studentId: item.studentId, classroomId: item.classroomId, enrollmentId: existing.value.id, reason: r.error.code });
      else result.failed.push({ index, studentId: item.studentId, code: r.error.code, message: r.error.message });
    } else {
      result.failed.push({ index, studentId: item.studentId, code: r.error.code, message: r.error.message });
    }
  }
  return ok(result);
}

// ---------------------------------------------------------------------------
// Machine d'états : confirm / suspend / resume / withdraw / cancel / complete / reopen
// ---------------------------------------------------------------------------

export interface TransitionResult {
  enrollment: Enrollment;
  courses: EnrollmentCourse[];
}

const maxDate = (a: string, b: string): string => (a > b ? a : b);

/**
 * Transition d'une inscription dans une transaction DÉJÀ ouverte (réutilisée par les événements `finance.*` et
 * `people.*`). Écrit l'historique, publie l'événement, répercute sur les sélections de cours (annulation en
 * cascade, confirmation selon la politique de sélection) et NE TOUCHE à aucun paiement (AC4.4).
 */
export async function transitionEnrollmentInTx(
  deps: AcademicDeps,
  ctx: RequestContext,
  tx: Tx,
  events: EventBuffer,
  enrollment: Enrollment,
  action: EnrollmentAction,
  reason: string | null,
  options: { toStatus?: "TRANSFERRED_OUT"; confirmation?: { mode: "PAYMENT" | "MANUAL" | "OVERRIDE"; reason: string | null } } = {},
): Promise<Result<Enrollment, AppError>> {
  const target = options.toStatus ?? ENROLLMENT_ACTION_TARGETS[action];
  if (options.toStatus) {
    if (action !== "withdraw") return err(conflict(AcademicCode.ENROLLMENT_TRANSITION, "Transition interdite."));
    if (enrollment.status !== "ACTIVE" && enrollment.status !== "SUSPENDED") {
      return err(conflict(AcademicCode.ENROLLMENT_TRANSITION, `Transition interdite pour l'inscription : ${enrollment.status} -> ${target}.`, { from: enrollment.status, to: target }));
    }
  } else if (validateEnrollmentAction(action, enrollment.status) === "illegal") {
    return err(conflict(AcademicCode.ENROLLMENT_TRANSITION, `Transition interdite pour l'inscription : ${enrollment.status} -> ${target}.`, { from: enrollment.status, to: target, action }));
  }
  const why = reason?.trim() || null;
  if (ENROLLMENT_ACTIONS_REQUIRING_REASON.includes(action) && (why?.length ?? 0) < 5) {
    return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis pour cette action.", "reason"));
  }
  const today = await todayFor(deps, ctx, enrollment.institutionId);
  const ends = target === "WITHDRAWN" || target === "CANCELLED" || target === "TRANSFERRED_OUT" || target === "COMPLETED";
  const endedOn = ends ? maxDate(today, enrollment.enrolledOn) : null;
  await enr.setEnrollmentStatus(tx, enrollment.id, {
    status: target,
    endedOn,
    endReason: ends && target !== "COMPLETED" ? why : null,
    confirmed: target === "ACTIVE" && enrollment.status === "PENDING",
    cancelled: target === "CANCELLED",
    ...(options.confirmation && action === "confirm" ? { confirmation: { mode: options.confirmation.mode, reason: options.confirmation.reason, by: actorId(ctx) } } : {}),
  });
  if (endedOn && target !== "COMPLETED") {
    const open = await enr.getOpenPlacement(tx, enrollment.id);
    if (open) await enr.closePlacement(tx, open.id, maxDate(endedOn, open.startsOn));
  }
  await writeHistory(deps, ctx, tx, enrollment.id, statusHistory(enrollment.status, target, why));
  const updated = (await enr.getEnrollment(tx, enrollment.id)) as Enrollment;
  const classroomFacts = await classroomsRepo.getClassroom(tx, updated.classroomId);
  events.add(
    ENROLLMENT_ACTION_EVENTS[action],
    { ...enrollmentPayload(updated, enrollment.status, why, classroomFacts), ...(action === "confirm" && updated.confirmationMode ? { confirmationMode: updated.confirmationMode } : {}) },
    { type: "enrollment", id: enrollment.id },
  );

  // Répercussions sur les sélections de cours.
  if (target === "CANCELLED" || target === "WITHDRAWN" || target === "TRANSFERRED_OUT") {
    for (const course of await enr.listLiveCourses(tx, enrollment.id)) {
      await cancelCourseInTx(deps, ctx, tx, events, { course, enrollment: updated, reason: `enrollment_${target.toLowerCase()}`, event: AcademicEvents.COURSE_CANCELLED });
    }
  } else if (target === "ACTIVE") {
    await confirmPendingCoursesInTx(deps, ctx, tx, events, updated);
  }
  return ok(updated);
}

/**
 * Confirmation en cascade APRÈS la confirmation de l'inscription : `AUTO` confirme les sélections en attente ;
 * `ON_LINE_PAID` confirme celles dont la ligne était déjà soldée (paiement mémorisé). Jamais en bloc des UE non
 * payées (D2).
 */
export async function confirmPendingCoursesInTx(deps: AcademicDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, enrollment: Enrollment): Promise<EnrollmentCourse[]> {
  const settings = await loadSettings(tx, enrollment.institutionId);
  const confirmed: EnrollmentCourse[] = [];
  for (const course of await enr.listPendingCourses(tx, enrollment.id)) {
    const expired = course.holdExpiresAt !== null && new Date(course.holdExpiresAt).getTime() <= deps.clock.now().getTime();
    if (expired) continue;
    const policy = courseConfirmationPolicyFor(course.source, settings.courseConfirmationPolicy);
    const auto = initialCourseStatus(policy, enrollment.status) === "CONFIRMED";
    const paid = policy === "ON_LINE_PAID" && course.linePaidAt !== null;
    if (!auto && !paid) continue;
    await confirmCourseInTx(deps, ctx, tx, events, { course, enrollment, reason: auto ? "politique de confirmation" : "ligne de facture soldée" });
    confirmed.push({ ...course, status: "CONFIRMED" });
  }
  return confirmed;
}

export async function transitionEnrollment(deps: AcademicDeps, ctx: RequestContext, id: string, action: EnrollmentAction, reason?: string | null): Promise<Result<Enrollment, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadEnrollmentInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const events = new EventBuffer(deps, ctx);
    const r = await transitionEnrollmentInTx(deps, ctx, tx, events, l.value, action, reason ?? null);
    if (!r.ok) return r;
    await events.flush(tx);
    return r;
  });
}

export interface ManualConfirmationInput {
  /** Motif de la confirmation (obligatoire, 5 caractères au moins, quand elle déroge à une politique liée au paiement). */
  reason?: string | null | undefined;
  /**
   * L'appelant détient `enrollment.confirm.override`. Calculé par la couche HTTP (jamais lu du corps de la requête) ;
   * sans lui, une confirmation qui déroge à une politique liée au paiement est REFUSÉE (403).
   */
  overridePermitted: boolean;
}

/**
 * O-01 — confirmation MANUELLE d'une inscription en attente (décision métier : le paiement des frais d'inscription OU une
 * confirmation manuelle de la direction).
 *
 *  - politique `MANUAL` : confirmation ordinaire d'une personne habilitée (`enrollment.update`), mode `MANUAL`, motif facultatif ;
 *  - politique liée au paiement (`ON_REGISTRATION_FEE_PAID`, `ON_FULL_PAYMENT`) : DÉROGATION — permission dédiée
 *    `enrollment.confirm.override`, motif obligatoire, mode `OVERRIDE`, audit SENSIBLE ; l'inscription est confirmée sans
 *    que la facture soit soldée (la dette reste due : AUCUN paiement n'est touché, AC4.4).
 *
 * Le mode, le motif et l'auteur sont conservés sur l'inscription, dans l'historique immuable, dans l'événement
 * `academic.enrollment.confirmed` (`confirmationMode`) et dans l'audit.
 */
export async function confirmEnrollmentManually(deps: AcademicDeps, ctx: RequestContext, id: string, input: ManualConfirmationInput): Promise<Result<Enrollment, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadEnrollmentInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const enrollment = l.value;
    if (enrollment.status !== "PENDING") {
      return err(conflict(AcademicCode.ENROLLMENT_TRANSITION, `Transition interdite pour l'inscription : ${enrollment.status} -> ACTIVE.`, { from: enrollment.status, to: "ACTIVE", action: "confirm" }));
    }
    const settings = await loadSettings(tx, enrollment.institutionId);
    const mode = manualConfirmationMode(settings.enrollmentConfirmationPolicy);
    const reason = input.reason?.trim() || null;
    if (mode === "OVERRIDE") {
      if (!input.overridePermitted) {
        return err(
          forbidden(
            AcademicCode.ENROLLMENT_OVERRIDE_REQUIRED,
            "Cette inscription attend le paiement des frais : la confirmer à la main est une dérogation, réservée aux personnes habilitées (permission « enrollment.confirm.override »).",
            { policy: settings.enrollmentConfirmationPolicy },
          ),
        );
      }
      if ((reason?.length ?? 0) < OVERRIDE_REASON_MIN_LENGTH) {
        return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, `Un motif de ${OVERRIDE_REASON_MIN_LENGTH} caractères minimum est requis pour confirmer sans paiement.`, "reason"));
      }
    }
    const events = new EventBuffer(deps, ctx);
    const confirmed = await transitionEnrollmentInTx(deps, ctx, tx, events, enrollment, "confirm", mode === "OVERRIDE" ? `dérogation : ${reason}` : reason, { confirmation: { mode, reason } });
    if (!confirmed.ok) return confirmed;
    events.audit({
      action: mode === "OVERRIDE" ? "academic.enrollment.confirmation_overridden" : "academic.enrollment.confirmed_manually",
      resourceType: "enrollment",
      resourceId: enrollment.id,
      sensitive: mode === "OVERRIDE",
      ...(reason ? { reason } : {}),
      metadata: { policy: settings.enrollmentConfirmationPolicy, mode, studentId: enrollment.studentId, classroomId: enrollment.classroomId },
    });
    await events.flush(tx);
    return confirmed;
  });
}

/** Motif posé quand l'appelant (ex. le module d'admissions) n'en fournit pas : la machine d'états exige un motif d'annulation. */
export const PENDING_CANCEL_DEFAULT_REASON = "Annulation d'une inscription en attente";

/**
 * Annule une inscription EN ATTENTE (`PENDING`) — spec 007 §16 (candidature retirée ou refusée après pré-inscription).
 *  - `PENDING` -> `CANCELLED` : la place est libérée, les sélections vivantes sont annulées, événement
 *    `academic.enrollment.cancelled` (payload `{ v: 1, … }`, sans donnée personnelle) et audit ;
 *  - IDEMPOTENT : une inscription déjà `CANCELLED` est renvoyée telle quelle, sans nouvel événement ni nouvelle ligne d'historique ;
 *  - toute autre situation (`ACTIVE`, `SUSPENDED`, `COMPLETED`, `WITHDRAWN`, `TRANSFERRED_OUT`) est refusée
 *    (`academic.enrollment_not_pending`, 409) : une inscription confirmée se RETIRE (`transitionEnrollment(…, "withdraw")`).
 */
export async function cancelEnrollment(deps: AcademicDeps, ctx: RequestContext, id: string, input: { reason?: string | null | undefined } = {}): Promise<Result<Enrollment, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadEnrollmentInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const enrollment = l.value;
    if (enrollment.status === "CANCELLED") return ok(enrollment);
    if (enrollment.status !== "PENDING") {
      return err(conflict(AcademicCode.ENROLLMENT_NOT_PENDING, `L'inscription est ${enrollment.status} : seule une inscription en attente s'annule (une inscription confirmée se retire).`, { status: enrollment.status }));
    }
    const reason = input.reason?.trim() || PENDING_CANCEL_DEFAULT_REASON;
    const events = new EventBuffer(deps, ctx);
    const cancelled = await transitionEnrollmentInTx(deps, ctx, tx, events, enrollment, "cancel", reason);
    if (!cancelled.ok) return cancelled;
    events.audit({ action: "academic.enrollment.cancelled", resourceType: "enrollment", resourceId: id, before: { status: "PENDING" }, after: { status: "CANCELLED" }, reason });
    await events.flush(tx);
    return cancelled;
  });
}

// ---------------------------------------------------------------------------
// Changement de classe (AC4.2) : même `enrollment_id`, placements historisés
// ---------------------------------------------------------------------------

export async function transferEnrollment(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
  input: { toClassroomId: string; effectiveOn?: string | undefined; reason: string },
): Promise<Result<Enrollment, AppError>> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const l = await loadEnrollmentInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const enrollment = l.value;
    if (enrollment.status !== "PENDING" && enrollment.status !== "ACTIVE" && enrollment.status !== "SUSPENDED") {
      return err(conflict(AcademicCode.ENROLLMENT_TRANSITION, `L'inscription est ${enrollment.status} : elle ne peut plus changer de classe.`, { status: enrollment.status }));
    }
    if (enrollment.mode !== "CLASS") return err(conflict(AcademicCode.ENROLLMENT_MODE_MISMATCH, "Une inscription à la carte suit les offres de sa classe : inscrivez l'apprenant dans l'autre classe."));
    if (enrollment.classroomId === input.toClassroomId) return err(validation(AcademicCode.TRANSFER_SAME_CLASSROOM, "L'apprenant est déjà dans cette classe.", "toClassroomId"));
    const target = await loadClassroomInScope(tx, ctx, input.toClassroomId);
    if (!target.ok) return target;
    const to = target.value;
    if (!classroomAcceptsEnrollment(to.status)) return err(conflict(AcademicCode.CLASSROOM_NOT_OPEN, `La classe de destination est ${to.status}.`));
    if (to.institutionId !== enrollment.institutionId || to.academicYearId !== enrollment.academicYearId) {
      return err(validation(AcademicCode.TRANSFER_INVALID_TARGET, "La classe de destination doit être du même établissement et de la même année.", "toClassroomId"));
    }
    if (await enr.findLiveEnrollmentInClass(tx, enrollment.studentId, to.id)) return err(conflict(AcademicCode.ALREADY_ENROLLED, "L'apprenant a déjà une inscription vivante dans la classe de destination."));

    const effectiveOn = input.effectiveOn ?? (await todayFor(deps, ctx, enrollment.institutionId));
    const open = await enr.getOpenPlacement(tx, id);
    const from = enrollment.classroomId;
    // Le capteur de capacité (UPDATE OF classroom_id) refuse une classe de destination complète.
    await enr.setEnrollmentClassroom(tx, id, to.id, to.campusId);
    if (open && effectiveOn <= open.startsOn) {
      // Correction du jour : le placement n'a duré aucun jour, on le réécrit plutôt que d'ouvrir un placement vide.
      await enr.rewritePlacementClassroom(tx, open.id, to.id, reason);
    } else {
      if (open) await enr.closePlacement(tx, open.id, previousDay(effectiveOn));
      await enr.insertPlacement(tx, { id: deps.newId(), enrollmentId: id, classroomId: to.id, startsOn: effectiveOn, reason, createdBy: actorId(ctx) });
    }
    await writeHistory(deps, ctx, tx, id, { kind: "PLACEMENT", from: { classroomId: from }, to: { classroomId: to.id, effectiveOn }, reason });
    const updated = (await enr.getEnrollment(tx, id)) as Enrollment;
    const events = new EventBuffer(deps, ctx);
    events.add(AcademicEvents.ENROLLMENT_TRANSFERRED, { ...enrollmentPayload(updated, enrollment.status, reason, to), fromClassroomId: from, toClassroomId: to.id, effectiveOn }, { type: "enrollment", id });
    await events.flush(tx);
    return ok(updated);
  });
}

function previousDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Financement (AC4.3) et issue de fin d'année (R24)
// ---------------------------------------------------------------------------

export async function changeEnrollmentFunding(
  deps: AcademicDeps,
  ctx: RequestContext,
  id: string,
  input: { fundingType: string; assignmentReference?: string | null | undefined; assignmentIssuedOn?: string | null | undefined; funderLabel?: string | null | undefined; fundingNotes?: string | null | undefined; reason: string },
): Promise<Result<Enrollment, AppError>> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) return err(validation(AcademicCode.ENROLLMENT_REASON_REQUIRED, "Un motif de 5 caractères minimum est requis.", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const l = await loadEnrollmentInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const enrollment = l.value;
    if (enrollment.status === "CANCELLED" || enrollment.status === "WITHDRAWN" || enrollment.status === "TRANSFERRED_OUT") {
      return err(conflict(AcademicCode.ENROLLMENT_TRANSITION, `L'inscription est ${enrollment.status} : son financement ne change plus.`));
    }
    const types = await ref.listFundingTypes(tx);
    const def = types.find((f) => f.code === input.fundingType);
    const next = { fundingType: input.fundingType, assignmentReference: input.assignmentReference ?? null, funderLabel: input.funderLabel ?? null };
    const problem = validateFunding(def, next);
    if (problem) return err(problem);
    const norm = normalizeFunding(next);
    const before = { fundingType: enrollment.fundingType, assignmentReference: enrollment.assignmentReference };
    await enr.setEnrollmentFunding(tx, id, {
      fundingType: input.fundingType,
      assignmentReference: norm.assignmentReference,
      assignmentIssuedOn: input.assignmentIssuedOn ?? null,
      funderLabel: norm.funderLabel,
      fundingNotes: input.fundingNotes ?? null,
    });
    await writeHistory(deps, ctx, tx, id, { kind: "FUNDING", from: before, to: { fundingType: input.fundingType, assignmentReference: norm.assignmentReference }, reason });
    const updated = (await enr.getEnrollment(tx, id)) as Enrollment;
    const events = new EventBuffer(deps, ctx);
    events.add(
      AcademicEvents.ENROLLMENT_FUNDING_CHANGED,
      {
        v: 1,
        institutionId: updated.institutionId,
        academicYearId: updated.academicYearId,
        enrollmentId: id,
        studentId: updated.studentId,
        classroomId: updated.classroomId,
        from: before,
        to: { fundingType: updated.fundingType, assignmentReference: updated.assignmentReference },
        reason,
      },
      { type: "enrollment", id },
    );
    // Sensible dès qu'un type exigeant une référence d'affectation (ex. affecté par l'État) est concerné.
    const fromDef = types.find((f) => f.code === before.fundingType);
    if (def?.requiresReference || fromDef?.requiresReference) {
      events.audit({ action: "academic.enrollment.funding_changed", resourceType: "enrollment", resourceId: id, sensitive: true, before, after: { fundingType: updated.fundingType, assignmentReference: updated.assignmentReference }, reason });
    }
    await events.flush(tx);
    return ok(updated);
  });
}

/**
 * Enregistre l'issue de fin d'année (R24) FOURNIE par le module de décisions : academic n'en calcule aucune. Le
 * programme et le niveau cibles (orientation) sont conservés dans l'historique pour la reconduction.
 */
export async function recordEnrollmentOutcome(deps: AcademicDeps, ctx: RequestContext, id: string, input: AcademicRecordOutcomeBody): Promise<Result<Enrollment, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const l = await loadEnrollmentInScope(tx, ctx, id, true);
    if (!l.ok) return l;
    const enrollment = l.value;
    if (enrollment.status !== "ACTIVE" && enrollment.status !== "COMPLETED") {
      return err(conflict(AcademicCode.ENROLLMENT_TRANSITION, `L'inscription est ${enrollment.status} : aucune issue ne peut être enregistrée.`));
    }
    const outcome = (await ref.listOutcomes(tx)).find((o) => o.code === input.outcomeCode && o.active);
    if (!outcome) return err(validation(AcademicCode.OUTCOME_UNKNOWN, `Issue inconnue ou inactive : ${input.outcomeCode}.`, "outcomeCode"));
    if (outcome.kind === "REDIRECT" && (!input.targetProgramId || !input.targetGradeLevelId)) {
      return err(validation(AcademicCode.OUTCOME_TARGET_REQUIRED, "Une orientation indique le programme et le niveau cibles.", "targetProgramId"));
    }
    if (input.targetGradeLevelId && !(await ref.getGradeLevel(tx, input.targetGradeLevelId))) return err(notFound(AcademicCode.GRADE_LEVEL_NOT_FOUND, "Niveau", input.targetGradeLevelId));
    if (input.targetProgramId) {
      const p = await cur.getProgram(tx, input.targetProgramId);
      if (!p || p.institutionId !== enrollment.institutionId) return err(notFound(AcademicCode.PROGRAM_NOT_FOUND, "Programme", input.targetProgramId));
    }
    const decidedAt = input.decidedAt ?? deps.clock.now().toISOString();
    await enr.setEnrollmentOutcome(tx, id, { outcomeCode: outcome.code, decidedAt, sourceRef: input.decisionRef ?? null });
    await writeHistory(deps, ctx, tx, id, {
      kind: "OUTCOME",
      from: enrollment.outcomeCode ? { outcomeCode: enrollment.outcomeCode } : null,
      to: { outcomeCode: outcome.code, kind: outcome.kind, targetProgramId: input.targetProgramId ?? null, targetGradeLevelId: input.targetGradeLevelId ?? null, decisionRef: input.decisionRef ?? null },
      reason: null,
    });
    const updated = (await enr.getEnrollment(tx, id)) as Enrollment;
    const events = new EventBuffer(deps, ctx);
    events.add(
      AcademicEvents.ENROLLMENT_OUTCOME_RECORDED,
      {
        v: 1,
        institutionId: updated.institutionId,
        academicYearId: updated.academicYearId,
        enrollmentId: id,
        studentId: updated.studentId,
        classroomId: updated.classroomId,
        outcomeCode: outcome.code,
        outcomeKind: outcome.kind,
        decisionRef: input.decisionRef ?? null,
        targetGradeLevelId: input.targetGradeLevelId ?? null,
        targetProgramId: input.targetProgramId ?? null,
      },
      { type: "enrollment", id },
    );
    await events.flush(tx);
    return ok(updated);
  });
}
