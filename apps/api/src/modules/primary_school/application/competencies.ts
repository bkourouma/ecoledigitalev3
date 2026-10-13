/**
 * Évaluation par compétences (maternelle et primaire) : grille élèves × compétences, saisie en lot idempotente, validation,
 * révision tracée, synthèse par COMPTEURS. Aucune moyenne, aucun seuil.
 *
 *  - saisie : tout ou rien, ≤ 500 lignes ; rejouer un lot ne change rien (valeurs identiques = `unchanged`) ; une ligne existante dont
 *    la valeur diffère exige `rowVersion` (verrou optimiste) ; une ligne VALIDÉE ne se corrige que par une RÉVISION ;
 *  - verrou de période : contrôlé par le port `PeriodStatePort` (échec fermé) PUIS par le déclencheur SQL (défense en profondeur) ;
 *  - la trace d'une révision précède la correction dans la MÊME transaction (le déclencheur l'exige).
 */
import { err, ok, type AppError, type RequestContext, type Result, ValidationError } from "@ecoledigitale/kernel";
import { PRIMARY_BULK_MAX_LINES, type PrimaryBulkRecordBody, type PrimaryReviseBody } from "@ecoledigitale/contracts/src/v2/primary_school";
import type { Tx } from "@ecoledigitale/database";
import { completenessOf, decideBulkLine, summarizeCompetencies, type Completeness } from "../domain/competency";
import { PrimaryCode, conflict, forbidden, forbiddenCode, notFound, validation } from "../domain/errors";
import { PrimaryEvents } from "../domain/events";
import type { CallerCaps, CompetencyAssessment, CompetencyRevision, Framework, FrameworkDetail, RosterEntry, Uuid } from "../domain/types";
import { guarded } from "../infrastructure/db-errors";
import {
  applyRevision,
  countByStatus,
  getAssessmentRow,
  insertAssessmentRow,
  insertRevisionRow,
  labelsOfEnrollment,
  listAssessmentsOfClass,
  listRevisionsOf,
  summarizeInSql,
  summaryRowsOf,
  syncPeriodLock,
  updateDraftAssessment,
  validateClassPeriod,
} from "../infrastructure/assessments-repository";
import { getReadiness, readyPeriodIdsOfClass, summarizeForFamily, validatedPeriodIdsOfClass } from "../infrastructure/readiness-repository";
import { getFrameworkRow, listFrameworkRows } from "../infrastructure/reference-repository";
import { requireClassAccess, requireFamilyStudent } from "./access";
import { actorOf, EventBuffer, inTx, todayOf, type PrimarySchoolDeps } from "./deps";
import { frameworkDetailOf } from "./frameworks";
import type { ClassroomInfo, PeriodInfo } from "./ports";

/** Verrou consultatif de transaction : sérialise les écritures concurrentes d'une même classe × période. */
export async function lockClassPeriod(tx: Tx, ctx: RequestContext, classroomId: Uuid, periodId: Uuid): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`primary_school:competencies:${ctx.tenantId}:${classroomId}:${periodId}`]);
}

export async function requirePeriod(deps: PrimarySchoolDeps, ctx: RequestContext, classroom: ClassroomInfo, periodId: Uuid): Promise<Result<PeriodInfo, AppError>> {
  const periods = await deps.ports.classrooms.listPeriods(ctx, classroom.academicYearId);
  const period = periods.find((p) => p.id === periodId);
  return period ? ok(period) : err(validation(PrimaryCode.INVALID_INPUT, "Cette période n'appartient pas à l'année de la classe.", "periodId"));
}

/** Un référentiel s'applique à une classe si son niveau de classe figure parmi ses niveaux d'application. */
const appliesTo = (fw: Pick<Framework, "gradeLevelCodes">, gradeLevelCode: string | null): boolean => gradeLevelCode === null || fw.gradeLevelCodes.includes(gradeLevelCode);

// ---------------------------------------------------------------------------
// Grille
// ---------------------------------------------------------------------------

export interface CompetencySheet {
  classroomId: Uuid;
  periodId: Uuid;
  gradeLevelCode: string;
  locked: boolean;
  frameworks: Framework[];
  framework: FrameworkDetail | null;
  students: RosterEntry[];
  assessments: CompetencyAssessment[];
  completeness: Completeness;
}

export async function getCompetencySheet(
  deps: PrimarySchoolDeps,
  ctx: RequestContext,
  input: { classroomId: Uuid; periodId: Uuid; frameworkId?: Uuid | undefined },
  caps: CallerCaps,
): Promise<Result<CompetencySheet, AppError>> {
  const access = await requireClassAccess(deps, ctx, input.classroomId, caps);
  if (!access.ok) return access;
  const { classroom } = access.value;
  const period = await requirePeriod(deps, ctx, classroom, input.periodId);
  if (!period.ok) return period;
  const state = await deps.ports.periods.getState(ctx, { classroomId: classroom.id, periodId: input.periodId });
  const roster = await deps.ports.classrooms.listRoster(ctx, classroom.id);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const published = (await listFrameworkRows(tx, { status: "PUBLISHED" })).filter((f) => appliesTo(f, classroom.gradeLevelCode));
      let chosen: Framework | null = null;
      if (input.frameworkId) {
        chosen = await getFrameworkRow(tx, input.frameworkId);
        if (!chosen) return err(notFound(PrimaryCode.FRAMEWORK_NOT_FOUND, "Référentiel", input.frameworkId));
      } else chosen = published[0] ?? null;
      const detail = chosen ? await frameworkDetailOf(tx, chosen) : null;
      const assessments = chosen ? await listAssessmentsOfClass(tx, { classroomId: classroom.id, periodId: input.periodId, frameworkId: chosen.id }) : [];
      const students: RosterEntry[] = roster.map((r) => ({ enrollmentId: r.enrollmentId, studentId: r.studentId, displayName: r.displayName, isRepeating: r.isRepeating }));
      const completeness = completenessOf({
        competencyIds: detail ? detail.domains.flatMap((d) => d.competencies.map((c) => c.id)) : [],
        enrollmentIds: students.map((s) => s.enrollmentId),
        assessments,
      });
      return ok<CompetencySheet>({
        classroomId: classroom.id,
        periodId: input.periodId,
        gradeLevelCode: classroom.gradeLevelCode ?? "",
        locked: state.locked,
        frameworks: published,
        framework: detail,
        students,
        assessments,
        completeness,
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// Saisie en lot
// ---------------------------------------------------------------------------

export interface BulkResult {
  created: number;
  updated: number;
  unchanged: number;
  assessments: CompetencyAssessment[];
}

export async function bulkRecordCompetencies(deps: PrimarySchoolDeps, ctx: RequestContext, input: PrimaryBulkRecordBody, caps: CallerCaps): Promise<Result<BulkResult, AppError>> {
  if (input.lines.length > PRIMARY_BULK_MAX_LINES) return err(validation(PrimaryCode.INVALID_INPUT, `Un lot compte au plus ${PRIMARY_BULK_MAX_LINES} lignes.`, "lines"));
  const access = await requireClassAccess(deps, ctx, input.classroomId, caps);
  if (!access.ok) return access;
  const { classroom, staffId } = access.value;
  if (!staffId) return err(forbiddenCode(PrimaryCode.STAFF_PROFILE_REQUIRED, "Un compte sans fiche de personnel ne saisit pas d'évaluation (l'auteur de la saisie est tracé)."));
  const period = await requirePeriod(deps, ctx, classroom, input.periodId);
  if (!period.ok) return period;
  const state = await deps.ports.periods.getState(ctx, { classroomId: classroom.id, periodId: input.periodId });
  if (state.locked) return err(conflict(PrimaryCode.PERIOD_LOCKED, "La saisie est arrêtée pour cette classe et cette période.", { classroomId: classroom.id, periodId: input.periodId }));
  const roster = await deps.ports.classrooms.listRoster(ctx, classroom.id);
  const studentOf = new Map(roster.map((r) => [r.enrollmentId, r.studentId]));

  // Doublons dans le lot : une seule valeur par (inscription, compétence).
  const seen = new Set<string>();
  for (const [i, l] of input.lines.entries()) {
    const key = `${l.enrollmentId}:${l.competencyId}`;
    if (seen.has(key)) return err(validation(PrimaryCode.INVALID_INPUT, "Le lot contient deux valeurs pour la même compétence d'un même élève.", ["lines", i]));
    seen.add(key);
  }

  return inTx(deps, ctx, async (tx) => {
    const fw = await getFrameworkRow(tx, input.frameworkId);
    if (!fw) return err(notFound(PrimaryCode.FRAMEWORK_NOT_FOUND, "Référentiel", input.frameworkId));
    if (fw.status !== "PUBLISHED") return err(conflict(PrimaryCode.FRAMEWORK_NOT_PUBLISHED, "Seul un référentiel publié s'évalue.", { status: fw.status }));
    if (!appliesTo(fw, classroom.gradeLevelCode)) return err(conflict(PrimaryCode.FRAMEWORK_NOT_APPLICABLE, "Ce référentiel ne s'applique pas au niveau de cette classe.", { gradeLevelCode: classroom.gradeLevelCode }));
    const detail = await frameworkDetailOf(tx, fw);
    const competencyIds = new Set(detail.domains.flatMap((d) => d.competencies.map((c) => c.id)));
    const levelIds = new Set(detail.scale.levels.map((l) => l.id));

    await lockClassPeriod(tx, ctx, classroom.id, input.periodId);
    // Q-P18 : une classe × période marquée « prête » est gelée pour la saisie (le déclencheur SQL est la défense en profondeur).
    if ((await getReadiness(tx, classroom.id, input.periodId))?.status === "READY") {
      return err(conflict(PrimaryCode.PERIOD_READY, "La classe et la période sont marquées prêtes : retirer le marquage avant de modifier la saisie.", { classroomId: classroom.id, periodId: input.periodId }));
    }
    // Le miroir local du verrou est aligné sur l'état effectif lu auprès d'academic (défense en profondeur du déclencheur).
    await syncPeriodLock(tx, { tenantId: ctx.tenantId, classroomId: classroom.id, periodId: input.periodId, locked: false, now: deps.clock.now() });

    const existing = await listAssessmentsOfClass(tx, { classroomId: classroom.id, periodId: input.periodId });
    const existingBy = new Map(existing.map((a) => [`${a.enrollmentId}:${a.competencyId}`, a]));

    const issues: Array<{ path: Array<string | number>; message: string; code: string }> = [];
    type Plan = { kind: "create" | "update" | "unchanged"; line: (typeof input.lines)[number]; current: CompetencyAssessment | undefined };
    const plans: Plan[] = [];
    for (const [i, line] of input.lines.entries()) {
      if (!studentOf.has(line.enrollmentId)) {
        issues.push({ path: ["lines", i, "enrollmentId"], message: "Cet élève n'est pas inscrit dans cette classe.", code: PrimaryCode.ENROLLMENT_NOT_IN_CLASS });
        continue;
      }
      if (!competencyIds.has(line.competencyId)) {
        issues.push({ path: ["lines", i, "competencyId"], message: "Cette compétence n'appartient pas au référentiel.", code: PrimaryCode.COMPETENCY_UNKNOWN });
        continue;
      }
      if (!levelIds.has(line.ratingLevelId)) {
        issues.push({ path: ["lines", i, "ratingLevelId"], message: "Ce niveau n'appartient pas à l'échelle du référentiel.", code: PrimaryCode.SCALE_MISMATCH });
        continue;
      }
      const current = existingBy.get(`${line.enrollmentId}:${line.competencyId}`);
      const outcome = decideBulkLine(
        current && { ratingLevelId: current.ratingLevelId, note: current.note, observedOn: current.observedOn, status: current.status, rowVersion: current.rowVersion },
        { ratingLevelId: line.ratingLevelId, note: line.note ?? null, observedOn: line.observedOn ?? null, rowVersion: line.rowVersion },
      );
      if (outcome === "frozen") issues.push({ path: ["lines", i], message: "Appréciation validée : seule une révision motivée la corrige.", code: PrimaryCode.VALIDATED_FROZEN });
      else if (outcome === "row_version_conflict") issues.push({ path: ["lines", i, "rowVersion"], message: "La ligne a changé depuis votre lecture (version différente).", code: PrimaryCode.ROW_VERSION_CONFLICT });
      else plans.push({ kind: outcome, line, current });
    }
    if (issues.length > 0) {
      const frozen = issues.some((x) => x.code === PrimaryCode.VALIDATED_FROZEN || x.code === PrimaryCode.ROW_VERSION_CONFLICT);
      if (frozen && issues.every((x) => x.code === PrimaryCode.VALIDATED_FROZEN || x.code === PrimaryCode.ROW_VERSION_CONFLICT)) {
        const first = issues[0] as (typeof issues)[number];
        return err(conflict(first.code === PrimaryCode.ROW_VERSION_CONFLICT ? PrimaryCode.ROW_VERSION_CONFLICT : PrimaryCode.VALIDATED_FROZEN, first.message, { issues }));
      }
      return err(new ValidationError("Lot refusé : aucune ligne n'a été enregistrée.", issues, { code: PrimaryCode.INVALID_INPUT }));
    }

    const today = todayOf(deps);
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const touched: Uuid[] = [];
    for (const p of plans) {
      if (p.kind === "unchanged") {
        unchanged += 1;
        touched.push((p.current as CompetencyAssessment).id);
        continue;
      }
      if (p.kind === "create") {
        const id = deps.newId();
        await guarded(() =>
          insertAssessmentRow(tx, {
            id,
            tenantId: ctx.tenantId,
            classroomId: classroom.id,
            periodId: input.periodId,
            enrollmentId: p.line.enrollmentId,
            studentId: studentOf.get(p.line.enrollmentId) as Uuid,
            frameworkId: fw.id,
            competencyId: p.line.competencyId,
            scaleId: fw.scaleId,
            ratingLevelId: p.line.ratingLevelId,
            observedOn: p.line.observedOn ?? today,
            staffId,
            note: p.line.note ?? null,
          }),
        );
        created += 1;
        touched.push(id);
      } else {
        const cur = p.current as CompetencyAssessment;
        await guarded(() => updateDraftAssessment(tx, cur.id, { ratingLevelId: p.line.ratingLevelId, observedOn: p.line.observedOn ?? cur.observedOn, note: p.line.note === undefined ? cur.note : p.line.note, staffId }));
        updated += 1;
        touched.push(cur.id);
      }
    }
    const events = new EventBuffer(deps, ctx);
    if (created + updated > 0) {
      events.audit({
        action: "primary_school.competency.recorded",
        resourceType: "classroom_period",
        resourceId: `${classroom.id}:${input.periodId}`,
        metadata: { classroomId: classroom.id, periodId: input.periodId, frameworkId: fw.id, created, updated, unchanged },
      });
    }
    await events.flush(tx);
    const all = await listAssessmentsOfClass(tx, { classroomId: classroom.id, periodId: input.periodId, frameworkId: fw.id });
    const touchedSet = new Set(touched);
    return ok<BulkResult>({ created, updated, unchanged, assessments: all.filter((a) => touchedSet.has(a.id)) });
  });
}

// ---------------------------------------------------------------------------
// Validation de la grille
// ---------------------------------------------------------------------------

export interface ValidateResult {
  validated: number;
  alreadyValidated: number;
  expected: number;
  missing: number;
}

export async function validateCompetencies(
  deps: PrimarySchoolDeps,
  ctx: RequestContext,
  input: { classroomId: Uuid; periodId: Uuid; frameworkId?: Uuid | undefined },
  caps: CallerCaps,
): Promise<Result<ValidateResult, AppError>> {
  const access = await requireClassAccess(deps, ctx, input.classroomId, caps);
  if (!access.ok) return access;
  const { classroom } = access.value;
  if (!ctx.userId) return err(forbidden("Un utilisateur authentifié est requis."));
  const period = await requirePeriod(deps, ctx, classroom, input.periodId);
  if (!period.ok) return period;
  const state = await deps.ports.periods.getState(ctx, { classroomId: classroom.id, periodId: input.periodId });
  if (state.locked) return err(conflict(PrimaryCode.PERIOD_LOCKED, "La période est verrouillée : la grille ne peut plus être validée.", { classroomId: classroom.id, periodId: input.periodId }));
  const roster = await deps.ports.classrooms.listRoster(ctx, classroom.id);
  return inTx(deps, ctx, async (tx) => {
    await lockClassPeriod(tx, ctx, classroom.id, input.periodId);
    await syncPeriodLock(tx, { tenantId: ctx.tenantId, classroomId: classroom.id, periodId: input.periodId, locked: false, now: deps.clock.now() });
    const before = await countByStatus(tx, { classroomId: classroom.id, periodId: input.periodId, frameworkId: input.frameworkId });
    const validated = await guarded(() => validateClassPeriod(tx, { classroomId: classroom.id, periodId: input.periodId, frameworkId: input.frameworkId, by: ctx.userId as Uuid, now: deps.clock.now() }));
    let expected = 0;
    if (input.frameworkId) {
      const fw = await getFrameworkRow(tx, input.frameworkId);
      expected = (fw?.competencyCount ?? 0) * roster.length;
    }
    const total = before.draft + before.validated;
    const missing = input.frameworkId ? Math.max(expected - total, 0) : 0;
    const events = new EventBuffer(deps, ctx);
    events.add(
      PrimaryEvents.COMPETENCY_VALIDATED,
      { v: 1, classroomId: classroom.id, periodId: input.periodId, frameworkId: input.frameworkId ?? null, validated, missing },
      { type: "primary_school.classroom_period", id: `${classroom.id}:${input.periodId}` },
    );
    events.audit({ action: "primary_school.competency.validated", resourceType: "classroom_period", resourceId: `${classroom.id}:${input.periodId}`, metadata: { classroomId: classroom.id, periodId: input.periodId, validated, alreadyValidated: before.validated, missing } });
    await events.flush(tx);
    return ok<ValidateResult>({ validated, alreadyValidated: before.validated, expected, missing });
  });
}

// ---------------------------------------------------------------------------
// Révision tracée
// ---------------------------------------------------------------------------

export interface RevisionOutcome {
  assessment: CompetencyAssessment;
  revision: CompetencyRevision;
}

export async function reviseCompetencyAssessment(deps: PrimarySchoolDeps, ctx: RequestContext, assessmentId: Uuid, input: PrimaryReviseBody, caps: CallerCaps): Promise<Result<RevisionOutcome, AppError>> {
  if (!ctx.userId) return err(forbidden("Un utilisateur authentifié est requis."));
  const userId = ctx.userId;
  if (input.reason.trim().length < 10) return err(validation(PrimaryCode.INVALID_INPUT, "Le motif de révision compte au moins 10 caractères.", "reason"));
  // Lecture préalable (hors transaction d'écriture) : on ne connaît la classe qu'une fois la ligne lue.
  const probe = await inTx(deps, ctx, async (tx) => ok(await getAssessmentRow(tx, assessmentId)), { readOnly: true });
  if (!probe.ok) return probe;
  if (!probe.value) return err(notFound(PrimaryCode.ASSESSMENT_NOT_FOUND, "Appréciation", assessmentId));
  const access = await requireClassAccess(deps, ctx, probe.value.classroomId, caps);
  if (!access.ok) return access;
  const state = await deps.ports.periods.getState(ctx, { classroomId: probe.value.classroomId, periodId: probe.value.academicPeriodId });
  if (state.locked) return err(conflict(PrimaryCode.PERIOD_LOCKED, "La période est verrouillée : rouvrir la période avant de réviser.", { periodId: probe.value.academicPeriodId }));

  return inTx(deps, ctx, async (tx) => {
    await lockClassPeriod(tx, ctx, probe.value!.classroomId, probe.value!.academicPeriodId);
    const current = await getAssessmentRow(tx, assessmentId, true);
    if (!current) return err(notFound(PrimaryCode.ASSESSMENT_NOT_FOUND, "Appréciation", assessmentId));
    if (current.status !== "VALIDATED") return err(conflict(PrimaryCode.ASSESSMENT_NOT_VALIDATED, "Seule une appréciation validée se révise ; un brouillon se corrige par la saisie.", { status: current.status }));
    if (current.ratingLevelId === input.toRatingLevelId) return err(validation(PrimaryCode.REVISION_SAME_LEVEL, "Le nouveau niveau est identique à l'actuel.", "toRatingLevelId"));
    const fw = await getFrameworkRow(tx, current.frameworkId);
    const detail = fw ? await frameworkDetailOf(tx, fw) : null;
    if (!detail || !detail.scale.levels.some((l) => l.id === input.toRatingLevelId)) {
      return err(validation(PrimaryCode.SCALE_MISMATCH, "Ce niveau n'appartient pas à l'échelle du référentiel.", "toRatingLevelId"));
    }
    await syncPeriodLock(tx, { tenantId: ctx.tenantId, classroomId: current.classroomId, periodId: current.academicPeriodId, locked: false, now: deps.clock.now() });
    // La trace PRÉCÈDE la correction, dans la même transaction (le déclencheur SQL l'exige).
    const revision = await guarded(() =>
      insertRevisionRow(tx, { id: deps.newId(), tenantId: ctx.tenantId, assessmentId, fromLevelId: current.ratingLevelId, toLevelId: input.toRatingLevelId, reason: input.reason, requestedBy: userId }),
    );
    const assessment = await guarded(() => applyRevision(tx, assessmentId, input.toRatingLevelId));
    const events = new EventBuffer(deps, ctx);
    events.add(
      PrimaryEvents.COMPETENCY_REVISED,
      { v: 1, assessmentId, revisionId: revision.id, classroomId: current.classroomId, periodId: current.academicPeriodId, enrollmentId: current.enrollmentId },
      { type: "primary_school.competency_assessment", id: assessmentId },
    );
    // Ni niveau ni appréciation dans l'audit : les identifiants suffisent, la révision (table) porte le détail.
    events.audit({ action: "primary_school.competency.revised", resourceType: "competency_assessment", resourceId: assessmentId, reason: input.reason, metadata: { revisionId: revision.id, classroomId: current.classroomId, periodId: current.academicPeriodId }, sensitive: true });
    await events.flush(tx);
    return ok<RevisionOutcome>({ assessment, revision });
  });
}

export async function listAssessmentRevisions(deps: PrimarySchoolDeps, ctx: RequestContext, assessmentId: Uuid, caps: CallerCaps): Promise<Result<CompetencyRevision[], AppError>> {
  const probe = await inTx(deps, ctx, async (tx) => ok(await getAssessmentRow(tx, assessmentId)), { readOnly: true });
  if (!probe.ok) return probe;
  if (!probe.value) return err(notFound(PrimaryCode.ASSESSMENT_NOT_FOUND, "Appréciation", assessmentId));
  const access = await requireClassAccess(deps, ctx, probe.value.classroomId, caps);
  if (!access.ok) return access;
  return inTx(deps, ctx, async (tx) => ok(await listRevisionsOf(tx, assessmentId)), { readOnly: true });
}

// ---------------------------------------------------------------------------
// Synthèse (compteurs)
// ---------------------------------------------------------------------------

export interface CompetencySummaryView {
  enrollmentId: Uuid;
  periodIds: Uuid[] | null;
  summary: Record<string, Record<string, number>>;
  domainLabels: Record<string, string>;
  levelLabels: Record<string, string>;
  levelOrder: string[];
}

async function buildSummary(tx: Tx, enrollmentId: Uuid, periodIds: Uuid[] | null): Promise<CompetencySummaryView> {
  const summary = await summarizeInSql(tx, enrollmentId, periodIds);
  const labels = await labelsOfEnrollment(tx, enrollmentId);
  return {
    enrollmentId,
    periodIds,
    summary,
    domainLabels: labels.domains,
    levelLabels: Object.fromEntries(labels.levels.map((l) => [l.code, l.label])),
    levelOrder: labels.levels.map((l) => l.code),
  };
}

/** Synthèse pour le PERSONNEL : lignes validées de l'inscription ; l'accès suit la classe. */
export async function getCompetencySummary(deps: PrimarySchoolDeps, ctx: RequestContext, input: { enrollmentId: Uuid; periodIds?: Uuid[] | undefined }, caps: CallerCaps): Promise<Result<CompetencySummaryView, AppError>> {
  const enrollment = await deps.ports.classrooms.getEnrollment(ctx, input.enrollmentId);
  if (!enrollment) return err(notFound(PrimaryCode.ENROLLMENT_NOT_IN_CLASS, "Inscription", input.enrollmentId));
  const access = await requireClassAccess(deps, ctx, enrollment.classroomId, caps);
  if (!access.ok) return access;
  return inTx(deps, ctx, async (tx) => ok(await buildSummary(tx, input.enrollmentId, input.periodIds ?? null)), { readOnly: true });
}

/**
 * Synthèse pour la FAMILLE (élève lui-même ou tuteur) : seules les périodes dont le bulletin est PUBLIÉ sont visibles (AC5.6).
 * `studentId = null` : l'élève connecté.
 */
export async function getFamilyCompetencySummary(
  deps: PrimarySchoolDeps,
  ctx: RequestContext,
  input: { studentId: Uuid | null; enrollmentId: Uuid; periodIds?: Uuid[] | undefined },
): Promise<Result<CompetencySummaryView, AppError>> {
  const enrollment = await deps.ports.classrooms.getEnrollment(ctx, input.enrollmentId);
  const student = await requireFamilyStudent(deps, ctx, input.studentId ?? (enrollment?.studentId ?? null));
  if (!student.ok) return student;
  if (!enrollment || enrollment.studentId !== student.value) return err(notFound(PrimaryCode.ENROLLMENT_NOT_IN_CLASS, "Inscription", input.enrollmentId));
  const published = await deps.ports.documents.publishedPeriodIds(ctx, { studentId: student.value, enrollmentId: enrollment.id });
  return inTx(
    deps,
    ctx,
    async (tx) => {
      // Q-P18 : visible = bulletin publié, OU classe × période marquée « prête », OU grille validée. Jamais une saisie brouillon
      // hors d'une période prête (qui est gelée) : les brouillons ne comptent que dans les périodes prêtes.
      const ready = await readyPeriodIdsOfClass(tx, enrollment.classroomId);
      const validated = await validatedPeriodIdsOfClass(tx, enrollment.classroomId);
      const visible = new Set<Uuid>([...published, ...ready, ...validated]);
      const wanted = input.periodIds ? input.periodIds.filter((p) => visible.has(p)) : [...visible];
      if (wanted.length === 0) return ok<CompetencySummaryView>({ enrollmentId: enrollment.id, periodIds: [], summary: {}, domainLabels: {}, levelLabels: {}, levelOrder: [] });
      const labels = await labelsOfEnrollment(tx, enrollment.id);
      return ok<CompetencySummaryView>({
        enrollmentId: enrollment.id,
        periodIds: wanted,
        summary: await summarizeForFamily(tx, enrollment.id, wanted, ready),
        domainLabels: labels.domains,
        levelLabels: Object.fromEntries(labels.levels.map((l) => [l.code, l.label])),
        levelOrder: labels.levels.map((l) => l.code),
      });
    },
    { readOnly: true },
  );
}

// ---------------------------------------------------------------------------
// « Ma classe » (portail instituteur / direction)
// ---------------------------------------------------------------------------

export interface MyClassroomView {
  classroomId: Uuid;
  name: string | null;
  gradeLevelCode: string | null;
  academicYearId: Uuid;
  studentCount: number;
  periods: Array<{ id: Uuid; label: string; locked: boolean; ready: boolean }>;
  isHomeroom: boolean;
}

export async function listMyClassrooms(deps: PrimarySchoolDeps, ctx: RequestContext, caps: CallerCaps, filter: { academicYearId?: Uuid | undefined } = {}): Promise<Result<MyClassroomView[], AppError>> {
  const staffId = ctx.userId ? await deps.ports.teaching.staffIdForUser(ctx, ctx.userId) : null;
  let classrooms: readonly ClassroomInfo[];
  if (caps.allClasses) classrooms = await deps.ports.classrooms.listClassrooms(ctx, { academicYearId: filter.academicYearId });
  else {
    if (!staffId) return ok([]);
    const ids = await deps.ports.teaching.classroomIdsOfStaff(ctx, staffId);
    const found: ClassroomInfo[] = [];
    for (const id of ids) {
      const c = await deps.ports.classrooms.getClassroom(ctx, id);
      if (c && (!filter.academicYearId || c.academicYearId === filter.academicYearId)) found.push(c);
    }
    classrooms = found;
  }
  const out: MyClassroomView[] = [];
  for (const c of classrooms) {
    const periods = await deps.ports.classrooms.listPeriods(ctx, c.academicYearId);
    const roster = await deps.ports.classrooms.listRoster(ctx, c.id);
    const states: MyClassroomView["periods"] = [];
    const readyOfClass = await inTx(deps, ctx, async (tx) => ok(new Set(await readyPeriodIdsOfClass(tx, c.id))), { readOnly: true });
    if (!readyOfClass.ok) return readyOfClass;
    for (const p of periods) {
      const s = await deps.ports.periods.getState(ctx, { classroomId: c.id, periodId: p.id });
      states.push({ id: p.id, label: p.label, locked: s.locked, ready: readyOfClass.value.has(p.id) });
    }
    out.push({
      classroomId: c.id,
      name: c.name,
      gradeLevelCode: c.gradeLevelCode,
      academicYearId: c.academicYearId,
      studentCount: roster.length,
      periods: states,
      isHomeroom: staffId ? await deps.ports.teaching.isHomeroom(ctx, staffId, c.id) : false,
    });
  }
  return ok(out);
}

/**
 * Compteurs de compétences par inscription (entrée de `decision_fin_annee`, contrat `competency-period@1`) : lecture seule,
 * destinée au port `CompetencyCountersPort` de `results` (adaptateur de plateforme). On COMPTE, on ne note jamais :
 *  - `expected` : compétences du référentiel PUBLIÉ applicable au niveau de la classe (le premier, comme la grille) ;
 *  - `evaluated` : compétences distinctes de ce référentiel ayant au moins une ligne VALIDÉE pour l'inscription dans la classe
 *    (toutes périodes de l'année confondues). Sans référentiel publié : `{ evaluated: 0, expected: 0 }`.
 * Aucun contrôle de droit : le consommateur (`results`) est appelé après les siens.
 */
export async function getCompetencyCounters(
  deps: PrimarySchoolDeps,
  ctx: RequestContext,
  input: { classroomId: Uuid; enrollmentIds: readonly Uuid[] },
): Promise<Result<ReadonlyMap<string, { evaluated: number; expected: number }>, AppError>> {
  const classroom = await deps.ports.classrooms.getClassroom(ctx, input.classroomId);
  if (!classroom) return err(notFound(PrimaryCode.CLASSROOM_NOT_FOUND, "Classe", input.classroomId));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const out = new Map<string, { evaluated: number; expected: number }>(input.enrollmentIds.map((id) => [id, { evaluated: 0, expected: 0 }]));
      const published = (await listFrameworkRows(tx, { status: "PUBLISHED" })).filter((f) => appliesTo(f, classroom.gradeLevelCode));
      const chosen = published[0];
      if (!chosen || input.enrollmentIds.length === 0) return ok(out);
      const detail = await frameworkDetailOf(tx, chosen);
      const expected = detail.domains.reduce((n, d) => n + d.competencies.length, 0);
      const rows = await tx.many<{ enrollment_id: string; n: string }>(
        `SELECT a.enrollment_id, count(DISTINCT a.competency_id)::text AS n
           FROM primary_school.competency_assessments a
          WHERE a.classroom_id = $1 AND a.framework_id = $2 AND a.status = 'VALIDATED' AND a.enrollment_id = ANY($3::uuid[])
          GROUP BY a.enrollment_id`,
        [input.classroomId, chosen.id, [...input.enrollmentIds]],
      );
      const evaluated = new Map(rows.map((r) => [r.enrollment_id, Number(r.n)]));
      for (const id of input.enrollmentIds) out.set(id, { evaluated: evaluated.get(id) ?? 0, expected });
      return ok(out);
    },
    { readOnly: true },
  );
}

/**
 * Bloc « Compétences » du bulletin (L-42) : par domaine du référentiel publié de la classe, les compétences évaluées (lignes
 * VALIDÉES de la période), les attendues et le nombre d'élèves-niveau par niveau de l'échelle. Que des COMPTAGES, jamais de moyenne.
 * `null` : aucun référentiel publié pour ce niveau de classe (bulletin numérique ou école sans pack).
 */
export interface ReportcardCompetencies {
  readonly scaleLabel: string | null;
  readonly domains: ReadonlyArray<{ code: string; label: string; evaluated: number; expected: number; levels: ReadonlyArray<{ code: string; label: string; count: number }> }>;
}

export async function getReportcardCompetencies(
  deps: PrimarySchoolDeps,
  ctx: RequestContext,
  input: { classroomId: Uuid; enrollmentId: Uuid; periodId: Uuid },
): Promise<Result<ReportcardCompetencies | null, AppError>> {
  const classroom = await deps.ports.classrooms.getClassroom(ctx, input.classroomId);
  if (!classroom) return err(notFound(PrimaryCode.CLASSROOM_NOT_FOUND, "Classe", input.classroomId));
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const chosen = (await listFrameworkRows(tx, { status: "PUBLISHED" })).filter((f) => appliesTo(f, classroom.gradeLevelCode))[0];
      if (!chosen) return ok<ReportcardCompetencies | null>(null);
      const detail = await frameworkDetailOf(tx, chosen);
      const counts = summarizeCompetencies(await summaryRowsOf(tx, input.enrollmentId, [input.periodId]));
      const evaluatedRows = await tx.many<{ domain_code: string; n: string }>(
        `SELECT d.code AS domain_code, count(DISTINCT a.competency_id)::text AS n
           FROM primary_school.competency_assessments a
           JOIN primary_school.competencies c ON c.tenant_id = a.tenant_id AND c.id = a.competency_id
           JOIN primary_school.competency_domains d ON d.tenant_id = c.tenant_id AND d.id = c.domain_id
          WHERE a.enrollment_id = $1 AND a.academic_period_id = $2 AND a.framework_id = $3 AND a.status = 'VALIDATED'
          GROUP BY d.code`,
        [input.enrollmentId, input.periodId, chosen.id],
      );
      const evaluated = new Map(evaluatedRows.map((r) => [r.domain_code, Number(r.n)]));
      return ok<ReportcardCompetencies | null>({
        scaleLabel: detail.scale.label,
        domains: detail.domains.map((d) => ({
          code: d.code,
          label: d.label,
          evaluated: evaluated.get(d.code) ?? 0,
          expected: d.competencies.length,
          levels: [...detail.scale.levels].sort((a, b) => a.ordinal - b.ordinal).map((l) => ({ code: l.code, label: l.label, count: counts[d.code]?.[l.code] ?? 0 })),
        })),
      });
    },
    { readOnly: true },
  );
}

export { summarizeCompetencies, actorOf };
