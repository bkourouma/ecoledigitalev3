/**
 * Pipeline minimal du contrat `competency-period@1` (maternelle : évaluation par compétences, SANS note, moyenne ni rang).
 *
 * `results` n'exécute que `decision_fin_annee` (à la dernière période de l'année) à partir des COMPTEURS de compétences fournis
 * par `primary_school` (évaluées / attendues) et du nombre de redoublements du cycle (`academic`). La règle ne décide jamais
 * seule : sa proposition est `PENDING` ou `COUNCIL_REVIEW`, le conseil décide. Aucune formule, aucun seuil, aucune note ici.
 */
import { hashOf } from "../hash";
import { outcomeOf } from "../catalog";
import type { ClassComputation, ClassStructure, CompetencyCounters, ComputedLine, EnrollmentComputation, EnrollmentRef, EnrollmentYearFacts, TraceRecord } from "../types";
import { StageRunner, StructureError, asString, type BatchEvaluator, type StageItem } from "./runner";

export const COMPETENCY_PERIOD_CONTRACT = "competency-period@1";

export interface CompetencyPeriodInput {
  readonly structure: ClassStructure;
  readonly enrollments: readonly EnrollmentRef[];
  /** Compteurs par inscription (`primary_school`) ; absents à la dernière période ⇒ erreur de structure (échec fermé). */
  readonly counters?: ReadonlyMap<string, CompetencyCounters> | undefined;
  readonly yearFacts?: ReadonlyMap<string, EnrollmentYearFacts> | undefined;
  readonly withTrace: boolean;
}

export function computeCompetencyPeriod(input: CompetencyPeriodInput, evaluator: BatchEvaluator): ClassComputation {
  const { structure, enrollments } = input;
  const last = structure.period.isSecondSemester; // « dernière période de l'année » (donnée de calendrier)
  if (last && !input.counters) {
    throw new StructureError("Compteurs de compétences indisponibles : la décision de fin d'année de la maternelle n'est calculée qu'à partir des compétences évaluées (module primary_school).", { missing: "competency_counters" });
  }
  const runner = new StageRunner(evaluator, input.withTrace);

  const inputsOf = (ref: EnrollmentRef) => ({
    contract: COMPETENCY_PERIOD_CONTRACT,
    period: { id: structure.period.id, rank: structure.period.rankInYear, last },
    counters: last ? (input.counters?.get(ref.enrollmentId) ?? { evaluated: 0, expected: 0 }) : null,
    cycleRepeats: last ? (input.yearFacts?.get(ref.enrollmentId)?.cycleRepeats ?? 0) : null,
  });
  const decisions = new Map<number, string | null>();
  const records = new Map<number, TraceRecord[]>();

  if (last) {
    const items: Array<StageItem<number>> = enrollments.map((ref, i) => {
      const counters = input.counters?.get(ref.enrollmentId) ?? { evaluated: 0, expected: 0 };
      return {
        owner: i,
        ruleKey: "decision_fin_annee",
        variables: { competences_evaluees: counters.evaluated, competences_attendues: counters.expected, redoublements_cycle: input.yearFacts?.get(ref.enrollmentId)?.cycleRepeats ?? 0 },
        tag: i,
      };
    });
    for (const o of runner.batch(items)) {
      decisions.set(o.tag, asString(o.value));
      records.set(o.tag, [o.record]);
    }
  }

  const out: EnrollmentComputation[] = enrollments.map((ref, i) => {
    const failure = runner.failures.get(i) ?? null;
    const inputs = inputsOf(ref);
    const inputsHash = hashOf(inputs);
    if (failure) return { enrollmentId: ref.enrollmentId, studentId: ref.studentId, error: failure, inputsHash, inputs, header: null, lines: [], outputsHash: null };
    const decision = decisions.get(i) ?? null;
    const trace = (r: readonly TraceRecord[]): TraceRecord[] | null => (input.withTrace ? [...r] : null);
    const lines: ComputedLine[] = [
      {
        level: "PERIOD", curriculumNodeId: null, parentNodeId: null, value: null, displayValue: null, credits: null, coefficient: null, validated: null, statusCode: null,
        sessionObtained: null, resitEligible: null, rank: null, cohortSize: null, overridden: false, overrideId: null, outputs: {}, trace: null, position: 0,
      },
    ];
    if (last) {
      lines.push({
        level: "YEAR", curriculumNodeId: null, parentNodeId: null, value: null, displayValue: null, credits: null, coefficient: null, validated: null, statusCode: decision,
        sessionObtained: null, resitEligible: null, rank: null, cohortSize: null, overridden: false, overrideId: null,
        outputs: { competencesEvaluated: (inputs.counters as CompetencyCounters).evaluated, competencesExpected: (inputs.counters as CompetencyCounters).expected },
        trace: trace(records.get(i) ?? []), position: 1,
      });
    }
    const header = {
      average: null,
      averageDisplay: null,
      rank: null,
      cohortSize: null,
      mentionCode: null,
      decisionCode: null,
      decisionOutcome: null,
      creditsAcquired: null,
      creditsRequired: null,
      validated: null,
      summary: last ? { classSize: enrollments.length, yearDecision: decision, yearDecisionOutcome: decision === null ? null : outcomeOf(decision), pending: decision === "PENDING" } : { classSize: enrollments.length },
    };
    const outputsHash = hashOf({ header, lines: lines.map((l) => ({ ...l, trace: undefined })) });
    return { enrollmentId: ref.enrollmentId, studentId: ref.studentId, error: null, inputsHash, inputs, header, lines, outputsHash };
  });
  return { contractId: COMPETENCY_PERIOD_CONTRACT, enrollments: out };
}
