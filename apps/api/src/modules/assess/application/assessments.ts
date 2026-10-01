/**
 * Évaluations : création (simple et en lot), modification en brouillon, lecture.
 *
 * Une évaluation appartient à UNE classe, UN nœud de curriculum, UNE période, UNE année, UNE session (1 ou 2) et UN
 * enseignant (R-ASS-01). Barème et poids sont figés dès la soumission (déclencheur 1105). La session 2 n'est ouverte
 * que pour un nœud qui accepte le rattrapage ET un type qui l'autorise (R-ASS-07).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { compareDecimal, isDecimalString } from "../domain/decimal";
import { AssessCode, conflict, forbidden, notFound, validation } from "../domain/errors";
import { AssessEvents } from "../domain/events";
import type { Assessment, AssessmentType, SessionNo } from "../domain/types";
import {
  getAssessment,
  getType,
  insertAssessment,
  insertTransition,
  listAssessments,
  listTransitions,
  updateAssessmentDraft,
  type AssessmentFilter,
} from "../infrastructure/assessments-repository";
import { guarded } from "../infrastructure/db-errors";
import { EventBuffer, inTx, type AssessCaps, type AssessDeps } from "./deps";
import { auditSnapshot, ensureReadAccess, ensureTeacherAccess, loadAssessment, refOf } from "./support";

export interface CreateAssessmentInput {
  typeId: string;
  classroomId: string;
  curriculumNodeId: string;
  academicPeriodId: string;
  title: string;
  assessedOn: string;
  scaleMax?: string | undefined;
  weight?: string | undefined;
  sessionNo?: SessionNo | undefined;
  teacherId?: string | undefined;
  caps?: AssessCaps | undefined;
}

/** Contrôle les références du cœur (classe, période, nœud) et l'affectation de l'enseignant. */
async function checkReferences(
  deps: AssessDeps,
  ctx: RequestContext,
  input: { classroomId: string; curriculumNodeId: string; academicPeriodId: string; sessionNo: SessionNo },
  type: AssessmentType,
): Promise<Result<{ academicYearId: string }, AppError>> {
  const classroom = await deps.ports.roster.getClassroom(ctx, input.classroomId);
  if (!classroom) return err(validation(AssessCode.INVALID_REFERENCE, "Classe introuvable.", "classroomId"));
  const period = await deps.ports.periods.getPeriod(ctx, input.academicPeriodId);
  if (!period) return err(validation(AssessCode.INVALID_REFERENCE, "Période introuvable.", "academicPeriodId"));
  if (period.academicYearId !== classroom.academicYearId) {
    return err(validation(AssessCode.INVALID_REFERENCE, "La période n'appartient pas à l'année de la classe.", "academicPeriodId"));
  }
  const node = await deps.ports.curriculum.getNode(ctx, input.curriculumNodeId);
  if (!node) return err(validation(AssessCode.INVALID_REFERENCE, "Matière / ECUE introuvable.", "curriculumNodeId"));
  if (!(await deps.ports.curriculum.nodeInClassroom(ctx, input.curriculumNodeId, input.classroomId))) {
    return err(validation(AssessCode.INVALID_REFERENCE, "Cette matière ne fait pas partie du programme de la classe.", "curriculumNodeId"));
  }
  if (input.sessionNo === 2) {
    if (!type.allowsSession2) return err(conflict(AssessCode.SESSION2_NOT_ALLOWED, "Ce type d'évaluation n'autorise pas de session de rattrapage.", { typeId: type.id }));
    if (!node.resitAllowed) return err(conflict(AssessCode.SESSION2_NOT_ALLOWED, "Cette matière n'est pas ouverte au rattrapage.", { curriculumNodeId: node.id }));
  }
  return ok({ academicYearId: classroom.academicYearId });
}

async function resolveTeacher(
  deps: AssessDeps,
  ctx: RequestContext,
  input: { teacherId?: string | undefined; classroomId: string; curriculumNodeId: string },
  caps: AssessCaps,
): Promise<Result<string, AppError>> {
  const own = ctx.userId ? await deps.ports.teaching.staffIdForUser(ctx, ctx.userId) : null;
  const teacherId = input.teacherId ?? own;
  if (!teacherId) {
    return err(caps.manage ? validation(AssessCode.INVALID_REFERENCE, "Indiquez l'enseignant de l'évaluation.", "teacherId") : forbidden(AssessCode.NOT_ASSIGNED, "Aucun profil d'enseignant n'est lié à votre compte."));
  }
  if (teacherId !== own && !caps.manage) return err(forbidden(AssessCode.NOT_ASSIGNED, "Vous ne pouvez créer une évaluation que pour vous-même."));
  if (!(await deps.ports.teaching.teaches(ctx, teacherId, input.curriculumNodeId, input.classroomId))) {
    return err(forbidden(AssessCode.NOT_ASSIGNED, "L'enseignant n'est pas affecté à cette matière dans cette classe.", { teacherId }));
  }
  return ok(teacherId);
}

function checkScale(scaleMax: string, weight: string): Result<void, AppError> {
  if (!isDecimalString(scaleMax) || compareDecimal(scaleMax, "0") <= 0) return err(validation(AssessCode.INVALID_ENTRY, "Le barème doit être strictement positif.", "scaleMax"));
  if (!isDecimalString(weight)) return err(validation(AssessCode.INVALID_ENTRY, "Le poids doit être positif ou nul.", "weight"));
  return ok(undefined);
}

async function createInTx(deps: AssessDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, input: CreateAssessmentInput): Promise<Result<Assessment, AppError>> {
  const caps = input.caps ?? {};
  const type = await getType(tx, input.typeId);
  if (!type) return err(notFound(AssessCode.TYPE_NOT_FOUND, "Type d'évaluation", input.typeId));
  if (!type.active) return err(conflict(AssessCode.TYPE_INACTIVE, "Ce type d'évaluation est désactivé.", { typeId: type.id }));
  const sessionNo: SessionNo = input.sessionNo ?? 1;
  const scaleMax = input.scaleMax ?? type.defaultScaleMax;
  const weight = input.weight ?? type.defaultWeight;
  const scaled = checkScale(scaleMax, weight);
  if (!scaled.ok) return scaled;
  const refs = await checkReferences(deps, ctx, { ...input, sessionNo }, type);
  if (!refs.ok) return refs;
  const teacher = await resolveTeacher(deps, ctx, input, caps);
  if (!teacher.ok) return teacher;
  if (!ctx.userId) return err(forbidden(AssessCode.FORBIDDEN, "Un utilisateur authentifié est requis."));

  const id = deps.newId();
  const now = deps.clock.now();
  await guarded(() =>
    insertAssessment(tx, {
      id,
      tenantId: ctx.tenantId,
      typeId: type.id,
      classroomId: input.classroomId,
      curriculumNodeId: input.curriculumNodeId,
      academicPeriodId: input.academicPeriodId,
      academicYearId: refs.value.academicYearId,
      teacherId: teacher.value,
      title: input.title,
      assessedOn: input.assessedOn,
      scaleMax,
      weight,
      sessionNo,
      createdBy: ctx.userId as string,
      now,
    }),
  );
  await insertTransition(tx, {
    id: deps.newId(),
    tenantId: ctx.tenantId,
    assessmentId: id,
    from: null,
    to: "DRAFT",
    actorId: ctx.userId,
    actorName: await deps.ports.names.nameOf(ctx, ctx.userId),
    comment: null,
    fourEyesWaived: false,
    at: now,
  });
  const created = (await getAssessment(tx, id)) as Assessment;
  events.add(AssessEvents.ASSESSMENT_CREATED, { v: 1, ...refOf(created), status: created.status }, { type: "assessment", id });
  events.audit({ action: "assess.assessment.created", entity: "assessment", entityId: id, after: auditSnapshot(created), severity: "info" });
  return ok(created);
}

export async function createAssessment(deps: AssessDeps, ctx: RequestContext, input: CreateAssessmentInput): Promise<Result<Assessment, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const created = await createInTx(deps, ctx, tx, events, input);
    if (!created.ok) return created;
    await events.flush(tx);
    return created;
  });
}

export interface BulkCreateInput {
  typeId: string;
  academicPeriodId: string;
  title: string;
  assessedOn: string;
  scaleMax?: string | undefined;
  weight?: string | undefined;
  sessionNo?: SessionNo | undefined;
  targets: ReadonlyArray<{ classroomId: string; curriculumNodeId: string; teacherId?: string | undefined }>;
  caps?: AssessCaps | undefined;
}

/** Duplication vers d'autres classes (P-ASS-03) : tout ou rien. */
export async function bulkCreateAssessments(deps: AssessDeps, ctx: RequestContext, input: BulkCreateInput): Promise<Result<Assessment[], AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    const out: Assessment[] = [];
    for (const target of input.targets) {
      const created = await createInTx(deps, ctx, tx, events, {
        typeId: input.typeId,
        academicPeriodId: input.academicPeriodId,
        title: input.title,
        assessedOn: input.assessedOn,
        scaleMax: input.scaleMax,
        weight: input.weight,
        sessionNo: input.sessionNo,
        classroomId: target.classroomId,
        curriculumNodeId: target.curriculumNodeId,
        teacherId: target.teacherId,
        caps: input.caps,
      });
      if (!created.ok) return err(created.error);
      out.push(created.value);
    }
    await events.flush(tx);
    return ok(out);
  });
}

export interface UpdateAssessmentInput {
  assessmentId: string;
  typeId?: string | undefined;
  title?: string | undefined;
  assessedOn?: string | undefined;
  scaleMax?: string | undefined;
  weight?: string | undefined;
  sessionNo?: SessionNo | undefined;
  curriculumNodeId?: string | undefined;
  academicPeriodId?: string | undefined;
  teacherId?: string | undefined;
  rowVersion?: number | undefined;
  caps?: AssessCaps | undefined;
}

export async function updateAssessment(deps: AssessDeps, ctx: RequestContext, input: UpdateAssessmentInput): Promise<Result<Assessment, AppError>> {
  const caps = input.caps ?? {};
  return inTx(deps, ctx, async (tx) => {
    const current = await loadAssessment(tx, input.assessmentId, "update");
    if (!current.ok) return current;
    const a = current.value;
    const access = await ensureTeacherAccess(deps, ctx, a, caps);
    if (!access.ok) return access;
    if (a.status !== "DRAFT") {
      return err(conflict(AssessCode.ASSESSMENT_FROZEN, "Une évaluation ne se modifie qu'en brouillon : barème, poids, nœud et période sont figés dès la soumission.", { status: a.status }));
    }
    if (input.rowVersion !== undefined && input.rowVersion !== a.rowVersion) {
      return err(conflict(AssessCode.STALE_ASSESSMENT, "L'évaluation a été modifiée entre-temps : rechargez-la.", { rowVersion: a.rowVersion }));
    }

    const type = input.typeId ? await getType(tx, input.typeId) : await getType(tx, a.typeId);
    if (!type) return err(notFound(AssessCode.TYPE_NOT_FOUND, "Type d'évaluation", input.typeId ?? a.typeId));
    if (input.typeId && !type.active) return err(conflict(AssessCode.TYPE_INACTIVE, "Ce type d'évaluation est désactivé.", { typeId: type.id }));

    const next = {
      curriculumNodeId: input.curriculumNodeId ?? a.curriculumNodeId,
      academicPeriodId: input.academicPeriodId ?? a.academicPeriodId,
      sessionNo: (input.sessionNo ?? a.sessionNo) as SessionNo,
      scaleMax: input.scaleMax ?? a.scaleMax,
      weight: input.weight ?? a.weight,
      teacherId: input.teacherId ?? a.teacherId,
    };
    const scaled = checkScale(next.scaleMax, next.weight);
    if (!scaled.ok) return scaled;
    const refs = await checkReferences(deps, ctx, { classroomId: a.classroomId, curriculumNodeId: next.curriculumNodeId, academicPeriodId: next.academicPeriodId, sessionNo: next.sessionNo }, type);
    if (!refs.ok) return refs;
    if (input.teacherId && input.teacherId !== a.teacherId) {
      // Reprise par un remplaçant (transfert tracé par l'audit) : réservée à la gestion, et le remplaçant doit être affecté.
      if (!caps.manage) return err(forbidden(AssessCode.NOT_ASSIGNED, "Seule la gestion pédagogique transfère une évaluation."));
      if (!(await deps.ports.teaching.teaches(ctx, next.teacherId, next.curriculumNodeId, a.classroomId))) {
        return err(forbidden(AssessCode.NOT_ASSIGNED, "Le remplaçant n'est pas affecté à cette matière dans cette classe."));
      }
    }

    const ok1 = await guarded(() =>
      updateAssessmentDraft(
        tx,
        a.id,
        a.rowVersion,
        { typeId: input.typeId, title: input.title, assessedOn: input.assessedOn, scaleMax: input.scaleMax, weight: input.weight, sessionNo: input.sessionNo, curriculumNodeId: input.curriculumNodeId, academicPeriodId: input.academicPeriodId, academicYearId: refs.value.academicYearId, teacherId: input.teacherId },
        deps.clock.now(),
      ),
    );
    if (!ok1) return err(conflict(AssessCode.STALE_ASSESSMENT, "L'évaluation a été modifiée entre-temps : rechargez-la."));
    const after = (await getAssessment(tx, a.id)) as Assessment;
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: input.teacherId && input.teacherId !== a.teacherId ? "assess.assessment.transferred" : "assess.assessment.updated",
      entity: "assessment",
      entityId: a.id,
      before: auditSnapshot(a),
      after: auditSnapshot(after),
      severity: "info",
    });
    await events.flush(tx);
    return ok(after);
  });
}

export async function getAssessmentView(
  deps: AssessDeps,
  ctx: RequestContext,
  input: { assessmentId: string; caps?: AssessCaps | undefined },
): Promise<Result<Assessment, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const a = await loadAssessment(tx, input.assessmentId);
      if (!a.ok) return a;
      const access = await ensureReadAccess(deps, ctx, a.value, input.caps ?? {});
      if (!access.ok) return access;
      return a;
    },
    { readOnly: true },
  );
}

export async function listAssessmentsView(
  deps: AssessDeps,
  ctx: RequestContext,
  input: AssessmentFilter & { mine?: boolean | undefined; caps?: AssessCaps | undefined },
): Promise<Result<{ items: Assessment[]; nextCursor: string | null }, AppError>> {
  const caps = input.caps ?? {};
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const filter: AssessmentFilter = { ...input };
      // Sans droit étendu, l'enseignant ne voit que SES évaluations (AC1.1).
      if (input.mine || !(caps.manage || caps.review || caps.validate || caps.publish)) {
        const staffId = ctx.userId ? await deps.ports.teaching.staffIdForUser(ctx, ctx.userId) : null;
        if (!staffId) return ok({ items: [], nextCursor: null });
        filter.teacherId = staffId;
      }
      return ok(await listAssessments(tx, filter));
    },
    { readOnly: true },
  );
}

export async function getAssessmentTransitions(deps: AssessDeps, ctx: RequestContext, input: { assessmentId: string; caps?: AssessCaps | undefined }) {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const a = await loadAssessment(tx, input.assessmentId);
      if (!a.ok) return a;
      const access = await ensureReadAccess(deps, ctx, a.value, input.caps ?? {});
      if (!access.ok) return access;
      return ok(await listTransitions(tx, input.assessmentId));
    },
    { readOnly: true },
  );
}
