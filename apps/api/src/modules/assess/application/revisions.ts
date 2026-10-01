/**
 * Révisions de notes publiées (GradeRevision) : demande, décision, application.
 *
 *  - Une note PUBLIÉE ne change JAMAIS directement : le déclencheur SQL refuse tout `UPDATE`/`DELETE` d'un rôle
 *    applicatif ; la seule voie est `assess.apply_revision(revision)` sur une révision APPROUVÉE (A-24).
 *  - La révision porte l'ancienne valeur (relue en base par le déclencheur), la nouvelle, un motif obligatoire
 *    (≥ 10 caractères), le demandeur et l'approbateur (≠ demandeur, sauf dérogation tracée), les dates.
 *  - Types : CORRECTION (valeur ou état d'entrée), ADDITION (élève absent de la feuille à la publication), REMOVAL
 *    (la note n'est plus comptée : `NOT_GRADED`) ; l'annulation d'une évaluation publiée est un LOT de REMOVAL approuvé
 *    en une décision.
 *  - Approuver applique aussitôt, sauf période verrouillée pour la session : la révision reste APPROUVÉE et s'applique
 *    à la libération du verrou (`applyApprovedInTx`, appelé par `locks`).
 *  - L'application émet `assess.grade.revised` (le recalcul des résultats `DRAFT` suit dans `results`).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { isUniqueViolation, type Tx } from "@ecoledigitale/database";
import { compareDecimal } from "../domain/decimal";
import { AssessCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { AssessEvents } from "../domain/events";
import { normalizeEntry } from "../domain/grades";
import type { AssessEntryStatus, Assessment, Grade, GradeRevision } from "../domain/types";
import { planRevisionDecision } from "../domain/workflow";
import { getAssessment, getSettingsRow, listTransitions } from "../infrastructure/assessments-repository";
import { getGradeById, listGradesOf } from "../infrastructure/grades-repository";
import { guarded } from "../infrastructure/db-errors";
import { applyRevisionSql, decideRevision, getActiveLock, getRevision, insertRevision, listApprovedUnapplied, listRevisions, listRevisionsOfBatch, listRevisionsOfGrade, type RevisionFilter } from "../infrastructure/revisions-repository";
import { EventBuffer, inTx, type AssessCaps, type AssessDeps } from "./deps";
import { ensureReadAccess, ensureTeacherAccess, loadAssessment, refOf } from "./support";
import { finalizeCancellation } from "./workflow";

const revisionAudit = (r: GradeRevision): Record<string, unknown> => ({
  kind: r.kind,
  status: r.status,
  oldScore: r.oldScore,
  oldEntryStatus: r.oldEntryStatus,
  newScore: r.newScore,
  newEntryStatus: r.newEntryStatus,
  batchId: r.batchId,
});

function ensureRevisable(a: Assessment): Result<void, AppError> {
  if (a.status !== "PUBLISHED") {
    return err(conflict(AssessCode.REVISION_NOT_APPLICABLE, "Seule une feuille publiée se corrige par révision : une feuille en cours de circuit se corrige directement.", { status: a.status }));
  }
  return ok(undefined);
}

export interface RequestRevisionInput {
  gradeId: string;
  newScore?: string | null | undefined;
  newEntryStatus?: AssessEntryStatus | undefined;
  reason: string;
  caps?: AssessCaps | undefined;
}

export async function requestRevision(deps: AssessDeps, ctx: RequestContext, input: RequestRevisionInput): Promise<Result<GradeRevision, AppError>> {
  const caps = input.caps ?? {};
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  if (input.reason.trim().length < 10) return err(validation(AssessCode.COMMENT_REQUIRED, "Le motif de la correction est obligatoire (10 caractères au moins).", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const grade = await getGradeById(tx, input.gradeId);
    if (!grade) return err(notFound(AssessCode.GRADE_NOT_FOUND, "Note", input.gradeId));
    const loaded = await loadAssessment(tx, grade.assessmentId, "share");
    if (!loaded.ok) return loaded;
    const a = loaded.value;
    if (!caps.reviseRequest && !caps.manage) return err(forbidden(AssessCode.FORBIDDEN, "Vous n'avez pas le droit de demander la correction d'une note publiée."));
    const access = await ensureTeacherAccess(deps, ctx, a, caps);
    if (!access.ok) return access;
    const revisable = ensureRevisable(a);
    if (!revisable.ok) return revisable;

    const settings = await getSettingsRow(tx);
    const entry = normalizeEntry({ enrollmentId: grade.enrollmentId, score: input.newScore, entryStatus: input.newEntryStatus }, a.scaleMax, settings.maxScoreDecimals);
    if (!entry.ok) return entry;
    const events = new EventBuffer(deps, ctx);
    const requesterName = await deps.ports.names.nameOf(ctx, ctx.userId as string);
    let revision: GradeRevision;
    try {
      revision = await guarded(() =>
        tx.transaction((sp) =>
          insertRevision(sp, {
            id: deps.newId(),
            tenantId: ctx.tenantId,
            assessmentId: a.id,
            gradeId: grade.id,
            enrollmentId: grade.enrollmentId,
            studentId: grade.studentId,
            kind: "CORRECTION",
            newScore: entry.value.score,
            newEntryStatus: entry.value.entryStatus,
            reason: input.reason.trim(),
            requestedBy: ctx.userId as string,
            requestedByName: requesterName,
            requestedAt: deps.clock.now(),
            batchId: null,
          }),
        ),
      );
    } catch (e) {
      if (isUniqueViolation(e)) return err(conflict(AssessCode.REVISION_PENDING, "Une demande de correction est déjà en cours pour cette note.", { gradeId: grade.id }));
      throw e;
    }
    return finishRequest(deps, ctx, tx, events, a, revision);
  });
}

async function finishRequest(deps: AssessDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, a: Assessment, revision: GradeRevision): Promise<Result<GradeRevision, AppError>> {
  events.add(AssessEvents.REVISION_REQUESTED, { v: 1, ...refOf(a), revisionId: revision.id, enrollmentId: revision.enrollmentId, kind: revision.kind, batchId: revision.batchId }, { type: "grade_revision", id: revision.id });
  events.audit({ action: "assess.revision.requested", entity: "grade_revision", entityId: revision.id, after: revisionAudit(revision), reason: revision.reason, severity: "notice" });
  await events.flush(tx);
  return ok(revision);
}

export interface RequestAdditionInput {
  assessmentId: string;
  enrollmentId: string;
  newScore?: string | null | undefined;
  newEntryStatus?: AssessEntryStatus | undefined;
  reason: string;
  caps?: AssessCaps | undefined;
}

/** ADDITION : un élève absent de la feuille au moment de la publication (cas limite §13). */
export async function requestAddition(deps: AssessDeps, ctx: RequestContext, input: RequestAdditionInput): Promise<Result<GradeRevision, AppError>> {
  const caps = input.caps ?? {};
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  if (input.reason.trim().length < 10) return err(validation(AssessCode.COMMENT_REQUIRED, "Le motif de l'ajout est obligatoire (10 caractères au moins).", "reason"));
  return inTx(deps, ctx, async (tx) => {
    const loaded = await loadAssessment(tx, input.assessmentId, "share");
    if (!loaded.ok) return loaded;
    const a = loaded.value;
    if (!caps.reviseRequest && !caps.manage) return err(forbidden(AssessCode.FORBIDDEN, "Vous n'avez pas le droit de demander l'ajout d'une note à une feuille publiée."));
    const access = await ensureTeacherAccess(deps, ctx, a, caps);
    if (!access.ok) return access;
    const revisable = ensureRevisable(a);
    if (!revisable.ok) return revisable;
    const member = (await deps.ports.roster.listEnrollments(ctx, a.classroomId)).find((r) => r.enrollmentId === input.enrollmentId);
    if (!member) return err(validation(AssessCode.UNKNOWN_ENROLLMENT, "Cette inscription n'appartient pas à la classe de l'évaluation.", "enrollmentId"));
    const settings = await getSettingsRow(tx);
    const entry = normalizeEntry({ enrollmentId: input.enrollmentId, score: input.newScore, entryStatus: input.newEntryStatus }, a.scaleMax, settings.maxScoreDecimals);
    if (!entry.ok) return entry;
    const events = new EventBuffer(deps, ctx);
    try {
      const revision = await guarded(() =>
        tx.transaction(async (sp) =>
          insertRevision(sp, {
            id: deps.newId(),
            tenantId: ctx.tenantId,
            assessmentId: a.id,
            gradeId: null,
            enrollmentId: input.enrollmentId,
            studentId: member.studentId,
            kind: "ADDITION",
            newScore: entry.value.score,
            newEntryStatus: entry.value.entryStatus,
            reason: input.reason.trim(),
            requestedBy: ctx.userId as string,
            requestedByName: await deps.ports.names.nameOf(ctx, ctx.userId as string),
            requestedAt: deps.clock.now(),
            batchId: null,
          }),
        ),
      );
      return finishRequest(deps, ctx, tx, events, a, revision);
    } catch (e) {
      if (isUniqueViolation(e)) return err(conflict(AssessCode.REVISION_PENDING, "Une demande d'ajout est déjà en cours pour cette inscription.", {}));
      throw e;
    }
  });
}

export interface DecideRevisionInput {
  revisionId: string;
  comment?: string | undefined;
  caps?: AssessCaps | undefined;
}

export interface ApproveOutcome {
  revisions: GradeRevision[];
  /** `false` : période verrouillée pour la session — approuvée, appliquée à la libération du verrou. */
  applied: boolean;
  cancelled: Assessment | null;
}

async function applyOne(deps: AssessDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, a: Assessment, revision: GradeRevision): Promise<GradeRevision> {
  const applied = await guarded(() => applyRevisionSql(tx, revision.id, deps.clock.now()));
  const grade = applied.gradeId ? await getGradeById(tx, applied.gradeId) : null;
  events.add(
    AssessEvents.GRADE_REVISED,
    { v: 1, ...refOf(a), gradeId: (grade?.id ?? applied.gradeId) as string, enrollmentId: applied.enrollmentId, revisionId: applied.id, kind: applied.kind },
    { type: "grade_revision", id: applied.id },
  );
  events.audit({ action: "assess.revision.applied", entity: "grade_revision", entityId: applied.id, before: { score: applied.oldScore, entryStatus: applied.oldEntryStatus }, after: { score: applied.newScore, entryStatus: applied.newEntryStatus }, reason: applied.reason, metadata: { kind: applied.kind, assessmentId: a.id }, severity: "critical" });
  return applied;
}

export async function approveRevision(deps: AssessDeps, ctx: RequestContext, input: DecideRevisionInput): Promise<Result<ApproveOutcome, AppError>> {
  const caps = input.caps ?? {};
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  if (!caps.reviseApprove) return err(forbidden(AssessCode.FORBIDDEN, "Vous n'avez pas le droit d'approuver une correction de note."));
  return inTx<ApproveOutcome>(deps, ctx, async (tx) => {
    const revision = await getRevision(tx, input.revisionId, true);
    if (!revision) return err(notFound(AssessCode.REVISION_NOT_FOUND, "Révision", input.revisionId));
    if (revision.status !== "REQUESTED") {
      return err(conflict(AssessCode.REVISION_TRANSITION, `Cette révision est déjà « ${revision.status} » : elle ne peut plus être approuvée.`, { status: revision.status }));
    }
    const loaded = await loadAssessment(tx, revision.assessmentId, "share");
    if (!loaded.ok) return loaded;
    const a = loaded.value;
    const settings = await getSettingsRow(tx);
    const plan = planRevisionDecision({ requestedBy: revision.requestedBy, actorId: ctx.userId as string, settings });
    if (!plan.ok) return plan;
    const actorName = await deps.ports.names.nameOf(ctx, ctx.userId as string);
    const now = deps.clock.now();
    const events = new EventBuffer(deps, ctx);

    const batch = revision.batchId ? await listRevisionsOfBatch(tx, revision.batchId) : [revision];
    const decided: GradeRevision[] = [];
    for (const r of batch) {
      if (r.status !== "REQUESTED") continue;
      const d = await guarded(() => decideRevision(tx, { id: r.id, status: "APPROVED", by: ctx.userId as string, byName: actorName, at: now, comment: input.comment?.trim() || null, fourEyesWaived: plan.value.fourEyesWaiver }));
      if (!d) return err(conflict(AssessCode.REVISION_TRANSITION, "La révision a été traitée entre-temps.", {}));
      decided.push(d);
    }
    for (const d of decided) events.audit({ action: "assess.revision.approved", entity: "grade_revision", entityId: d.id, after: revisionAudit(d), reason: input.comment?.trim() || null, metadata: { waived: plan.value.fourEyesWaiver }, severity: "notice" });

    // Période verrouillée pour la session : on approuve mais on n'applique pas (après réouverture / libération du verrou).
    const lock = await getActiveLock(tx, a.classroomId, a.academicPeriodId);
    if (lock && lock.lockedSessions.includes(a.sessionNo)) {
      await events.flush(tx);
      return ok({ revisions: decided, applied: false, cancelled: null });
    }

    const applied: GradeRevision[] = [];
    for (const d of decided) applied.push(await applyOne(deps, ctx, tx, events, a, d));
    let cancelled: Assessment | null = null;
    if (revision.batchId) {
      const done = await finalizeCancellation(deps, ctx, tx, events, a.id, revision.batchId, revision.reason);
      if (!done.ok) return done;
      cancelled = done.value;
    }
    await events.flush(tx);
    return ok({ revisions: applied, applied: true, cancelled });
  });
}

export async function rejectRevision(deps: AssessDeps, ctx: RequestContext, input: DecideRevisionInput & { comment: string }): Promise<Result<GradeRevision[], AppError>> {
  const caps = input.caps ?? {};
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis."));
  if (!caps.reviseApprove) return err(forbidden(AssessCode.FORBIDDEN, "Vous n'avez pas le droit de rejeter une correction de note."));
  if (input.comment.trim().length < 5) return err(validation(AssessCode.COMMENT_REQUIRED, "Le motif du rejet est obligatoire (5 caractères au moins).", "comment"));
  return inTx(deps, ctx, async (tx) => {
    const revision = await getRevision(tx, input.revisionId, true);
    if (!revision) return err(notFound(AssessCode.REVISION_NOT_FOUND, "Révision", input.revisionId));
    if (revision.status !== "REQUESTED") return err(conflict(AssessCode.REVISION_TRANSITION, `Cette révision est déjà « ${revision.status} ».`, { status: revision.status }));
    const loaded = await loadAssessment(tx, revision.assessmentId);
    if (!loaded.ok) return loaded;
    const actorName = await deps.ports.names.nameOf(ctx, ctx.userId as string);
    const batch = revision.batchId ? await listRevisionsOfBatch(tx, revision.batchId) : [revision];
    const events = new EventBuffer(deps, ctx);
    const out: GradeRevision[] = [];
    for (const r of batch) {
      if (r.status !== "REQUESTED") continue;
      const d = await guarded(() => decideRevision(tx, { id: r.id, status: "REJECTED", by: ctx.userId as string, byName: actorName, at: deps.clock.now(), comment: input.comment.trim(), fourEyesWaived: r.requestedBy === ctx.userId }));
      if (!d) return err(conflict(AssessCode.REVISION_TRANSITION, "La révision a été traitée entre-temps.", {}));
      out.push(d);
      events.add(AssessEvents.REVISION_REJECTED, { v: 1, ...refOf(loaded.value), revisionId: d.id, enrollmentId: d.enrollmentId, kind: d.kind }, { type: "grade_revision", id: d.id });
      events.audit({ action: "assess.revision.rejected", entity: "grade_revision", entityId: d.id, after: revisionAudit(d), reason: input.comment.trim(), severity: "notice" });
    }
    await events.flush(tx);
    return ok(out);
  });
}

/**
 * Applique les révisions APPROUVÉES en attente d'une classe × période (libération d'un verrou). Appelé avec la
 * transaction de l'appelant. Ne traite pas les lots d'annulation (appliqués à l'approbation).
 */
export async function applyApprovedInTx(deps: AssessDeps, ctx: RequestContext, tx: Tx, input: { classroomId: string; academicPeriodId: string }): Promise<Result<number, AppError>> {
  const pending = await listApprovedUnapplied(tx, input.classroomId, input.academicPeriodId);
  if (pending.length === 0) return ok(0);
  const lock = await getActiveLock(tx, input.classroomId, input.academicPeriodId);
  const events = new EventBuffer(deps, ctx);
  let n = 0;
  for (const r of pending) {
    const a = await getAssessment(tx, r.assessmentId);
    if (!a || a.status !== "PUBLISHED") continue;
    if (lock && lock.lockedSessions.includes(a.sessionNo)) continue;
    await applyOne(deps, ctx, tx, events, a, r);
    n += 1;
  }
  await events.flush(tx);
  return ok(n);
}

/** Application différée d'une révision approuvée (période libérée entre-temps). */
export async function applyRevision(deps: AssessDeps, ctx: RequestContext, input: { revisionId: string; caps?: AssessCaps | undefined }): Promise<Result<GradeRevision, AppError>> {
  const caps = input.caps ?? {};
  if (!caps.reviseApprove) return err(forbidden(AssessCode.FORBIDDEN, "Vous n'avez pas le droit d'appliquer une correction de note."));
  return inTx(deps, ctx, async (tx) => {
    const revision = await getRevision(tx, input.revisionId, true);
    if (!revision) return err(notFound(AssessCode.REVISION_NOT_FOUND, "Révision", input.revisionId));
    if (revision.status !== "APPROVED") return err(conflict(AssessCode.REVISION_NOT_APPROVED, `Seule une révision approuvée s'applique (état « ${revision.status} »).`, { status: revision.status }));
    if (revision.batchId) return err(conflict(AssessCode.REVISION_TRANSITION, "Un lot d'annulation s'applique à son approbation.", {}));
    const loaded = await loadAssessment(tx, revision.assessmentId, "share");
    if (!loaded.ok) return loaded;
    const lock = await getActiveLock(tx, loaded.value.classroomId, loaded.value.academicPeriodId);
    if (lock && lock.lockedSessions.includes(loaded.value.sessionNo)) {
      return err(conflict(AssessCode.PERIOD_LOCKED, "La période est verrouillée pour cette session : rouvrez-la d'abord.", {}));
    }
    const events = new EventBuffer(deps, ctx);
    const applied = await applyOne(deps, ctx, tx, events, loaded.value, revision);
    await events.flush(tx);
    return ok(applied);
  });
}

export async function listRevisionsView(
  deps: AssessDeps,
  ctx: RequestContext,
  input: RevisionFilter & { caps?: AssessCaps | undefined },
): Promise<Result<{ items: GradeRevision[]; nextCursor: string | null }, AppError>> {
  const caps = input.caps ?? {};
  if (!caps.reviseApprove && !caps.reviseRequest && !caps.manage) return err(forbidden(AssessCode.FORBIDDEN, "Vous n'avez pas le droit de consulter les corrections de notes."));
  return inTx(deps, ctx, async (tx) => ok(await listRevisions(tx, input)), { readOnly: true });
}

export async function getRevisionView(deps: AssessDeps, ctx: RequestContext, input: { revisionId: string; caps?: AssessCaps | undefined }): Promise<Result<GradeRevision, AppError>> {
  const caps = input.caps ?? {};
  if (!caps.reviseApprove && !caps.reviseRequest && !caps.manage) return err(forbidden(AssessCode.FORBIDDEN, "Vous n'avez pas le droit de consulter les corrections de notes."));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const r = await getRevision(tx, input.revisionId);
      return r ? ok(r) : err(notFound(AssessCode.REVISION_NOT_FOUND, "Révision", input.revisionId));
    },
    { readOnly: true },
  );
}

export interface GradeHistory {
  grade: Grade;
  assessment: Assessment;
  trail: Awaited<ReturnType<typeof listTransitions>>;
  revisions: GradeRevision[];
}

/** Historique complet d'une note (saisie, soumission, relecture, publication, révisions) — direction (AC3.5). */
export async function getGradeHistory(deps: AssessDeps, ctx: RequestContext, input: { gradeId: string; caps?: AssessCaps | undefined }): Promise<Result<GradeHistory, AppError>> {
  const caps = input.caps ?? {};
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const grade = await getGradeById(tx, input.gradeId);
      if (!grade) return err(notFound(AssessCode.GRADE_NOT_FOUND, "Note", input.gradeId));
      const a = await loadAssessment(tx, grade.assessmentId);
      if (!a.ok) return a;
      const access = await ensureReadAccess(deps, ctx, a.value, caps);
      if (!access.ok) return access;
      return ok({ grade, assessment: a.value, trail: await listTransitions(tx, a.value.id), revisions: await listRevisionsOfGrade(tx, grade.id) });
    },
    { readOnly: true },
  );
}
