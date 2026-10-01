/**
 * Circuit de validation d'une feuille de notes : DRAFT -> SUBMITTED -> REVIEWED -> APPROVED -> PUBLISHED.
 *
 *  - Chaque transition enregistre acteur, date, commentaire (obligatoire pour un retour en brouillon) dans
 *    `assessment_transitions` ET dans l'audit, dans la même transaction (R5 du plan).
 *  - Séparation des tâches (AC2.3) : la personne qui soumet ne relit, n'approuve ni ne publie la même évaluation ;
 *    si l'établissement a désactivé le réglage, la dérogation est inscrite sur l'évaluation (`fourEyesWaived`).
 *  - À la soumission, chaque inscription ACTIVE sans ligne reçoit une ligne `NOT_GRADED` (aucun trou, AC2.2) ; une
 *    évaluation vide ne se soumet pas.
 *  - À la publication, toutes les notes passent `PUBLISHED` ATOMIQUEMENT (miroir en base) et UN événement
 *    `assess.grade.published` par évaluation est écrit dans l'outbox (jamais une note dans l'événement).
 *  - Mode `AUTO_ON_APPROVAL` du type : l'approbation publie dans la même transaction.
 *  - Une évaluation d'un type masqué (`visible_to_students = false`) est publiée pour le calcul mais invisible des élèves.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation } from "@ecoledigitale/database";
import type { Tx } from "@ecoledigitale/database";
import { AssessCode, conflict, forbidden, validation } from "../domain/errors";
import { AssessEvents } from "../domain/events";
import type { Assessment, AssessStatus, GradeRevision } from "../domain/types";
import { planTransition, type TransitionTarget } from "../domain/workflow";
import { applyStatusChange, getAssessment, getSettingsRow, getType, insertTransition } from "../infrastructure/assessments-repository";
import { insertGrades, listGradesOf } from "../infrastructure/grades-repository";
import { guarded } from "../infrastructure/db-errors";
import { clearCancellationBatch, getActiveLock, insertRevision, setCancellationBatch } from "../infrastructure/revisions-repository";
import { EventBuffer, inTx, type AssessCaps, type AssessDeps } from "./deps";
import { auditSnapshot, ensureTeacherAccess, loadAssessment, refOf } from "./support";

export interface TransitionInput {
  assessmentId: string;
  to: TransitionTarget;
  comment?: string | undefined;
  rowVersion?: number | undefined;
  caps?: AssessCaps | undefined;
}

export interface TransitionOutcome {
  assessment: Assessment;
  /** `true` si le mode de publication automatique du type a aussi publié la feuille. */
  autoPublished: boolean;
}

/** Droit contextuel d'atteindre l'état demandé (les routes appliquent déjà `requirePermission` ; défense en profondeur). */
async function ensureTransitionRights(deps: AssessDeps, ctx: RequestContext, a: Assessment, to: TransitionTarget, caps: AssessCaps): Promise<Result<void, AppError>> {
  const allowed =
    to === "SUBMITTED"
      ? null
      : to === "REVIEWED"
        ? caps.review
        : to === "APPROVED"
          ? caps.validate
          : to === "PUBLISHED"
            ? caps.publish
            : caps.review || caps.validate || caps.publish || caps.manage;
  if (to === "SUBMITTED") return ensureTeacherAccess(deps, ctx, a, caps);
  if (to === "DRAFT" && !allowed && a.status === "SUBMITTED") {
    // L'enseignant reprend sa propre feuille soumise (avant relecture).
    return ensureTeacherAccess(deps, ctx, a, caps);
  }
  if (!allowed && !caps.manage) return err(forbidden(AssessCode.FORBIDDEN, "Vous n'avez pas le droit d'effectuer cette étape du circuit de validation.", { to }));
  return ok(undefined);
}

export async function transitionAssessment(deps: AssessDeps, ctx: RequestContext, input: TransitionInput): Promise<Result<TransitionOutcome, AppError>> {
  const caps = input.caps ?? {};
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadAssessment(tx, input.assessmentId, "update");
    if (!loaded.ok) return loaded;
    const a = loaded.value;
    const rights = await ensureTransitionRights(deps, ctx, a, input.to, caps);
    if (!rights.ok) return rights;
    if (input.rowVersion !== undefined && input.rowVersion !== a.rowVersion) {
      return err(conflict(AssessCode.STALE_ASSESSMENT, "L'évaluation a été modifiée entre-temps : rechargez-la.", { rowVersion: a.rowVersion }));
    }
    const lock = await getActiveLock(tx, a.classroomId, a.academicPeriodId);
    if (lock && lock.lockedSessions.includes(a.sessionNo)) {
      return err(conflict(AssessCode.PERIOD_LOCKED, "La période de cette classe est verrouillée pour cette session.", { classroomId: a.classroomId, academicPeriodId: a.academicPeriodId }));
    }

    const settings = await getSettingsRow(tx);
    const gradesBefore = await listGradesOf(tx, a.id);
    const plan = planTransition({
      from: a.status,
      to: input.to,
      actorId: ctx.userId as string,
      submittedBy: a.submittedBy,
      settings,
      comment: input.comment,
      gradeCount: gradesBefore.length,
    });
    if (!plan.ok) return plan;

    const events = new EventBuffer(deps, ctx);
    const actorName = await deps.ports.names.nameOf(ctx, ctx.userId as string);
    const now = deps.clock.now();

    // AC2.2 : aucun trou — une ligne NOT_GRADED par inscription active sans note (l'évaluation est encore en brouillon).
    if (input.to === "SUBMITTED") {
      const have = new Set(gradesBefore.map((g) => g.enrollmentId));
      const missing = (await deps.ports.roster.listEnrollments(ctx, a.classroomId)).filter((r) => r.active && !have.has(r.enrollmentId));
      if (missing.length > 0) {
        await guarded(() =>
          insertGrades(
            tx,
            ctx.tenantId,
            missing.map((m) => ({ id: deps.newId(), assessmentId: a.id, enrollmentId: m.enrollmentId, studentId: m.studentId, score: null, entryStatus: "NOT_GRADED", comment: null })),
            ctx.userId,
            now,
          ),
        );
      }
    }

    const step = async (from: Assessment, to: AssessStatus, waiver: boolean, comment?: string | null): Promise<Result<Assessment, AppError>> => {
      const changed = await guarded(() => applyStatusChange(tx, from.id, from.rowVersion, { to, actorId: ctx.userId, now, comment: comment ?? null, fourEyesWaived: waiver }));
      if (!changed) return err(conflict(AssessCode.STALE_ASSESSMENT, "L'évaluation a été modifiée entre-temps : rechargez-la."));
      await insertTransition(tx, { id: deps.newId(), tenantId: ctx.tenantId, assessmentId: from.id, from: from.status, to, actorId: ctx.userId, actorName, comment: comment ?? null, fourEyesWaived: waiver, at: now });
      return ok((await getAssessment(tx, from.id)) as Assessment);
    };

    let current = await step(a, input.to, plan.value.fourEyesWaiver, input.comment?.trim() || null);
    if (!current.ok) return current;
    let autoPublished = false;
    const type = await getType(tx, a.typeId);

    if (input.to === "APPROVED" && type?.publicationMode === "AUTO_ON_APPROVAL") {
      // Publication automatique : l'approbateur publie ; la séparation des tâches est revérifiée par le déclencheur.
      const published = await step(current.value, "PUBLISHED", current.value.fourEyesWaived || plan.value.fourEyesWaiver, null);
      if (!published.ok) return published;
      current = published;
      autoPublished = true;
    }

    const after = current.value;
    emit(events, a, after, input.to, input.comment?.trim() || null);
    if (after.status === "PUBLISHED") {
      // UN événement par évaluation (et non par note), dans la transaction de la publication (outbox).
      events.add(AssessEvents.GRADE_PUBLISHED, await publishedPayload(tx, after, type?.visibleToStudents ?? true), { type: "assessment", id: after.id });
    }
    await events.flush(tx);
    return ok({ assessment: after, autoPublished });
  });
}

function emit(events: EventBuffer, before: Assessment, after: Assessment, to: TransitionTarget, comment: string | null): void {
  const agg = { type: "assessment", id: after.id };
  const ref = refOf(after);
  const audit = (action: string, severity: "info" | "notice"): void =>
    events.audit({ action, entity: "assessment", entityId: after.id, before: auditSnapshot(before), after: auditSnapshot(after), reason: comment, metadata: { waived: after.fourEyesWaived }, severity });
  switch (to) {
    case "SUBMITTED":
      events.add(AssessEvents.ASSESSMENT_SUBMITTED, { v: 1, ...ref, status: after.status }, agg);
      audit("assess.assessment.submitted", "info");
      break;
    case "REVIEWED":
      events.add(AssessEvents.ASSESSMENT_REVIEWED, { v: 1, ...ref, status: after.status }, agg);
      audit("assess.assessment.reviewed", "info");
      break;
    case "APPROVED":
      events.add(AssessEvents.ASSESSMENT_APPROVED, { v: 1, ...ref, status: "APPROVED" }, agg);
      audit("assess.assessment.approved", "notice");
      break;
    case "DRAFT":
      events.add(AssessEvents.ASSESSMENT_RETURNED, { v: 1, ...ref, status: after.status, from: before.status }, agg);
      audit("assess.assessment.returned", "info");
      break;
    case "PUBLISHED":
      break;
  }
  if (after.status === "PUBLISHED") audit("assess.assessment.published", "notice");
}

/**
 * Événement de publication : écrit APRÈS le changement de statut, un par évaluation. Séparé de `emit` car il lit les
 * inscriptions de la feuille (liste d'identifiants, aucune note).
 */
export async function publishedPayload(tx: Tx, a: Assessment, visible: boolean): Promise<{ v: 1 } & Record<string, unknown>> {
  const grades = await listGradesOf(tx, a.id);
  return {
    v: 1,
    ...refOf(a),
    enrollmentIds: grades.map((g) => g.enrollmentId),
    publishedAt: (a.publishedAt as Date).toISOString(),
    visibleToStudents: visible,
  };
}

export interface CancelInput {
  assessmentId: string;
  reason: string;
  caps?: AssessCaps | undefined;
}

export interface CancelOutcome {
  assessment: Assessment | null;
  /** Évaluation publiée : lot de révisions d'annulation à approuver en une décision. */
  revisions: GradeRevision[];
}

/**
 * Annulation. Évaluation NON publiée : directe, motif obligatoire. Évaluation PUBLIÉE : demande d'un lot de
 * révisions `REMOVAL` (une par note) approuvé en UNE décision (`approveRevision`), puis annulation de la feuille.
 */
export async function cancelAssessment(deps: AssessDeps, ctx: RequestContext, input: CancelInput): Promise<Result<CancelOutcome, AppError>> {
  const caps = input.caps ?? {};
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  if (input.reason.trim().length < 10) return err(validation(AssessCode.COMMENT_REQUIRED, "Le motif d'annulation est obligatoire (10 caractères au moins).", "reason"));
  return inTx<CancelOutcome>(deps, ctx, async (tx) => {
    const loaded = await loadAssessment(tx, input.assessmentId, "update");
    if (!loaded.ok) return loaded;
    const a = loaded.value;
    const access = await ensureTeacherAccess(deps, ctx, a, caps);
    if (!access.ok) return access;
    const events = new EventBuffer(deps, ctx);
    const now = deps.clock.now();
    const actorName = await deps.ports.names.nameOf(ctx, ctx.userId as string);

    if (a.status === "CANCELLED") return err(conflict(AssessCode.INVALID_TRANSITION, "Cette évaluation est déjà annulée.", { status: a.status }));
    const lock = await getActiveLock(tx, a.classroomId, a.academicPeriodId);
    if (lock && lock.lockedSessions.includes(a.sessionNo)) {
      return err(conflict(AssessCode.PERIOD_LOCKED, "La période de cette classe est verrouillée pour cette session.", { classroomId: a.classroomId, academicPeriodId: a.academicPeriodId }));
    }

    if (a.status !== "PUBLISHED") {
      const changed = await guarded(() => applyStatusChange(tx, a.id, a.rowVersion, { to: "CANCELLED", actorId: ctx.userId, now, comment: input.reason.trim() }));
      if (!changed) return err(conflict(AssessCode.STALE_ASSESSMENT, "L'évaluation a été modifiée entre-temps : rechargez-la."));
      await insertTransition(tx, { id: deps.newId(), tenantId: ctx.tenantId, assessmentId: a.id, from: a.status, to: "CANCELLED", actorId: ctx.userId, actorName, comment: input.reason.trim(), fourEyesWaived: false, at: now });
      const after = (await getAssessment(tx, a.id)) as Assessment;
      const grades = await listGradesOf(tx, a.id);
      events.add(AssessEvents.ASSESSMENT_CANCELLED, { v: 1, ...refOf(after), reason: input.reason.trim(), enrollmentIds: grades.map((g) => g.enrollmentId) }, { type: "assessment", id: a.id });
      events.audit({ action: "assess.assessment.cancelled", entity: "assessment", entityId: a.id, before: auditSnapshot(a), after: auditSnapshot(after), reason: input.reason.trim(), severity: "warning" });
      await events.flush(tx);
      return ok({ assessment: after, revisions: [] });
    }

    // Évaluation publiée : lot de REMOVAL, une décision.
    if (!caps.reviseRequest && !caps.manage) return err(forbidden(AssessCode.FORBIDDEN, "Vous n'avez pas le droit de demander l'annulation d'une évaluation publiée."));
    const grades = await listGradesOf(tx, a.id);
    const batchId = deps.newId();
    const revisions: GradeRevision[] = [];
    try {
      for (const g of grades) {
        revisions.push(
          await tx.transaction((sp) =>
            insertRevision(sp, {
              id: deps.newId(),
              tenantId: ctx.tenantId,
              assessmentId: a.id,
              gradeId: g.id,
              enrollmentId: g.enrollmentId,
              studentId: g.studentId,
              kind: "REMOVAL",
              newScore: null,
              newEntryStatus: "NOT_GRADED",
              reason: input.reason.trim(),
              requestedBy: ctx.userId as string,
              requestedByName: actorName,
              requestedAt: now,
              batchId,
            }),
          ),
        );
      }
    } catch (e) {
      if (isUniqueViolation(e)) return err(conflict(AssessCode.REVISION_PENDING, "Une correction est déjà en cours sur une note de cette feuille : traitez-la d'abord.", {}));
      throw e;
    }
    events.add(AssessEvents.REVISION_REQUESTED, { v: 1, ...refOf(a), revisionId: revisions[0]?.id ?? batchId, enrollmentId: revisions[0]?.enrollmentId ?? batchId, kind: "REMOVAL", batchId }, { type: "assessment", id: a.id });
    events.audit({
      action: "assess.assessment.cancellation_requested",
      entity: "assessment",
      entityId: a.id,
      metadata: { batchId, gradeCount: revisions.length },
      reason: input.reason.trim(),
      severity: "warning",
    });
    await events.flush(tx);
    return ok({ assessment: null, revisions });
  });
}

/** Annule la feuille publiée une fois TOUTES les révisions du lot appliquées (appelé par `approveRevision`). */
export async function finalizeCancellation(deps: AssessDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, assessmentId: string, batchId: string, reason: string): Promise<Result<Assessment, AppError>> {
  const loaded = await loadAssessment(tx, assessmentId, "update");
  if (!loaded.ok) return loaded;
  const a = loaded.value;
  const now = deps.clock.now();
  await setCancellationBatch(tx, batchId);
  const changed = await guarded(() => applyStatusChange(tx, a.id, a.rowVersion, { to: "CANCELLED", actorId: ctx.userId, now, comment: reason }));
  await clearCancellationBatch(tx);
  if (!changed) return err(conflict(AssessCode.STALE_ASSESSMENT, "L'évaluation a été modifiée entre-temps : rechargez-la."));
  const actorName = ctx.userId ? await deps.ports.names.nameOf(ctx, ctx.userId) : null;
  await insertTransition(tx, { id: deps.newId(), tenantId: ctx.tenantId, assessmentId: a.id, from: a.status, to: "CANCELLED", actorId: ctx.userId, actorName, comment: reason, fourEyesWaived: false, at: now });
  const after = (await getAssessment(tx, a.id)) as Assessment;
  const grades = await listGradesOf(tx, a.id);
  events.add(AssessEvents.ASSESSMENT_CANCELLED, { v: 1, ...refOf(after), reason, enrollmentIds: grades.map((g) => g.enrollmentId) }, { type: "assessment", id: a.id });
  events.audit({ action: "assess.assessment.cancelled", entity: "assessment", entityId: a.id, before: auditSnapshot(a), after: auditSnapshot(after), reason, metadata: { batchId }, severity: "critical" });
  return ok(after);
}
