/**
 * EXAMENS BLANCS : épreuves liées à des évaluations d'`assess` (type « examen blanc »), notes PUBLIÉES importées, moyenne et issue
 * CALCULÉES PAR LA RÈGLE `exam-national@1` de la version épinglée à la session — jamais en dur.
 *
 *  - Un lien n'existe que pour une session blanche ; une évaluation n'alimente qu'une épreuve ; barèmes identiques ; liens figés
 *    une fois les résultats saisis (base).
 *  - Le calcul est TRACÉ : chaque résultat porte la version de règle et l'empreinte (reproductible) des entrées de chaque appel.
 *  - Un candidat sans note donne `absent = true`, `note = null` (jamais 0) : la règle décide.
 *  - Un résultat d'examen blanc ne sert JAMAIS de document officiel (R-EXA-11).
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { ExamLinkDto } from "@ecoledigitale/contracts/src/v2/examinations";
import { compareDecimal } from "../domain/decimal";
import { ExamCode, conflict, notFound, validation } from "../domain/errors";
import { buildMockInputs, combineInputHashes, mapAssessEntry, MOCK_ASSESSMENT_TYPE_CODE, type MockScoreInput } from "../domain/mock";
import { ACCEPTS_SCORES } from "../domain/lifecycle";
import { RESULT_CODES, type CandidateRow, type ResultCode, type SessionPaperRow, type SessionRow } from "../domain/types";
import * as cand from "../infrastructure/candidates-repo";
import * as res from "../infrastructure/results-repo";
import * as sess from "../infrastructure/sessions-repo";
import { attempt, EventBuffer, inTx, type ExaminationsDeps } from "./deps";
import type { RuleCall, RuleCallResult, RuleSession } from "./ports";

async function loadMock(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<SessionRow, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const s = await sess.getSession(tx, sessionId);
    if (!s) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
    if (s.sessionKind !== "MOCK") return err(conflict(ExamCode.MOCK_ONLY, "Cette opération ne concerne que les examens blancs."));
    return ok(s);
  }, { readOnly: true });
}

export async function listLinks(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<ExamLinkDto[], AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      if (!(await sess.getSession(tx, sessionId))) return err(notFound(ExamCode.SESSION_NOT_FOUND, "Session d'examen", sessionId));
      const papers = new Map((await sess.listSessionPapers(tx, sessionId)).map((p) => [p.id, p]));
      return ok((await sess.listLinks(tx, sessionId)).map((l) => ({ id: l.id, paperId: l.paperId, paperCode: papers.get(l.paperId)?.code ?? "?", classroomId: l.classroomId, assessmentId: l.assessmentId, linkedAt: l.linkedAt.toISOString() })));
    },
    { readOnly: true },
  );
}

export async function linkAssessment(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, body: { paperId: string; classroomId: string; assessmentId: string }): Promise<Result<ExamLinkDto, AppError>> {
  const session = await loadMock(deps, ctx, sessionId);
  if (!session.ok) return session;
  const assessment = await deps.ports.assess.getAssessment(ctx, body.assessmentId);
  if (!assessment) return err(validation(ExamCode.ASSESSMENT_UNKNOWN, "L'évaluation désignée est introuvable.", "assessmentId"));
  if (assessment.classroomId !== body.classroomId) return err(validation(ExamCode.ASSESSMENT_CLASSROOM_MISMATCH, "Cette évaluation n'est pas celle de la classe désignée.", "assessmentId"));
  if (assessment.typeCode !== MOCK_ASSESSMENT_TYPE_CODE) return err(validation(ExamCode.ASSESSMENT_NOT_MOCK, "Seule une évaluation de type « examen blanc » (non visible des élèves) se lie à une épreuve d'examen blanc.", "assessmentId"));
  return inTx(deps, ctx, async (tx) => {
    const paper = await sess.getSessionPaper(tx, sessionId, body.paperId);
    if (!paper) return err(notFound(ExamCode.PAPER_NOT_FOUND, "Épreuve de la session", body.paperId));
    if (compareDecimal(assessment.scaleMax, paper.scaleMax) !== 0) {
      return err(validation(ExamCode.ASSESSMENT_SCALE_MISMATCH, `Le barème de l'évaluation (${assessment.scaleMax}) diffère de celui de l'épreuve (${paper.scaleMax}) : aucune conversion silencieuse.`, "assessmentId"));
    }
    const link = await sess.insertLink(tx, ctx.tenantId, { id: deps.newId(), sessionId, paperId: body.paperId, classroomId: body.classroomId, assessmentId: body.assessmentId, linkedBy: ctx.userId });
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.mock.link", resourceType: "session", resourceId: sessionId, metadata: { paperId: body.paperId, assessmentId: body.assessmentId, classroomId: body.classroomId } });
    await events.flush(tx);
    return ok({ id: link.id, paperId: link.paperId, paperCode: paper.code, classroomId: link.classroomId, assessmentId: link.assessmentId, linkedAt: link.linkedAt.toISOString() });
  });
}

export async function unlinkAssessment(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string, linkId: string): Promise<Result<{ removed: true }, AppError>> {
  return inTx(deps, ctx, async (tx) => {
    const link = await sess.getLink(tx, sessionId, linkId);
    if (!link) return err(notFound(ExamCode.NOT_FOUND, "Lien", linkId));
    await sess.deleteLink(tx, sessionId, linkId);
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.mock.unlink", resourceType: "session", resourceId: sessionId, metadata: { paperId: link.paperId, assessmentId: link.assessmentId } });
    await events.flush(tx);
    return ok({ removed: true as const });
  });
}

export interface ImportFromAssessReport {
  saved: number;
  unchanged: number;
  noCandidate: number;
  skipped: number;
  failed: Array<{ candidateId: string; paperId: string; code: string; message: string }>;
}

/** Importe les notes PUBLIÉES des évaluations liées (jamais un brouillon) comme notes d'épreuves (`source = ASSESS`). */
export async function importFromAssess(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<ImportFromAssessReport, AppError>> {
  const session = await loadMock(deps, ctx, sessionId);
  if (!session.ok) return session;
  if (!ACCEPTS_SCORES.includes(session.value.status)) return err(conflict(ExamCode.SCORES_CLOSED, `La saisie des notes n'est ouverte que session en cours ou résultats saisis (session ${session.value.status}).`));
  const setup = await inTx(deps, ctx, async (tx) => {
    const links = await sess.listLinks(tx, sessionId);
    const papers = new Map((await sess.listSessionPapers(tx, sessionId)).map((p) => [p.id, p]));
    const candidates = await cand.listRegistered(tx, sessionId);
    return ok({ links, papers, candidates });
  }, { readOnly: true });
  if (!setup.ok) return setup;
  const { links, papers, candidates } = setup.value;
  if (links.length === 0) return err(conflict(ExamCode.NO_LINKS, "Aucune épreuve n'est liée à une évaluation : lier d'abord les épreuves."));
  // Lectures des modules voisins AVANT la transaction d'écriture, une à une (connexion partagée : jamais en parallèle).
  const fetched: Array<{ link: (typeof links)[number]; grades: Awaited<ReturnType<ExaminationsDeps["ports"]["assess"]["listPublishedGrades"]>> }> = [];
  for (const link of links) fetched.push({ link, grades: await deps.ports.assess.listPublishedGrades(ctx, { classroomId: link.classroomId, assessmentId: link.assessmentId }) });
  const byStudent = new Map(candidates.map((c) => [c.studentId, c]));
  return inTx(deps, ctx, async (tx) => {
    const report: ImportFromAssessReport = { saved: 0, unchanged: 0, noCandidate: 0, skipped: 0, failed: [] };
    for (const { link, grades } of fetched) {
      const paper = papers.get(link.paperId) as SessionPaperRow;
      for (const g of grades) {
        const c = byStudent.get(g.studentId);
        if (!c) {
          report.noCandidate += 1;
          continue;
        }
        const mapped = mapAssessEntry(g.entryStatus, g.score);
        if (!mapped) {
          report.skipped += 1;
          continue;
        }
        const r = await attempt(tx, async (inner) => {
          const existing = await res.getScoreOf(inner, c.id, paper.id);
          if (existing) {
            if (existing.status === mapped.status && (existing.score === null ? mapped.score === null : mapped.score !== null && compareDecimal(existing.score, mapped.score) === 0)) return ok("unchanged" as const);
            await res.updateScore(inner, existing.id, { status: mapped.status, score: mapped.score, source: "ASSESS", sourceRef: link.assessmentId, enteredBy: ctx.userId });
            return ok("saved" as const);
          }
          await res.insertScore(inner, ctx.tenantId, { id: deps.newId(), sessionId, candidateId: c.id, paperId: paper.id, status: mapped.status, score: mapped.score, source: "ASSESS", sourceRef: link.assessmentId, enteredBy: ctx.userId });
          return ok("saved" as const);
        });
        if (!r.ok) report.failed.push({ candidateId: c.id, paperId: paper.id, code: r.error.code, message: r.error.message });
        else if (r.value === "saved") report.saved += 1;
        else report.unchanged += 1;
      }
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({ action: "examinations.mock.import", resourceType: "session", resourceId: sessionId, metadata: { links: links.length, saved: report.saved, unchanged: report.unchanged, failed: report.failed.length } });
    await events.flush(tx);
    return ok(report);
  });
}

export interface ComputeMockReport {
  computed: number;
  skippedPublished: number;
  failed: Array<{ candidateId: string; code: string; message: string }>;
  ruleVersionId: string;
  ruleSetCode: string;
  demoRules: boolean;
}

const asString = (r: RuleCallResult | undefined): string | null => (r && r.ok && typeof r.value === "string" ? r.value : null);

/**
 * Calcule moyenne, issue, mention (si la règle la fournit) et rang de chaque candidat inscrit PAR LA RÈGLE épinglée, et enregistre
 * des résultats `COMPUTED` (brouillons) tracés par version de règle et empreinte d'entrées. Rejouable tant que rien n'est publié.
 */
export async function computeMock(deps: ExaminationsDeps, ctx: RequestContext, sessionId: string): Promise<Result<ComputeMockReport, AppError>> {
  const session = await loadMock(deps, ctx, sessionId);
  if (!session.ok) return session;
  const s = session.value;
  if (!ACCEPTS_SCORES.includes(s.status)) return err(conflict(ExamCode.RESULTS_CLOSED, `Le calcul exige une session en cours ou à résultats saisis (session ${s.status}).`));
  if (!s.ruleVersionRef) return err(conflict(ExamCode.NO_RULE_VERSION, "Aucune version de la règle de calcul n'est épinglée à cette session : le calcul d'un examen blanc est impossible.", { contract: "exam-national@1" }));
  const rule = await deps.ports.rules.open(ctx, s.ruleVersionRef);
  if (!rule.ok) return rule;
  const loaded = await inTx(deps, ctx, async (tx) => {
    const candidates = await cand.listRegistered(tx, sessionId);
    const papers = await sess.listSessionPapers(tx, sessionId);
    const scores = await res.listScores(tx, sessionId);
    return ok({ candidates, papers, scores });
  }, { readOnly: true });
  if (!loaded.ok) return loaded;
  const { candidates, papers, scores } = loaded.value;
  if (candidates.length > deps.config.rankCohortMax) return err(validation(ExamCode.INVALID_INPUT, `La cohorte dépasse ${deps.config.rankCohortMax} candidats : limite de la règle de rang.`, "sessionId"));

  const scoresOf = new Map<string, MockScoreInput[]>();
  for (const sc of scores) scoresOf.set(sc.candidateId, [...(scoresOf.get(sc.candidateId) ?? []), { paperId: sc.paperId, status: sc.status, score: sc.score }]);
  const inputs = candidates.map((c) => ({ c, in: buildMockInputs(papers, scoresOf.get(c.id) ?? [], c.trackCode) }));

  const session1 = rule.value;
  // Passe 1 : moyennes ; passe 2 : issues ; passe 3 : mentions (facultatives) ; passe 4 : rangs sur la cohorte.
  const avgCalls: RuleCall[] = inputs.map((i) => ({ ruleKey: "moyenne_candidat", variables: { epreuves: i.in.epreuves } }));
  const avg = session1.evaluate(avgCalls);
  const outcomeCalls: RuleCall[] = inputs.map((i, k) => ({ ruleKey: "resultat_candidat", variables: { moyenne: asString(avg[k]), epreuves_absentes: String(i.in.absentCount), epreuves_eliminatoires_echouees: "0" } }));
  const outcome = session1.evaluate(outcomeCalls);
  const mentionCalls: RuleCall[] = inputs.map((_, k) => ({ ruleKey: "mention_examen", variables: { moyenne: asString(avg[k]) } }));
  const mention = session1.evaluate(mentionCalls);
  const cohort = avg.map((a) => asString(a));
  const rankCalls: RuleCall[] = inputs.map((_, k) => ({ ruleKey: "rang_candidat", variables: { moyenne: cohort[k] ?? null, cohorte: cohort } }));
  const rank = session1.evaluate(rankCalls);

  const report: ComputeMockReport = { computed: 0, skippedPublished: 0, failed: [], ruleVersionId: session1.pin.ruleVersionId, ruleSetCode: session1.pin.ruleSetCode, demoRules: session1.pin.sourceKind === "placeholder" || s.sourceKind === "placeholder" };
  type Planned = { c: CandidateRow; code: ResultCode; average: string | null; mention: string | null; rank: number | null; hash: string };
  const planned: Planned[] = [];
  inputs.forEach((i, k) => {
    const a = avg[k];
    const o = outcome[k];
    if (!a || !a.ok) {
      report.failed.push({ candidateId: i.c.id, code: ExamCode.RULE_EVALUATION_FAILED, message: `Moyenne : ${a && !a.ok ? a.message : "aucun résultat"}` });
      return;
    }
    const code = asString(o);
    if (!o || !o.ok || !code || !(RESULT_CODES as readonly string[]).includes(code)) {
      report.failed.push({ candidateId: i.c.id, code: ExamCode.RULE_EVALUATION_FAILED, message: `Issue : ${o && !o.ok ? o.message : "valeur hors du contrat"}` });
      return;
    }
    const average = asString(a);
    const noAverage = code === "ABSENT" || code === "EXCLUDED" || code === "DEFERRED";
    const m = mention[k];
    const mentionCode = !noAverage && m && m.ok && typeof m.value === "string" && /^[A-Z][A-Z0-9_]{1,39}$/.test(m.value) ? m.value : null;
    const rk = rank[k];
    const rankValue = !noAverage && rk && rk.ok && typeof rk.value === "string" && /^\d+$/.test(rk.value) ? Number(rk.value) : null;
    const hashes = [a.inputsHash, o.inputsHash, m && m.ok ? m.inputsHash : "", rk && rk.ok ? rk.inputsHash : ""];
    planned.push({ c: i.c, code: code as ResultCode, average: noAverage ? null : average, mention: mentionCode, rank: rankValue, hash: combineInputHashes(hashes) });
  });

  const written = await inTx(deps, ctx, async (tx) => {
    for (const p of planned) {
      const r = await attempt(tx, async (inner) => {
        const existing = await res.getResultOfCandidate(inner, p.c.id);
        const write = { resultCode: p.code, average: p.average, totalPoints: null, rank: p.rank, mentionCode: p.mention, source: "COMPUTED" as const, ruleVersionRef: session1.pin.ruleVersionId, inputsHash: p.hash, importBatchId: null, enteredBy: null };
        if (!existing) {
          await res.insertResult(inner, ctx.tenantId, { id: deps.newId(), sessionId, candidateId: p.c.id, ...write });
          return ok("computed" as const);
        }
        if (existing.status === "PUBLISHED") return ok("published" as const);
        await res.replaceDraftResult(inner, existing.id, write);
        return ok("computed" as const);
      });
      if (!r.ok) report.failed.push({ candidateId: p.c.id, code: r.error.code, message: r.error.message });
      else if (r.value === "computed") report.computed += 1;
      else report.skippedPublished += 1;
    }
    const events = new EventBuffer(deps, ctx);
    events.audit({
      action: "examinations.mock.compute",
      resourceType: "session",
      resourceId: sessionId,
      metadata: { candidates: candidates.length, computed: report.computed, skippedPublished: report.skippedPublished, failed: report.failed.length, ruleVersionId: report.ruleVersionId, ruleSetCode: report.ruleSetCode, engineVersion: session1.engineVersion },
    });
    await events.flush(tx);
    return ok(true);
  });
  if (!written.ok) return written;
  return ok(report);
}
