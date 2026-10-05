/**
 * ÉLIGIBILITÉ d'un candidat : évaluée par la RÈGLE `eligibilite` du contrat `exam-national@1` (jamais en dur), journalisée
 * (version de règle, résultat, motifs, empreinte des entrées, auteur), dérogation motivée possible.
 *
 *  - `EVALUATE` : faits (classe d'examen, âge, tentatives, pièces) -> règle de la version ÉPINGLÉE à la session -> journal.
 *    Les faits d'un autre module sont lus en ÉCHEC FERMÉ : sans eux, aucune évaluation (jamais « éligible » par défaut).
 *  - `MANUAL`  : repli quand AUCUNE règle n'est épinglée à la session : saisie du résultat avec son auteur. Refusé dès qu'une
 *    règle est épinglée (la règle prime).
 *  - `OVERRIDE`: dérogation motivée (≥ 10 caractères), sensible, auditée ; vaut « éligible ».
 * Le statut d'éligibilité du candidat est DÉRIVÉ du journal par la base : personne ne le pose à la main.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import type { ExamCandidateDto, ExamEligibilityBody, ExamEligibilityCheckDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { ageYearsAt } from "../domain/age";
import { combineInputHashes } from "../domain/mock";
import { ExaminationsEvents } from "../domain/events";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import type { CandidateRow, EligibilityResult, ExamTypeRow, SessionRow } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as ref from "../infrastructure/reference-repo";
import * as sess from "../infrastructure/sessions-repo";
import { toCandidateDto, toCheckDto } from "./dto";
import { attempt, EventBuffer, inTx, type ExaminationsDeps } from "./deps";
import type { EligibilityFacts, RuleSession } from "./ports";

const ELIGIBILITY_RESULTS: readonly string[] = ["ELIGIBLE", "INELIGIBLE", "NEEDS_REVIEW"];
const NO_REASON = "NONE";

interface Prepared {
  candidate: CandidateRow;
  facts: EligibilityFacts;
  piecesComplete: boolean;
  priorAttempts: number;
}

interface Context {
  session: SessionRow;
  type: ExamTypeRow;
}

async function loadContext(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<Context, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const session = await sess.getSession(tx, sessionId);
    if (!session) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    const type = await ref.getType(tx, session.examTypeId);
    if (!type) return err(notFound(ExamCode.TYPE_NOT_FOUND, "Type d'examen", session.examTypeId));
    return ok({ session, type });
  }, { readOnly: true });
}

async function openRule(deps: ExaminationsDeps, ctx: RequestContext, session: SessionRow): Promise<Result<RuleSession, AppError>> {
  if (!session.ruleVersionRef) {
    return err(conflict(ExamCode.NO_RULE_VERSION, "Aucune version de la règle d'éligibilité n'est épinglée à cette session : évaluation automatique impossible (saisie manuelle de l'éligibilité avec auteur, ou nouvelle session une fois la règle liée).", { contract: "exam-national@1" }));
  }
  return deps.ports.rules.open(ctx, session.ruleVersionRef);
}

/**
 * Lit les faits d'un candidat (hors transaction d'écriture) : annuaire académique en échec fermé, pièces et tentatives en base.
 * Un candidat LIBRE n'a pas de dossier scolaire : ses faits sont ceux de sa SAISIE (classe d'examen déclarée, tentatives déclarées) ;
 * l'âge est calculé de sa date de naissance et de la date de la session. La règle est la même.
 */
async function prepare(deps: ExaminationsDeps, ctx: RequestContext, c: CandidateRow, context: Context, extra: { piecesComplete: boolean; priorAttempts: number; declared?: { inExamGrade: boolean } | undefined }): Promise<Result<Prepared, AppError>> {
  if (c.candidateKind === "EXTERNAL") {
    if (!extra.declared) return err(validation(ExamCode.EXTERNAL_PROFILE_INCOMPLETE, "Le profil du candidat libre est introuvable : ses faits d'éligibilité ne sont pas saisis.", "profile"));
    return ok({ candidate: c, facts: { inExamGrade: extra.declared.inExamGrade, ageYears: ageYearsAt(c.birthDate, context.session.startsOn) }, piecesComplete: extra.piecesComplete, priorAttempts: extra.priorAttempts });
  }
  if (!c.enrollmentId) return err(validation(ExamCode.ENROLLMENT_MISMATCH, "Ce candidat n'a pas d'inscription : ses faits d'éligibilité sont introuvables.", "enrollmentId"));
  const facts = await deps.ports.eligibility.getEligibilityFacts(ctx, { enrollmentId: c.enrollmentId, studentId: c.studentId as string, examGradeLevelCode: context.type.gradeLevelCode, referenceDate: context.session.startsOn });
  if (!facts.ok) return facts;
  return ok({ candidate: c, facts: facts.value, piecesComplete: extra.piecesComplete, priorAttempts: extra.priorAttempts });
}

/** Variables de la règle : nombres en chaînes décimales, âge absent = null (jamais 0), aucune identité. */
function ruleVariables(p: Prepared, context: Context): Record<string, unknown> {
  return {
    en_classe_examen: p.facts.inExamGrade,
    age_annees: p.facts.ageYears === null ? null : String(p.facts.ageYears),
    annee_session: String(context.session.sessionYear),
    pieces_completes: p.piecesComplete,
    nombre_tentatives: String(p.priorAttempts),
  };
}

interface Evaluated {
  result: EligibilityResult;
  reasons: string[];
  inputsHash: string;
}

function evaluateWithRule(session: RuleSession, variables: Record<string, unknown>): Result<Evaluated, AppError> {
  const [verdict, motive] = session.evaluate([
    { ruleKey: "eligibilite", variables },
    { ruleKey: "motif_eligibilite", variables },
  ]);
  if (!verdict || !verdict.ok) return err(conflict(ExamCode.RULE_EVALUATION_FAILED, `La règle d'éligibilité a échoué : ${verdict && !verdict.ok ? verdict.message : "aucun résultat"}.`));
  if (typeof verdict.value !== "string" || !ELIGIBILITY_RESULTS.includes(verdict.value)) return err(conflict(ExamCode.RULE_EVALUATION_FAILED, "La règle d'éligibilité a rendu une valeur hors du contrat."));
  const reasons: string[] = [];
  if (motive && motive.ok && typeof motive.value === "string" && motive.value !== NO_REASON) reasons.push(motive.value);
  const hashes = [verdict.inputsHash, motive && motive.ok ? motive.inputsHash : ""].filter(Boolean);
  return ok({ result: verdict.value as EligibilityResult, reasons, inputsHash: combineInputHashes(hashes) });
}

async function recordCheck(deps: ExaminationsDeps, ctx: RequestContext, tx: Tx, c: CandidateRow, session: SessionRow, entry: { ruleVersionRef: string | null; result: EligibilityResult; reasons: string[]; inputsHash: string | null; overriddenBy: string | null; overrideReason: string | null; mode: "RULE" | "MANUAL" | "OVERRIDE" }, events: EventBuffer): Promise<ExamEligibilityCheckDto> {
  const row = await cand.insertCheck(tx, ctx.tenantId, {
    id: deps.newId(), candidateId: c.id, ruleVersionRef: entry.ruleVersionRef, result: entry.result, reasons: entry.reasons, inputsHash: entry.inputsHash, evaluatedBy: ctx.userId, overriddenBy: entry.overriddenBy, overrideReason: entry.overrideReason,
  });
  events.add(ExaminationsEvents.ELIGIBILITY_EVALUATED, { v: 1, sessionId: session.id, candidateId: c.id, result: entry.mode === "OVERRIDE" ? "ELIGIBLE" : entry.result, reasonCodes: entry.reasons, mode: entry.mode }, { type: "examinations.candidate", id: c.id });
  events.audit({
    action: entry.mode === "OVERRIDE" ? "examinations.eligibility.override" : "examinations.eligibility.evaluate",
    resourceType: "candidate",
    resourceId: c.id,
    sensitive: entry.mode === "OVERRIDE",
    reason: entry.overrideReason,
    metadata: { sessionId: session.id, result: entry.result, mode: entry.mode, reasons: entry.reasons, ruleVersionRef: entry.ruleVersionRef },
  });
  return toCheckDto(row);
}

export async function evaluateEligibility(deps: ExaminationsDeps, ctx: RequestContext, candidateId: string, body: ExamEligibilityBody): Promise<Result<{ candidate: ExamCandidateDto; check: ExamEligibilityCheckDto }, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const actor = ctx.userId;
  const probe = await inTx(deps, ctx, async (tx) => {
    const c = await cand.getCandidate(tx, candidateId);
    if (!c) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    return ok({ c, missing: await cand.missingRequiredPieces(tx, candidateId) });
  }, { readOnly: true });
  if (!probe.ok) return probe;
  const { c, missing } = probe.value;
  if (c.registrationStatus === "WITHDRAWN") return err(conflict(ExamCode.CANDIDATE_WITHDRAWN, "Un candidat retiré ne change plus."));
  const context = await loadContext(deps, ctx, c.sessionId);
  if (!context.ok) return context;
  const { session } = context.value;

  let entry: Parameters<typeof recordCheck>[5];
  if (body.mode === "EVALUATE") {
    const rule = await openRule(deps, ctx, session);
    if (!rule.ok) return rule;
    const attempts = await inTx(deps, ctx, async (tx) => {
      if (c.candidateKind === "EXTERNAL") {
        const profile = await cand.getExternalProfile(tx, c.id);
        return ok({ prior: profile?.declaredPriorAttempts ?? 0, declared: profile ? { inExamGrade: profile.declaredInExamGrade } : undefined });
      }
      return ok({ prior: await cand.countPriorAttempts(tx, c.studentId as string, session.examTypeId, session.id), declared: undefined });
    }, { readOnly: true });
    if (!attempts.ok) return attempts;
    const prepared = await prepare(deps, ctx, c, context.value, { piecesComplete: missing.length === 0, priorAttempts: attempts.value.prior, declared: attempts.value.declared });
    if (!prepared.ok) return prepared;
    const evaluated = evaluateWithRule(rule.value, ruleVariables(prepared.value, context.value));
    if (!evaluated.ok) return evaluated;
    entry = { ruleVersionRef: rule.value.pin.ruleVersionId, ...evaluated.value, overriddenBy: null, overrideReason: null, mode: "RULE" };
  } else if (body.mode === "MANUAL") {
    if (session.ruleVersionRef) return err(conflict(ExamCode.MANUAL_ELIGIBILITY_REFUSED, "Une règle d'éligibilité est épinglée à cette session : l'éligibilité se calcule par la règle (ou se déroge avec un motif).", { ruleVersionRef: session.ruleVersionRef }));
    entry = { ruleVersionRef: null, result: body.result, reasons: body.reasons, inputsHash: null, overriddenBy: null, overrideReason: null, mode: "MANUAL" };
  } else {
    if (body.reason.trim().length < 10) return err(validation(ExamCode.INVALID_INPUT, "Le motif d'une dérogation compte au moins 10 caractères.", "reason"));
    if (c.eligibilityStatus === "NOT_EVALUATED") return err(validation(ExamCode.INVALID_INPUT, "Évaluer l'éligibilité avant d'accorder une dérogation.", "mode"));
    if (c.eligibilityStatus === "ELIGIBLE") return err(conflict(ExamCode.INVALID_INPUT, "Ce candidat est déjà éligible : aucune dérogation nécessaire."));
    entry = { ruleVersionRef: null, result: c.eligibilityStatus as EligibilityResult, reasons: [], inputsHash: null, overriddenBy: actor, overrideReason: body.reason.trim(), mode: "OVERRIDE" };
  }

  return inTx(deps, ctx, async (tx) => {
    const locked = await cand.getCandidate(tx, candidateId, { forUpdate: true });
    if (!locked) return err(notFound(ExamCode.CANDIDATE_NOT_FOUND, "Candidat", candidateId));
    const events = new EventBuffer(deps, ctx);
    const check = await recordCheck(deps, ctx, tx, locked, session, entry, events);
    await events.flush(tx);
    const fresh = (await cand.getCandidate(tx, candidateId)) as CandidateRow;
    return ok({ candidate: toCandidateDto(fresh, { missingPieces: await cand.missingRequiredPieces(tx, candidateId) }), check });
  });
}

export interface EvaluateAllReport {
  evaluated: number;
  byResult: Record<string, number>;
  failed: Array<{ candidateId: string; code: string; message: string }>;
}

/** Évalue par la règle tous les candidats non encore inscrits d'une session (une règle ouverte, un journal par candidat). */
export async function evaluateAll(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<EvaluateAllReport, AppError>> {
  if (!ctx.userId) return err(validation(ExamCode.FORBIDDEN, "Cette opération exige un utilisateur identifié.", "actor"));
  const context = await loadContext(deps, ctx, sessionId);
  if (!context.ok) return context;
  const rule = await openRule(deps, ctx, context.value.session);
  if (!rule.ok) return rule;
  const loaded = await inTx(deps, ctx, async (tx) => {
    const candidates = await cand.listEligibleToEvaluate(tx, sessionId);
    const missing = await cand.missingPiecesOf(tx, candidates.map((c) => c.id));
    const attempts = new Map<string, number>();
    const declared = new Map<string, { inExamGrade: boolean }>();
    for (const c of candidates) {
      if (c.candidateKind === "EXTERNAL") {
        const profile = await cand.getExternalProfile(tx, c.id);
        attempts.set(c.id, profile?.declaredPriorAttempts ?? 0);
        if (profile) declared.set(c.id, { inExamGrade: profile.declaredInExamGrade });
      } else attempts.set(c.id, await cand.countPriorAttempts(tx, c.studentId as string, context.value.session.examTypeId, sessionId));
    }
    return ok({ candidates, missing, attempts, declared });
  }, { readOnly: true });
  if (!loaded.ok) return loaded;
  const report: EvaluateAllReport = { evaluated: 0, byResult: {}, failed: [] };
  const done: Array<{ c: CandidateRow; evaluated: Evaluated }> = [];
  for (const c of loaded.value.candidates) {
    const prepared = await prepare(deps, ctx, c, context.value, { piecesComplete: (loaded.value.missing.get(c.id) ?? []).length === 0, priorAttempts: loaded.value.attempts.get(c.id) ?? 0, declared: loaded.value.declared.get(c.id) });
    if (!prepared.ok) {
      report.failed.push({ candidateId: c.id, code: prepared.error.code, message: prepared.error.message });
      continue;
    }
    const evaluated = evaluateWithRule(rule.value, ruleVariables(prepared.value, context.value));
    if (!evaluated.ok) report.failed.push({ candidateId: c.id, code: evaluated.error.code, message: evaluated.error.message });
    else done.push({ c, evaluated: evaluated.value });
  }
  const written = await inTx(deps, ctx, async (tx) => {
    const events = new EventBuffer(deps, ctx);
    for (const d of done) {
      const r = await attempt(tx, async (inner) => {
        await recordCheck(deps, ctx, inner, d.c, context.value.session, { ruleVersionRef: rule.value.pin.ruleVersionId, ...d.evaluated, overriddenBy: null, overrideReason: null, mode: "RULE" }, events);
        return ok(true);
      });
      if (r.ok) {
        report.evaluated += 1;
        report.byResult[d.evaluated.result] = (report.byResult[d.evaluated.result] ?? 0) + 1;
      } else report.failed.push({ candidateId: d.c.id, code: r.error.code, message: r.error.message });
    }
    events.audit({ action: "examinations.eligibility.evaluate_all", resourceType: "session", resourceId: sessionId, metadata: { evaluated: report.evaluated, failed: report.failed.length, byResult: report.byResult } });
    await events.flush(tx);
    return ok(true);
  });
  if (!written.ok) return written;
  return ok(report);
}
