/**
 * Cas d'usage des CANDIDATS : sélection depuis une classe, fiche, inscription (identité figée, numéro SANS TROU attribué par
 * la base), retrait motivé, identifiants officiels, historique.
 *
 *  - Un candidat est un ÉLÈVE de l'établissement de la session (pas de candidat libre en V1, Q-E15).
 *  - Le numéro de candidat est attribué par un compteur transactionnel de la base à l'inscription : une inscription annulée
 *    ne consomme aucun numéro, deux inscriptions concurrentes se sérialisent, un numéro n'est jamais réattribué.
 *  - L'éligibilité et l'issue ne se posent jamais à la main : elles sont dérivées (journal d'éligibilité, résultat).
 *  - Les ports d'autres modules (état civil, inscriptions) sont lus AVANT d'ouvrir la transaction d'écriture.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamCandidateDetailDto, ExamCandidateDto, ExamIdentifierDto, ExamPage } from "@ecoledigitale/contracts/src/v2/examinations";
import { ExaminationsEvents } from "../domain/events";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { ASSIGNMENT_OPEN } from "../domain/lifecycle";
import type { CandidateRow, SessionRow } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as ref from "../infrastructure/reference-repo";
import * as res from "../infrastructure/results-repo";
import * as sess from "../infrastructure/sessions-repo";
import * as out from "../infrastructure/outputs-repo";
import { toAssignmentDto, toCandidateDto, toCheckDto, toDocumentDto, toHistoryDto, toIdentifierDto, toPieceDto, toResultDto, toScoreDto } from "./dto";
import { attempt, EventBuffer, inTx, type ExaminationsDeps } from "./deps";
import type { EnrollmentFacts } from "./ports";

const OFFICIAL_NUMBER = "OFFICIAL_NUMBER";
const NAME_LOOKUP_CAP = 200;

async function loadSession(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<SessionRow, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const s = await sess.getSession(tx, sessionId);
    return s ? ok(s) : err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
  }, { readOnly: true });
}

// ------------------------------------------------------------------ lectures

export async function listCandidates(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  sessionId: string,
  filter: { registrationStatus?: string | undefined; eligibilityStatus?: string | undefined; outcome?: string | undefined; trackCode?: string | undefined; q?: string | undefined; page: number; pageSize: number },
): Promise<Result<ExamPage<ExamCandidateDto>, AppError>> {
  const pageSize = Math.min(filter.pageSize, deps.config.pageSizeMax);
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => {
      const s = await sess.getSession(tx, sessionId);
      if (!s) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
      const page = await cand.listCandidates(tx, { sessionId, ...filter, pageSize });
      const ids = page.items.map((c) => c.id);
      const identifiers = await cand.listIdentifiers(tx, ids);
      const missing = await cand.missingPiecesOf(tx, ids);
      return ok({ page, identifiers, missing });
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const { page, identifiers, missing } = loaded.value;
  const official = new Map(identifiers.filter((i) => i.kind === OFFICIAL_NUMBER).map((i) => [i.candidateId, i.value]));
  // État civil non encore figé (candidat DRAFT) : lu dans l'annuaire, jamais copié ni journalisé ; plafonné.
  const fallback = new Map<string, string>();
  let looked = 0;
  for (const c of page.items) {
    if (c.lastName || c.firstName || looked >= NAME_LOOKUP_CAP) continue;
    looked += 1;
    try {
      const id = await deps.ports.students.getIdentity(ctx, c.studentId);
      if (id) fallback.set(c.id, `${id.lastName.toLocaleUpperCase("fr-FR")} ${id.firstName}`);
    } catch {
      /* annuaire indisponible : pas de nom d'affichage, la liste reste utilisable par numéro d'élève */
    }
  }
  return ok({
    items: page.items.map((c) => toCandidateDto(c, { officialNumber: official.get(c.id) ?? null, missingPieces: missing.get(c.id) ?? [], fallbackName: fallback.get(c.id) ?? null })),
    total: page.total,
    page: filter.page,
    pageSize,
  });
}

export async function getCandidateDetail(deps: ExaminationsDeps, ctx: RequestContext, id: string): Promise<Result<ExamCandidateDetailDto, AppError>> {
  const loaded = await inTx(
    deps,
    ctx,
    async (tx) => {
      const c = await cand.getCandidate(tx, id);
      if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", id));
      const assignment = await sess.getAssignmentOfCandidate(tx, id);
      let assignmentView = null;
      if (assignment) {
        const views = await sess.listAssignmentViews(tx, c.sessionId);
        assignmentView = views.find((v) => v.candidateId === id) ?? null;
      }
      const result = await res.getResultOfCandidate(tx, id);
      return ok({
        c,
        checks: await cand.listChecks(tx, id),
        pieces: await cand.listPieces(tx, id),
        identifiers: await cand.listIdentifiers(tx, [id]),
        assignmentView,
        history: await cand.listHistory(tx, id),
        scores: await res.listScoresOfCandidate(tx, id),
        result,
        documents: await out.listDocumentsOfCandidate(tx, id),
        missing: await cand.missingRequiredPieces(tx, id),
      });
    },
    { readOnly: true },
  );
  if (!loaded.ok) return loaded;
  const v = loaded.value;
  let fallbackName: string | null = null;
  if (!v.c.lastName && !v.c.firstName) {
    try {
      const identity = await deps.ports.students.getIdentity(ctx, v.c.studentId);
      if (identity) fallbackName = `${identity.lastName.toLocaleUpperCase("fr-FR")} ${identity.firstName}`;
    } catch {
      /* sans annuaire : pas de nom d'affichage */
    }
  }
  const official = v.identifiers.find((i) => i.kind === OFFICIAL_NUMBER)?.value ?? null;
  const dto = toCandidateDto(v.c, { officialNumber: official, missingPieces: v.missing, fallbackName });
  return ok({
    candidate: dto,
    eligibilityChecks: v.checks.map(toCheckDto),
    pieces: v.pieces.map(toPieceDto),
    identifiers: v.identifiers.map(toIdentifierDto),
    assignment: v.assignmentView ? toAssignmentDto(v.assignmentView) : null,
    history: v.history.map(toHistoryDto),
    scores: v.scores.map(toScoreDto),
    result: v.result ? toResultDto(v.result, { candidateNumber: v.c.candidateNumber, lastName: v.c.lastName, firstName: v.c.firstName }) : null,
    documents: v.documents.map((d) => toDocumentDto(d, v.c.candidateNumber)),
  });
}

// ------------------------------------------------------------------ création

function checkEnrollment(enrollment: EnrollmentFacts | null, session: SessionRow, studentId: string): AppError | null {
  if (!enrollment) return validation(ExamCode.ENROLLMENT_MISMATCH, "L'inscription désignée est inconnue.", "enrollmentId");
  if (enrollment.studentId !== studentId) return validation(ExamCode.ENROLLMENT_MISMATCH, "Cette inscription n'est pas celle de l'élève désigné.", "enrollmentId");
  if (enrollment.institutionId !== session.institutionId) return validation(ExamCode.CANDIDATE_INSTITUTION, "Le candidat doit appartenir à l'établissement de la session (pas de candidat libre).", "enrollmentId");
  if (!enrollment.active) return validation(ExamCode.ENROLLMENT_MISMATCH, "L'inscription de l'élève n'est plus en cours.", "enrollmentId");
  return null;
}

export async function createCandidate(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  sessionId: string,
  body: { studentId: string; enrollmentId: string; trackCode?: string | null | undefined },
): Promise<Result<ExamCandidateDto, AppError>> {
  const session = await loadSession(deps, ctx, sessionId);
  if (!session.ok) return session;
  const enrollment = await deps.ports.students.getEnrollment(ctx, body.enrollmentId);
  const bad = checkEnrollment(enrollment, session.value, body.studentId);
  if (bad) return err(bad);
  const facts = enrollment as EnrollmentFacts;
  return inTx(deps, ctx, async (tx) => {
    if (body.trackCode) {
      const tracks = await sess.listSessionTracks(tx, sessionId);
      if (!tracks.some((t) => t.code === body.trackCode)) return err(validation(ExamCode.TRACK_UNKNOWN, `La série « ${body.trackCode} » n'appartient pas à cette session.`, "trackCode"));
    }
    const c = await cand.insertCandidate(tx, ctx.tenantId, {
      id: deps.newId(), sessionId, institutionId: session.value.institutionId, studentId: body.studentId, enrollmentId: body.enrollmentId, gradeLevelCode: facts.gradeLevelCode, trackCode: body.trackCode ?? null, createdBy: ctx.userId,
    });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.candidate.create", resourceType: "candidate", resourceId: c.id, metadata: { sessionId, studentId: c.studentId } });
    await events.flush(tx);
    return ok(toCandidateDto(c));
  });
}

export interface FromClassroomReport {
  created: number;
  skipped: Array<{ studentId: string; reason: "ALREADY_CANDIDATE" }>;
  failed: Array<{ studentId: string; code: string; message: string }>;
}

/** Crée un candidat pour chaque élève de la classe qui ne l'est pas déjà ; un échec n'arrête pas les autres. */
export async function createFromClassroom(
  deps: ExaminationsDeps,
  ctx: RequestContext,
  sessionId: string,
  body: { classroomId: string; trackCode?: string | null | undefined },
): Promise<Result<FromClassroomReport, AppError>> {
  const session = await loadSession(deps, ctx, sessionId);
  if (!session.ok) return session;
  const roster = await deps.ports.students.getClassroomRoster(ctx, body.classroomId);
  if (!roster) return err(notFound(ExamCode.NOT_FOUND, "Classe", body.classroomId));
  if (roster.institutionId !== session.value.institutionId) return err(validation(ExamCode.CANDIDATE_INSTITUTION, "La classe n'appartient pas à l'établissement de la session.", "classroomId"));
  return inTx(deps, ctx, async (tx) => {
    if (body.trackCode) {
      const tracks = await sess.listSessionTracks(tx, sessionId);
      if (!tracks.some((t) => t.code === body.trackCode)) return err(validation(ExamCode.TRACK_UNKNOWN, `La série « ${body.trackCode} » n'appartient pas à cette session.`, "trackCode"));
    }
    const report: FromClassroomReport = { created: 0, skipped: [], failed: [] };
    const events = new EventBuffer(deps, ctx);
    for (const item of roster.items) {
      const r = await attempt(tx, async (inner) => {
        const c = await cand.insertCandidate(inner, ctx.tenantId, {
          id: deps.newId(), sessionId, institutionId: session.value.institutionId, studentId: item.studentId, enrollmentId: item.enrollmentId, gradeLevelCode: roster.gradeLevelCode, trackCode: body.trackCode ?? null, createdBy: ctx.userId,
        });
        return ok(c);
      });
      if (r.ok) report.created += 1;
      else if (r.error.code === ExamCode.CANDIDATE_DUPLICATE) report.skipped.push({ studentId: item.studentId, reason: "ALREADY_CANDIDATE" });
      else report.failed.push({ studentId: item.studentId, code: r.error.code, message: r.error.message });
    }
    events.audit({ action: "examinations.candidate.create_from_classroom", resourceType: "session", resourceId: sessionId, metadata: { classroomId: body.classroomId, created: report.created, skipped: report.skipped.length, failed: report.failed.length } });
    await events.flush(tx);
    return ok(report);
  });
}

export async function updateCandidateTrack(deps: ExaminationsDeps, ctx: RequestContext, id: string, trackCode: string | null): Promise<Result<ExamCandidateDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, id, { forUpdate: true });
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", id));
    if (trackCode) {
      const tracks = await sess.listSessionTracks(tx, c.sessionId);
      if (!tracks.some((t) => t.code === trackCode)) return err(validation(ExamCode.TRACK_UNKNOWN, `La série « ${trackCode} » n'appartient pas à cette session.`, "trackCode"));
    }
    const updated = await cand.setCandidateTrack(tx, id, trackCode);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.candidate.update", resourceType: "candidate", resourceId: id, before: { trackCode: c.trackCode }, after: { trackCode } });
    await events.flush(tx);
    return ok(toCandidateDto(updated as CandidateRow));
  });
}

// ------------------------------------------------------------------ inscription et retrait

/** Inscrit le candidat : identité figée à cet instant, numéro attribué par la base. Les gardes (éligibilité, pièces) sont celles de la base. */
export async function registerCandidate(deps: ExaminationsDeps, ctx: RequestContext, id: string): Promise<Result<ExamCandidateDto, AppError>> {
  const probe = await inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, id);
    return c ? ok(c) : err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", id));
  }, { readOnly: true });
  if (!probe.ok) return probe;
  if (probe.value.registrationStatus === "REGISTERED") return ok(toCandidateDto(probe.value));
  const identity = await deps.ports.students.getIdentity(ctx, probe.value.studentId);
  if (!identity) return err(validation(ExamCode.IDENTITY_INCOMPLETE, "L'élève est introuvable dans le dossier des personnes.", "studentId"));
  const missing: string[] = [];
  if (!identity.lastName.trim()) missing.push("nom");
  if (!identity.firstName.trim()) missing.push("prénoms");
  if (!identity.birthDate) missing.push("date de naissance");
  if (!identity.sex) missing.push("sexe");
  if (missing.length > 0) return err(validation(ExamCode.IDENTITY_INCOMPLETE, `L'état civil de l'élève est incomplet (${missing.join(", ")}) : le compléter avant l'inscription à l'examen.`, "identity", { missing }));
  return inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, id, { forUpdate: true });
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", id));
    const registered = await cand.registerCandidate(tx, id, {
      lastName: identity.lastName.trim(), firstName: identity.firstName.trim(), birthDate: identity.birthDate as string, birthPlace: identity.birthPlace?.trim() || null, sex: identity.sex as "F" | "M",
    });
    const row = registered as CandidateRow;
    const s = (await sess.getSession(tx, row.sessionId)) as SessionRow;
    const events = new EventBuffer(deps, ctx);
    events.add(ExaminationsEvents.CANDIDATE_REGISTERED, { v: 1, sessionId: row.sessionId, candidateId: row.id, studentId: row.studentId, institutionId: s.institutionId, candidateNumber: row.candidateNumber ?? "" }, { type: "examinations.candidate", id: row.id });
    events.audit({ action: "examinations.candidate.register", resourceType: "candidate", resourceId: id, after: { candidateNumber: row.candidateNumber }, metadata: { sessionId: row.sessionId } });
    await events.flush(tx);
    return ok(toCandidateDto(row));
  });
}

export interface RegisterBatchReport {
  registered: Array<{ candidateId: string; candidateNumber: string | null }>;
  failed: Array<{ candidateId: string; code: string; message: string }>;
}

/** Inscription par lot : UNE transaction par candidat (un échec n'annule pas les autres ; chaque numéro est consommé à sa propre validation). */
export async function registerBatch(deps: ExaminationsDeps, ctx: RequestContext, candidateIds: readonly string[]): Promise<Result<RegisterBatchReport, AppError>> {
  const report: RegisterBatchReport = { registered: [], failed: [] };
  for (const id of candidateIds) {
    const r = await registerCandidate(deps, ctx, id);
    if (r.ok) report.registered.push({ candidateId: id, candidateNumber: r.value.candidateNumber });
    else report.failed.push({ candidateId: id, code: r.error.code, message: r.error.message });
  }
  return ok(report);
}

export async function withdrawCandidate(deps: ExaminationsDeps, ctx: RequestContext, id: string, reason: string, options: { reasonCode?: "MANUAL" | "ENROLLMENT_WITHDRAWN" } = {}): Promise<Result<ExamCandidateDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, id, { forUpdate: true });
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", id));
    const s = (await sess.getSession(tx, c.sessionId)) as SessionRow;
    const withdrawn = (await cand.withdrawCandidate(tx, id, reason.trim())) as CandidateRow;
    // La place est libérée tant que la répartition n'est pas figée ; le numéro, lui, est CONSERVÉ et jamais réattribué.
    if (ASSIGNMENT_OPEN.includes(s.status)) await sess.deleteAssignment(tx, id);
    const events = new EventBuffer(deps, ctx);
    events.add(ExaminationsEvents.CANDIDATE_WITHDRAWN, { v: 1, sessionId: c.sessionId, candidateId: id, studentId: c.studentId, reasonCode: options.reasonCode ?? "MANUAL" }, { type: "examinations.candidate", id });
    events.audit({ action: "examinations.candidate.withdraw", resourceType: "candidate", resourceId: id, reason: reason.trim(), metadata: { sessionId: c.sessionId, hadNumber: c.candidateNumber !== null } });
    await events.flush(tx);
    return ok(toCandidateDto(withdrawn));
  });
}

// ------------------------------------------------------------------ identifiants officiels

export async function setIdentifier(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string, body: { kind: string; value: string }, source: "MANUAL" | "IMPORT" | "MIGRATION" = "MANUAL"): Promise<Result<ExamIdentifierDto, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId);
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    if (c.registrationStatus === "WITHDRAWN") return err(conflict(ExamCode.CANDIDATE_WITHDRAWN, "Un candidat retiré ne change plus."));
    const row = await cand.upsertIdentifier(tx, ctx.tenantId, { id: deps.newId(), sessionId: c.sessionId, candidateId, kind: body.kind, value: body.value.trim(), source });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.candidate.identifier", resourceType: "candidate", resourceId: candidateId, metadata: { kind: body.kind, source } });
    await events.flush(tx);
    return ok(toIdentifierDto(row));
  });
}

export async function listTypeSummaries(deps: ExaminationsDeps, ctx: RequestContext): Promise<Result<Array<{ id: string; code: string }>, AppError>> {
  return inTx(deps, ctx, async (tx) => ok((await ref.listTypes(tx)).map((t) => ({ id: t.id, code: t.code }))), { readOnly: true });
}
