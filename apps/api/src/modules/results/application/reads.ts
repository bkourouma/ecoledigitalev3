/**
 * Lectures : matrice de classe, résultat d'un élève, état de période, explicabilité, lecture famille, API publique pour
 * `reportcards` et `higher`.
 *
 *  - La famille ne lit que des résultats FINAL (jamais un brouillon), sans détail de surcharge ni trace ni commentaire
 *    interne (AC7.3) ; le lien tuteur ↔ élève est revérifié à CHAQUE lecture.
 *  - « Pourquoi ce résultat ? » : la trace est stockée pour un FINAL ; un DRAFT est expliqué par REJEU avec les données
 *    courantes (rien n'est persisté).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { ResultsCode, forbidden, notFound } from "../domain/errors";
import type { ClosureRecord, DecisionRecord, DeliberationRecord, LineRecord, PeriodState, RecomputeRequest, ResultHeader } from "../domain/records";
import type { Level, TraceRecord } from "../domain/types";
import { listDecisions, listDeliberations, listRequests } from "../infrastructure/governance-repository";
import { getHeaderById, listCurrentHeaders, listFinalHeaders, listHeadersOfEnrollment, listLines, listLinesOfHeaders } from "../infrastructure/results-repository";
import { getStateById, getStateByKey, listClosures } from "../infrastructure/states-repository";
import { prepare, runPipeline } from "./compute";
import { inTx, type ResultsCaps, type ResultsDeps } from "./deps";
import type { PendingAssessmentInfo } from "./ports";

const deny = (message: string): Result<never, AppError> => err(forbidden(ResultsCode.FORBIDDEN, message));

export interface PeriodView {
  state: PeriodState;
  closures: ClosureRecord[];
  deliberations: DeliberationRecord[];
  pendingAssessments: PendingAssessmentInfo[];
  recompute: RecomputeRequest[];
  counts: { total: number; draft: number; final: number; error: number };
}

export async function getPeriodView(deps: ResultsDeps, ctx: RequestContext, input: { classroomId: string; academicPeriodId: string; caps?: ResultsCaps | undefined }): Promise<Result<PeriodView, AppError>> {
  if (!input.caps?.read) return deny("Vous n'avez pas le droit de consulter les résultats.");
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const structure = await deps.ports.curriculum.getStructure(ctx, input);
      if (!structure) return err(notFound(ResultsCode.CURRICULUM_UNAVAILABLE, "Structure du curriculum", `${input.classroomId}/${input.academicPeriodId}`));
      const state = await getStateByKey(tx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, academicYearId: structure.academicYearId, scope: "PERIOD" });
      if (!state) return err(notFound(ResultsCode.STATE_NOT_FOUND, "État de la période", `${input.classroomId}/${input.academicPeriodId}`));
      const headers = await listCurrentHeaders(tx, state.id);
      return ok({
        state,
        closures: await listClosures(tx, state.id),
        deliberations: await listDeliberations(tx, state.id),
        pendingAssessments: [...(await deps.ports.assess.listPending(ctx, tx, input))],
        recompute: await listRequests(tx, { classroomId: input.classroomId, periodId: input.academicPeriodId }),
        counts: { total: headers.length, draft: headers.filter((h) => h.status === "DRAFT").length, final: headers.filter((h) => h.status === "FINAL").length, error: headers.filter((h) => h.status === "ERROR").length },
      });
    },
    { readOnly: true },
  );
}

export interface ClassMatrix {
  state: PeriodState;
  rows: Array<{ header: ResultHeader; lines: LineRecord[] }>;
  decisions: DecisionRecord[];
}

export async function getClassMatrix(deps: ResultsDeps, ctx: RequestContext, input: { classroomId: string; academicPeriodId: string; withLines?: boolean | undefined; caps?: ResultsCaps | undefined }): Promise<Result<ClassMatrix, AppError>> {
  if (!input.caps?.read) return deny("Vous n'avez pas le droit de consulter les résultats.");
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const structure = await deps.ports.curriculum.getStructure(ctx, input);
      if (!structure) return err(notFound(ResultsCode.CURRICULUM_UNAVAILABLE, "Structure du curriculum", `${input.classroomId}/${input.academicPeriodId}`));
      const state = await getStateByKey(tx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, academicYearId: structure.academicYearId, scope: "PERIOD" });
      if (!state) return err(notFound(ResultsCode.STATE_NOT_FOUND, "État de la période", `${input.classroomId}/${input.academicPeriodId}`));
      const headers = await listCurrentHeaders(tx, state.id);
      const lines = input.withLines ? await listLinesOfHeaders(tx, headers.map((h) => h.id)) : [];
      const byHeader = new Map<string, LineRecord[]>();
      for (const l of lines) byHeader.set(l.periodResultId, [...(byHeader.get(l.periodResultId) ?? []), l]);
      return ok({ state, rows: headers.map((header) => ({ header, lines: byHeader.get(header.id) ?? [] })), decisions: await listDecisions(tx, { stateId: state.id }) });
    },
    { readOnly: true },
  );
}

export interface EnrollmentResult {
  header: ResultHeader;
  lines: LineRecord[];
  decisions: DecisionRecord[];
}

async function currentOf(tx: Tx, enrollmentId: string, periodId: string): Promise<ResultHeader | null> {
  const all = (await listHeadersOfEnrollment(tx, enrollmentId)).filter((h) => h.academicPeriodId === periodId && h.status !== "SUPERSEDED");
  return all.find((h) => h.status === "FINAL") ?? all.sort((a, b) => b.version - a.version)[0] ?? null;
}

export async function getEnrollmentResult(deps: ResultsDeps, ctx: RequestContext, input: { enrollmentId: string; academicPeriodId: string; caps?: ResultsCaps | undefined }): Promise<Result<EnrollmentResult, AppError>> {
  if (!input.caps?.read) return deny("Vous n'avez pas le droit de consulter les résultats.");
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const header = await currentOf(tx, input.enrollmentId, input.academicPeriodId);
      if (!header) return err(notFound(ResultsCode.RESULT_NOT_FOUND, "Résultat", `${input.enrollmentId}/${input.academicPeriodId}`));
      return ok({ header, lines: await listLines(tx, header.id), decisions: await listDecisions(tx, { stateId: header.stateId, enrollmentId: input.enrollmentId }) });
    },
    { readOnly: true },
  );
}

export interface Explanation {
  header: ResultHeader;
  source: "STORED" | "REPLAY";
  lines: Array<{ level: Level; curriculumNodeId: string | null; value: string | null; statusCode: string | null; overridden: boolean; trace: readonly TraceRecord[] | unknown | null }>;
}

export async function explainResult(deps: ResultsDeps, ctx: RequestContext, input: { resultId: string; caps?: ResultsCaps | undefined }): Promise<Result<Explanation, AppError>> {
  if (!input.caps?.explain) return deny("Vous n'avez pas le droit de consulter la trace d'un résultat.");
  return inTx<Explanation>(
    deps,
    ctx,
    async (tx) => {
      const header = await getHeaderById(tx, input.resultId);
      if (!header) return err(notFound(ResultsCode.RESULT_NOT_FOUND, "Résultat", input.resultId));
      if (header.status === "FINAL" || header.status === "SUPERSEDED") {
        if (header.finalizedAt) {
          const lines = await listLines(tx, header.id);
          return ok({ header, source: "STORED" as const, lines: lines.map((l) => ({ level: l.level, curriculumNodeId: l.curriculumNodeId, value: l.value, statusCode: l.statusCode, overridden: l.overridden, trace: l.trace })) });
        }
      }
      // Brouillon : rejeu avec les données courantes et la version épinglée (rien n'est écrit).
      const prepared = await prepare(deps, ctx, tx, { classroomId: header.classroomId, academicPeriodId: header.academicPeriodId as string });
      if (!prepared.ok) return prepared;
      const replay = await runPipeline(deps, ctx, tx, prepared.value, { withTrace: true });
      if (!replay.ok) return replay;
      const comp = replay.value.enrollments.find((e) => e.enrollmentId === header.enrollmentId);
      if (!comp) return err(notFound(ResultsCode.RESULT_NOT_FOUND, "Résultat", input.resultId));
      return ok({ header, source: "REPLAY" as const, lines: comp.lines.map((l) => ({ level: l.level, curriculumNodeId: l.curriculumNodeId, value: l.value, statusCode: l.statusCode, overridden: l.overridden, trace: l.trace })) });
    },
    {},
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecture famille (élève, tuteur)
// ---------------------------------------------------------------------------------------------------------------------

export interface FamilyResult {
  academicPeriodId: string | null;
  scope: "PERIOD" | "YEAR";
  version: number;
  average: string | null;
  averageDisplay: string | null;
  rank: number | null;
  cohortSize: number | null;
  mentionCode: string | null;
  decisionCode: string | null;
  decisionOutcome: string | null;
  creditsAcquired: string | null;
  creditsRequired: string | null;
  validated: boolean | null;
  finalizedAt: Date | null;
  lines: Array<{ level: Level; curriculumNodeId: string | null; value: string | null; displayValue: string | null; credits: string | null; coefficient: string | null; validated: boolean | null; statusCode: string | null; rank: number | null }>;
}

async function familyResults(tx: Tx, studentId: string): Promise<FamilyResult[]> {
  // FINAL uniquement ; aucun détail de surcharge, aucune trace, aucune entrée de calcul.
  const rows = await tx.many(
    `SELECT r.id FROM results.period_results r WHERE r.student_id = $1 AND r.status = 'FINAL' ORDER BY r.finalized_at, r.id`,
    [studentId],
  );
  const out: FamilyResult[] = [];
  for (const row of rows) {
    const header = await getHeaderById(tx, row.id as string);
    if (!header) continue;
    const lines = await listLines(tx, header.id);
    out.push({
      academicPeriodId: header.academicPeriodId,
      scope: header.scope,
      version: header.version,
      average: header.average,
      averageDisplay: header.averageDisplay,
      rank: header.rank,
      cohortSize: header.cohortSize,
      mentionCode: header.mentionCode,
      decisionCode: header.decisionCode,
      decisionOutcome: header.decisionOutcome,
      creditsAcquired: header.creditsAcquired,
      creditsRequired: header.creditsRequired,
      validated: header.validated,
      finalizedAt: header.finalizedAt,
      lines: lines.map((l) => ({ level: l.level, curriculumNodeId: l.curriculumNodeId, value: l.value, displayValue: l.displayValue, credits: l.credits, coefficient: l.coefficient, validated: l.validated, statusCode: l.statusCode, rank: l.rank })),
    });
  }
  return out;
}

export async function listMyResults(deps: ResultsDeps, ctx: RequestContext): Promise<Result<FamilyResult[], AppError>> {
  if (!ctx.userId) return deny("Un utilisateur authentifié est requis.");
  const studentId = await deps.ports.guardianship.studentIdForUser(ctx, ctx.userId);
  if (!studentId) return err(forbidden(ResultsCode.NOT_VISIBLE, "Aucun profil d'élève n'est lié à votre compte."));
  return inTx(deps, ctx, async (tx) => ok(await familyResults(tx, studentId)), { readOnly: true });
}

export async function listChildResults(deps: ResultsDeps, ctx: RequestContext, input: { studentId: string }): Promise<Result<FamilyResult[], AppError>> {
  if (!ctx.userId) return deny("Un utilisateur authentifié est requis.");
  if (!(await deps.ports.guardianship.isGuardianOf(ctx, ctx.userId, input.studentId))) {
    return err(forbidden(ResultsCode.NOT_VISIBLE, "Vous n'êtes pas le tuteur de cet élève.", { studentId: input.studentId }));
  }
  return inTx(deps, ctx, async (tx) => ok(await familyResults(tx, input.studentId)), { readOnly: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// API publique inter-modules (reportcards, higher)
// ---------------------------------------------------------------------------------------------------------------------

/** Résultat FINAL courant d'une inscription pour une période, ou `null`. */
export async function getFinalResult(deps: ResultsDeps, ctx: RequestContext, input: { enrollmentId: string; academicPeriodId: string; tx?: Tx | undefined }): Promise<Result<(ResultHeader & { lines: LineRecord[] }) | null, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const h = (await listHeadersOfEnrollment(tx, input.enrollmentId)).find((x) => x.academicPeriodId === input.academicPeriodId && x.status === "FINAL");
      return ok(h ? { ...h, lines: await listLines(tx, h.id) } : null);
    },
    { readOnly: true, tx: input.tx },
  );
}

export async function listFinalLines(deps: ResultsDeps, ctx: RequestContext, input: { stateId: string; level?: Level | undefined; tx?: Tx | undefined }): Promise<Result<LineRecord[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const headers = await listFinalHeaders(tx, input.stateId);
      const lines = await listLinesOfHeaders(tx, headers.map((h) => h.id));
      return ok(input.level ? lines.filter((l) => l.level === input.level) : lines);
    },
    { readOnly: true, tx: input.tx },
  );
}

export interface ResitCandidate {
  enrollmentId: string;
  studentId: string;
  curriculumNodeId: string;
}

/** Candidats au rattrapage : ECUE éligibles (règle `eligible_rattrapage`) dans les résultats courants de la période. */
export async function listResitCandidates(deps: ResultsDeps, ctx: RequestContext, input: { classroomId: string; academicPeriodId: string; tx?: Tx | undefined }): Promise<Result<ResitCandidate[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const structure = await deps.ports.curriculum.getStructure(ctx, input);
      if (!structure) return ok([]);
      const state = await getStateByKey(tx, { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, academicYearId: structure.academicYearId, scope: "PERIOD" });
      if (!state) return ok([]);
      const headers = await listCurrentHeaders(tx, state.id);
      const lines = await listLinesOfHeaders(tx, headers.map((h) => h.id));
      const byId = new Map(headers.map((h) => [h.id, h]));
      return ok(
        lines
          .filter((l) => l.level === "ECUE" && l.resitEligible === true && l.curriculumNodeId)
          .map((l) => ({ enrollmentId: (byId.get(l.periodResultId) as ResultHeader).enrollmentId, studentId: (byId.get(l.periodResultId) as ResultHeader).studentId, curriculumNodeId: l.curriculumNodeId as string })),
      );
    },
    { readOnly: true, tx: input.tx },
  );
}

export async function getStateView(deps: ResultsDeps, ctx: RequestContext, input: { stateId: string; tx?: Tx | undefined }): Promise<Result<PeriodState, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const s = await getStateById(tx, input.stateId);
      return s ? ok(s) : err(notFound(ResultsCode.STATE_NOT_FOUND, "État de la période", input.stateId));
    },
    { readOnly: true, tx: input.tx },
  );
}
