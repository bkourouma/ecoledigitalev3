/**
 * Calcul des résultats d'une période (classe × période) par le module `rules`.
 *
 *  - Les règles sont résolues UNE fois à la date de DÉBUT de la période, puis ÉPINGLÉES sur l'état de la période
 *    (jamais l'heure courante) : publier une nouvelle version ne recalcule rien (A-13).
 *  - Aucune règle active ⇒ `results.no_active_ruleset` : jamais de valeur par défaut (R-RES-08).
 *  - Un calcul DRAFT est IDEMPOTENT : une nouvelle version n'est créée que si `inputs_hash` ou la version de règle ont
 *    changé (AC8.2) ; un simple changement de rang met à jour la version courante en place.
 *  - Un échec de règle pour une inscription la marque `ERROR` avec diagnostic ; le reste de la classe est calculé (AC8.5).
 *  - La classe entière est toujours classée (phase de cohorte) : le rang d'un élève dépend des autres.
 */
import { err, ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { DECISION_RULES, outcomeOf } from "../domain/catalog";
import { ResultsCode, conflict, notFound, validation } from "../domain/errors";
import { ResultsEvents } from "../domain/events";
import { computeCoefSemester } from "../domain/pipeline/coef";
import { computeCoefPeriod } from "../domain/pipeline/coef-period";
import { computeCompetencyPeriod } from "../domain/pipeline/competency-period";
import { computeCreditSemester } from "../domain/pipeline/credit";
import { StructureError } from "../domain/pipeline/runner";
import type { PeriodState, ResultHeader } from "../domain/records";
import type { ClassComputation, ClassStructure, EnrollmentComputation, EnrollmentRef, ProposedDecision } from "../domain/types";
import { SUPPORTED_CONTRACTS } from "../domain/types";
import { guarded } from "../infrastructure/db-errors";
import { listApprovedOverrides, upsertProposal } from "../infrastructure/governance-repository";
import { deleteLines, insertHeader, insertLines, listCurrentHeaders, listDraftHeaders, markSuperseded, maxVersions, updateDraftSummary } from "../infrastructure/results-repository";
import { getStateByKey, insertState } from "../infrastructure/states-repository";
import { EventBuffer, inTx, lockKey, type ResultsDeps } from "./deps";
import type { RuleSession } from "./ports";

export interface ComputeReport {
  stateId: string;
  contractId: string;
  status: PeriodState["status"];
  computed: number;
  created: number;
  rankUpdated: number;
  unchanged: number;
  errors: number;
}

export interface Prepared {
  state: PeriodState;
  structure: ClassStructure;
  enrollments: EnrollmentRef[];
  session: RuleSession;
}

/** Trouve ou crée l'état de la période (épingle la version de règle active à la date de début de la période). */
export async function ensureState(deps: ResultsDeps, ctx: RequestContext, tx: Tx, structure: ClassStructure): Promise<Result<PeriodState, AppError>> {
  const existing = await getStateByKey(tx, { classroomId: structure.classroomId, academicPeriodId: structure.period.id, academicYearId: structure.academicYearId, scope: "PERIOD" }, "update");
  if (existing) return ok(existing);
  if (!(SUPPORTED_CONTRACTS as readonly string[]).includes(structure.contractId)) {
    return err(validation(ResultsCode.UNSUPPORTED_CONTRACT, `Le contrat de règles « ${structure.contractId} » n'est pas pris en charge par le calcul des résultats.`, "contractId"));
  }
  const resolved = await deps.ports.rules.resolve(ctx, { contractId: structure.contractId, institutionId: structure.institutionId, levelCode: structure.levelCode, educationLevelCode: structure.educationLevelCode, date: structure.period.startsOn });
  if (!resolved.ok) return resolved;
  if (!resolved.value) {
    return err(
      conflict(ResultsCode.NO_ACTIVE_RULESET, "Aucun jeu de règles actif pour cette classe et cette période : liez un jeu de règles (liaison manquante) avant de calculer.", {
        contractId: structure.contractId,
        date: structure.period.startsOn,
      }),
    );
  }
  const pin = resolved.value;
  const state = await insertState(tx, {
    id: deps.newId(),
    tenantId: ctx.tenantId,
    classroomId: structure.classroomId,
    academicPeriodId: structure.period.id,
    academicYearId: structure.academicYearId,
    scope: "PERIOD",
    contractId: structure.contractId,
    ruleVersionKind: pin.ruleVersionKind,
    ruleVersionId: pin.ruleVersionId,
    ruleSetCode: pin.ruleSetCode,
    ruleVersionNo: pin.ruleVersionNo,
    definitionHash: pin.definitionHash,
    pinnedBy: ctx.userId,
    now: deps.clock.now(),
  });
  return ok(state);
}

/** Charge structure, effectif et règles épinglées. */
export async function prepare(deps: ResultsDeps, ctx: RequestContext, tx: Tx, input: { classroomId: string; academicPeriodId: string }): Promise<Result<Prepared, AppError>> {
  const structure = await deps.ports.curriculum.getStructure(ctx, input);
  if (!structure) return err(notFound(ResultsCode.CURRICULUM_UNAVAILABLE, "Structure du curriculum de la classe pour cette période", `${input.classroomId}/${input.academicPeriodId}`));
  const state = await ensureState(deps, ctx, tx, structure);
  if (!state.ok) return state;
  const roster = (await deps.ports.roster.listEnrollments(ctx, input.classroomId)).filter((r) => r.active);
  if (roster.length > deps.config.maxCohort) {
    return err(validation(ResultsCode.INVALID_INPUT, `La cohorte dépasse ${deps.config.maxCohort} inscrits : découpez le groupe de classement.`, "classroomId"));
  }
  const session = await deps.ports.rules.open(ctx, {
    ruleVersionKind: state.value.ruleVersionKind,
    ruleVersionId: state.value.ruleVersionId,
    ruleSetCode: state.value.ruleSetCode,
    ruleVersionNo: state.value.ruleVersionNo,
    definitionHash: state.value.definitionHash,
    contractId: state.value.contractId,
  });
  if (!session.ok) return session;
  return ok({ state: state.value, structure, enrollments: roster.map((r) => ({ enrollmentId: r.enrollmentId, studentId: r.studentId })), session: session.value });
}

/** Moyenne du 1er semestre de chaque inscription (pour la moyenne annuelle du contrat à coefficients). */
async function firstSemesterAverages(tx: Tx, structure: ClassStructure): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!structure.firstPeriodId || structure.firstPeriodId === structure.period.id) return out;
  const first = await getStateByKey(tx, { classroomId: structure.classroomId, academicPeriodId: structure.firstPeriodId, academicYearId: structure.academicYearId, scope: "PERIOD" });
  if (!first) return out;
  for (const h of await listCurrentHeaders(tx, first.id, "FINAL")) out.set(h.enrollmentId, h.average);
  return out;
}

/** Moyennes (FINAL) des périodes PRÉCÉDENTES de l'année, par inscription puis par période (contrats à N périodes pondérées). */
async function priorPeriodAverages(tx: Tx, structure: ClassStructure): Promise<Map<string, Map<string, string | null>>> {
  const out = new Map<string, Map<string, string | null>>();
  for (const p of structure.yearPeriods) {
    if (p.id === structure.period.id) continue;
    const state = await getStateByKey(tx, { classroomId: structure.classroomId, academicPeriodId: p.id, academicYearId: structure.academicYearId, scope: "PERIOD" });
    if (!state) continue;
    for (const h of await listCurrentHeaders(tx, state.id, "FINAL")) {
      const m = out.get(h.enrollmentId) ?? new Map<string, string | null>();
      m.set(p.id, h.average);
      out.set(h.enrollmentId, m);
    }
  }
  return out;
}

/** Exécute le pipeline du contrat sur la classe entière. `withTrace` : conserve la trace d'explicabilité (résultats FINAL). */
export async function runPipeline(deps: ResultsDeps, ctx: RequestContext, tx: Tx, prepared: Prepared, options: { withTrace: boolean }): Promise<Result<ClassComputation, AppError>> {
  const { state, structure, enrollments, session } = prepared;
  const grades = await deps.ports.assess.listPublished(ctx, tx, { classroomId: structure.classroomId, academicPeriodId: structure.period.id });
  const overrides = await listApprovedOverrides(tx, state.id);
  const evaluator = session.evaluator({ trace: options.withTrace });
  try {
    if (state.contractId === "credit-semester@1") {
      return ok(computeCreditSemester({ structure, enrollments, grades, overrides, withTrace: options.withTrace }, evaluator));
    }
    if (state.contractId === "coef-semester@1") {
      return ok(computeCoefSemester({ structure, enrollments, grades, overrides, firstSemesterAverages: await firstSemesterAverages(tx, structure), withTrace: options.withTrace }, evaluator));
    }
    if (state.contractId === "secondary-annual@1") {
      return ok(computeCoefSemester({ structure, enrollments, grades, overrides, firstSemesterAverages: new Map(), contractId: "secondary-annual@1", priorAverages: structure.period.isSecondSemester ? await priorPeriodAverages(tx, structure) : new Map(), withTrace: options.withTrace }, evaluator));
    }
    if (state.contractId === "coef-period@1") {
      const last = structure.period.isSecondSemester;
      const ids = enrollments.map((e) => e.enrollmentId);
      return ok(
        computeCoefPeriod(
          {
            structure,
            enrollments,
            grades,
            overrides,
            priorAverages: last ? await priorPeriodAverages(tx, structure) : new Map(),
            yearFacts: last && deps.ports.yearFacts ? await deps.ports.yearFacts.getYearFacts(ctx, { classroomId: structure.classroomId, academicYearId: structure.academicYearId, enrollmentIds: ids }) : undefined,
            hasRule: (key) => session.hasRule(key),
            withTrace: options.withTrace,
          },
          evaluator,
        ),
      );
    }
    if (state.contractId === "competency-period@1") {
      const last = structure.period.isSecondSemester;
      const ids = enrollments.map((e) => e.enrollmentId);
      return ok(
        computeCompetencyPeriod(
          {
            structure,
            enrollments,
            counters: last && deps.ports.competencyCounters ? await deps.ports.competencyCounters.getCompetencyCounters(ctx, { classroomId: structure.classroomId, academicYearId: structure.academicYearId, enrollmentIds: ids }) : undefined,
            yearFacts: last && deps.ports.yearFacts ? await deps.ports.yearFacts.getYearFacts(ctx, { classroomId: structure.classroomId, academicYearId: structure.academicYearId, enrollmentIds: ids }) : undefined,
            withTrace: options.withTrace,
          },
          evaluator,
        ),
      );
    }
  } catch (e) {
    if (e instanceof StructureError) return err(conflict(ResultsCode.CURRICULUM_INCOMPLETE, e.message, e.details));
    throw e;
  }
  return err(validation(ResultsCode.UNSUPPORTED_CONTRACT, `Contrat non pris en charge : ${state.contractId}.`, "contractId"));
}

/** Décisions proposées par les règles pour une inscription (codes de sortie, jamais des libellés). */
export function proposalsOf(contractId: string, comp: EnrollmentComputation): ProposedDecision[] {
  if (!comp.header || comp.error) return [];
  const out: ProposedDecision[] = [];
  for (const rule of DECISION_RULES[contractId] ?? []) {
    let code: string | null = null;
    if (rule.scope === "PERIOD") code = comp.header.decisionCode;
    else code = comp.lines.find((l) => l.level === "YEAR")?.statusCode ?? null;
    if (code) out.push({ enrollmentId: comp.enrollmentId, scope: rule.scope, kind: rule.kind, code, outcome: outcomeOf(code) });
  }
  return out;
}

/**
 * Calcule la période et persiste les brouillons (idempotent). Doit s'exécuter dans la transaction de l'appelant, sous le
 * verrou consultatif de la classe × période.
 */
export async function computeDraftInTx(deps: ResultsDeps, ctx: RequestContext, tx: Tx, events: EventBuffer, prepared: Prepared): Promise<Result<ComputeReport, AppError>> {
  const { state, structure } = prepared;
  if (state.status === "CLOSED") return err(conflict(ResultsCode.STATE_CLOSED, "La période est clôturée : aucun recalcul provisoire (rouvrez-la d'abord).", { stateId: state.id }));
  const computed = await runPipeline(deps, ctx, tx, prepared, { withTrace: false });
  if (!computed.ok) return computed;
  const existing = new Map((await listDraftHeaders(tx, state.id)).map((h) => [h.enrollmentId, h]));
  const versions = await maxVersions(tx, state.id);
  const now = deps.clock.now();
  const report: ComputeReport = { stateId: state.id, contractId: state.contractId, status: state.status, computed: computed.value.enrollments.length, created: 0, rankUpdated: 0, unchanged: 0, errors: 0 };

  for (const comp of computed.value.enrollments) {
    const prev = existing.get(comp.enrollmentId) ?? null;
    if (comp.error) report.errors += 1;
    const sameRules = prev !== null && prev.ruleVersionId === state.ruleVersionId && prev.definitionHash === state.definitionHash && prev.inputsHash === comp.inputsHash;
    const sameShape = prev !== null && prev.status === (comp.error ? "ERROR" : "DRAFT") && (!comp.error || (prev.error as { code?: string } | null)?.code === comp.error.code);

    if (prev && sameRules && sameShape) {
      if (!comp.error && prev.outputsHash !== comp.outputsHash) {
        // seules des valeurs de classement / de synthèse ont changé : même version, mise à jour en place
        await guarded(async () => {
          await updateDraftSummary(tx, prev.id, comp.outputsHash, comp.header, now);
          await deleteLines(tx, prev.id);
          await insertLines(tx, ctx.tenantId, prev.id, comp.lines, deps.newId);
        });
        await upsertProposals(deps, ctx, tx, state, comp, prev.id);
        report.rankUpdated += 1;
      } else report.unchanged += 1;
      continue;
    }

    if (prev) await markSuperseded(tx, [prev.id], now);
    const id = deps.newId();
    const version = (versions.get(comp.enrollmentId) ?? 0) + 1;
    await guarded(async () => {
      await insertHeader(tx, {
        id,
        tenantId: ctx.tenantId,
        stateId: state.id,
        enrollmentId: comp.enrollmentId,
        studentId: comp.studentId,
        classroomId: structure.classroomId,
        academicPeriodId: structure.period.id,
        academicYearId: structure.academicYearId,
        scope: "PERIOD",
        version,
        status: comp.error ? "ERROR" : "DRAFT",
        contractId: state.contractId,
        ruleVersionKind: state.ruleVersionKind,
        ruleVersionId: state.ruleVersionId,
        ruleSetCode: state.ruleSetCode,
        ruleVersionNo: state.ruleVersionNo,
        definitionHash: state.definitionHash,
        engineVersion: prepared.session.engineVersion,
        inputsHash: comp.inputsHash,
        outputsHash: comp.outputsHash,
        inputs: null,
        error: comp.error ? { ...comp.error } : null,
        header: comp.header,
        closureId: null,
        lineCount: null,
        finalizedAt: null,
        supersedesId: prev?.id ?? null,
        now,
      });
      await insertLines(tx, ctx.tenantId, id, comp.lines, deps.newId);
    });
    if (!comp.error) await upsertProposals(deps, ctx, tx, state, comp, id);
    events.add(
      ResultsEvents.PERIOD_RESULT_COMPUTED,
      { v: 1, enrollmentId: comp.enrollmentId, academicPeriodId: structure.period.id, resultId: id, version, status: comp.error ? "ERROR" : "DRAFT" },
      { type: "period_result", id },
    );
    report.created += 1;
  }
  return ok(report);
}

async function upsertProposals(deps: ResultsDeps, ctx: RequestContext, tx: Tx, state: PeriodState, comp: EnrollmentComputation, resultId: string): Promise<void> {
  for (const p of proposalsOf(state.contractId, comp)) {
    await upsertProposal(tx, { id: deps.newId(), tenantId: ctx.tenantId, stateId: state.id, enrollmentId: p.enrollmentId, scope: p.scope, kind: p.kind, sourceResultId: resultId, code: p.code, outcome: p.outcome });
  }
}

/** Calcul manuel / par la file : une transaction, verrou de la classe × période. */
export async function computePeriod(deps: ResultsDeps, ctx: RequestContext, input: { classroomId: string; academicPeriodId: string; tx?: Tx | undefined }): Promise<Result<ComputeReport, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      await lockKey(tx, ctx, input.classroomId, input.academicPeriodId);
      const prepared = await prepare(deps, ctx, tx, input);
      if (!prepared.ok) return prepared;
      const events = new EventBuffer(deps, ctx);
      const report = await computeDraftInTx(deps, ctx, tx, events, prepared.value);
      if (!report.ok) return report;
      if (report.value.created + report.value.rankUpdated > 0) {
        events.audit({
          action: "results.period.computed",
          entity: "period_state",
          entityId: prepared.value.state.id,
          metadata: { classroomId: input.classroomId, academicPeriodId: input.academicPeriodId, created: report.value.created, rankUpdated: report.value.rankUpdated, errors: report.value.errors },
          severity: "info",
        });
      }
      await events.flush(tx);
      return report;
    },
    { tx: input.tx },
  );
}

export type { ResultHeader };
