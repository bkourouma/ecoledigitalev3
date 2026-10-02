/**
 * Pipeline du contrat `coef-period@1` (primaire : matières à coefficients sur N périodes pondérées) :
 * matière → période (sections optionnelles) → rangs (matière, période) → mention / suggestion d'appréciation (si la version les
 * définit) → affichage ; à la DERNIÈRE période de l'année : moyenne générale annuelle → rang annuel → cas à examiner (limite,
 * absences, redoublant) → proposition de décision en quatre codes (`PENDING`, `PROMOTED`, `REPEAT`, `COUNCIL_REVIEW`).
 *
 * Même règle d'or que `coef.ts` : AUCUNE formule ni AUCUN seuil ici. Les poids de période viennent de la donnée du plan de
 * périodes (`PeriodFacts.weight`), « dernière période » du calendrier, les faits d'assiduité et de redoublement de PORTS
 * (`EnrollmentYearFacts`). Un fait indisponible ne devient jamais une valeur devinée : il est signalé (`yearFacts: "UNAVAILABLE"`).
 */
import { hashOf } from "../hash";
import { outcomeOf } from "../catalog";
import type { ApprovedOverride, ClassComputation, ClassStructure, ComputedLine, EnrollmentComputation, EnrollmentRef, EnrollmentYearFacts, GradeFact, RuleValue, StructureNode, TraceRecord } from "../types";
import { StageRunner, asBool, asString, type BatchEvaluator, type StageItem } from "./runner";
import { validateCoefStructure } from "./coef";

export const COEF_PERIOD_CONTRACT = "coef-period@1";

export interface CoefPeriodInput {
  readonly structure: ClassStructure;
  readonly enrollments: readonly EnrollmentRef[];
  readonly grades: readonly GradeFact[];
  readonly overrides: readonly ApprovedOverride[];
  /** Moyenne de période (FINAL) des périodes précédentes de l'année : inscription → période → moyenne exacte. */
  readonly priorAverages: ReadonlyMap<string, ReadonlyMap<string, string | null>>;
  /** Faits de fin d'année par inscription ; absent ⇒ signalé indisponible. */
  readonly yearFacts?: ReadonlyMap<string, EnrollmentYearFacts> | undefined;
  /** Règles optionnelles que la version épinglée définit (`mention_periode`, `moyenne_section`…). */
  readonly hasRule: (ruleKey: string) => boolean;
  readonly withTrace: boolean;
}

interface SubjectState {
  readonly node: StructureNode;
  readonly notes: Array<{ note: string; bareme: string; poids: string; type: string }>;
  score: string | null;
  override: ApprovedOverride | null;
  display: string | null;
  rank: number | null;
  records: TraceRecord[];
}

interface SectionState {
  readonly key: string;
  score: string | null;
  display: string | null;
}

interface State {
  readonly ref: EnrollmentRef;
  readonly subjects: SubjectState[];
  readonly sections: SectionState[];
  moyenne: string | null;
  moyOverride: ApprovedOverride | null;
  mention: string | null;
  appreciation: string | null;
  display: string | null;
  rank: number | null;
  mga: string | null;
  mgaDisplay: string | null;
  mgaRank: number | null;
  periodsGraded: number;
  limite: boolean | null;
  absences: boolean | null;
  redoublant: boolean | null;
  aExaminer: boolean | null;
  yearDecision: string | null;
  factsAvailable: boolean;
  records: TraceRecord[];
  inputs: unknown;
}

const byOrder = (a: StructureNode, b: StructureNode): number => a.ordinal - b.ordinal || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const gradeOrder = (a: GradeFact, b: GradeFact): number =>
  a.assessedOn < b.assessedOn ? -1 : a.assessedOn > b.assessedOn ? 1 : a.assessmentId < b.assessmentId ? -1 : a.assessmentId > b.assessmentId ? 1 : 0;

const findOverride = (overrides: readonly ApprovedOverride[], enrollmentId: string, ruleKey: string, nodeId: string | null): ApprovedOverride | null =>
  overrides.find((o) => o.enrollmentId === enrollmentId && o.ruleKey === ruleKey && o.curriculumNodeId === nodeId) ?? null;

const overrideMark = (o: ApprovedOverride, original: RuleValue): TraceRecord => ({
  ruleKey: o.ruleKey,
  value: o.value,
  inputsHash: hashOf({ override: o.id }),
  outputsHash: hashOf({ override: o.id, value: o.value }),
  nodesEvaluated: 0,
  overridden: { overrideId: o.id, original },
});

/** Motifs du dossier à examiner, sous forme de CODES (un par signal vrai de `cas_a_examiner`). */
function reasonsOf(st: State): string[] {
  const out: string[] = [];
  if (st.limite === true) out.push("BORDERLINE");
  if (st.absences === true) out.push("LONG_ABSENCE");
  if (st.redoublant === true) out.push("ALREADY_REPEATED");
  return out;
}

export function computeCoefPeriod(input: CoefPeriodInput, evaluator: BatchEvaluator): ClassComputation {
  const { structure, enrollments, overrides } = input;
  const subjects = validateCoefStructure(structure).sort(byOrder);
  const sectionKeys = input.hasRule("moyenne_section") ? [...new Set(subjects.filter((s) => s.countsInAverage && s.sectionKey !== null).map((s) => s.sectionKey as string))].sort() : [];
  const runner = new StageRunner(evaluator, input.withTrace);
  const last = structure.period.isSecondSemester; // « dernière période de l'année » (donnée de calendrier)
  const yearPeriods = structure.yearPeriods.length > 0 ? structure.yearPeriods : [structure.period];

  const gradesBy = new Map<string, GradeFact[]>();
  for (const g of input.grades) {
    const l = gradesBy.get(g.enrollmentId);
    if (l) l.push(g);
    else gradesBy.set(g.enrollmentId, [g]);
  }
  const states: State[] = enrollments.map((ref) => {
    const mine = (gradesBy.get(ref.enrollmentId) ?? []).filter((g) => g.entryStatus === "ENTERED" && g.score !== null && g.sessionNo === 1).sort(gradeOrder);
    const facts = input.yearFacts?.get(ref.enrollmentId);
    return {
      ref,
      subjects: subjects.map((node) => ({
        node,
        notes: mine.filter((g) => g.curriculumNodeId === node.id).map((g) => ({ note: g.score as string, bareme: g.scaleMax, poids: g.weight, type: g.aggregationGroup })),
        score: null,
        override: findOverride(overrides, ref.enrollmentId, "moyenne_matiere", node.id),
        display: null,
        rank: null,
        records: [],
      })),
      sections: sectionKeys.map((key) => ({ key, score: null, display: null })),
      moyenne: null,
      moyOverride: findOverride(overrides, ref.enrollmentId, "moyenne_periode", null),
      mention: null,
      appreciation: null,
      display: null,
      rank: null,
      mga: null,
      mgaDisplay: null,
      mgaRank: null,
      periodsGraded: 0,
      limite: null,
      absences: null,
      redoublant: null,
      aExaminer: null,
      yearDecision: null,
      factsAvailable: facts !== undefined,
      records: [],
      inputs: {
        contract: COEF_PERIOD_CONTRACT,
        period: { id: structure.period.id, rank: structure.period.rankInYear, last },
        weights: yearPeriods.map((p) => ({ id: p.id, weight: p.weight ?? "1" })),
        prior: last ? yearPeriods.filter((p) => p.id !== structure.period.id).map((p) => ({ id: p.id, average: input.priorAverages.get(ref.enrollmentId)?.get(p.id) ?? null })) : [],
        facts: last ? (facts ?? null) : null,
        structure: subjects.map((s) => ({ id: s.id, coef: s.coefficient, counts: s.countsInAverage, section: s.sectionKey })),
        grades: mine.map((g) => ({ node: g.curriculumNodeId, group: g.aggregationGroup, score: g.score, scale: g.scaleMax, weight: g.weight, assessment: g.assessmentId, on: g.assessedOn })),
        overrides: overrides.filter((o) => o.enrollmentId === ref.enrollmentId).map((o) => ({ id: o.id, node: o.curriculumNodeId, ruleKey: o.ruleKey, kind: o.kind, value: o.value })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      },
    };
  });

  // ---- étape 1 : moyenne de chaque matière (aucune note ⇒ pas de note, jamais 0) ---------------------------------
  const s1: Array<StageItem<SubjectState>> = [];
  states.forEach((st, i) => {
    for (const sub of st.subjects) if (sub.notes.length > 0) s1.push({ owner: i, ruleKey: "moyenne_matiere", variables: { notes: sub.notes }, tag: sub, nodeId: sub.node.id });
  });
  for (const o of runner.batch(s1)) {
    o.tag.records.push(o.record);
    o.tag.score = asString(o.value);
  }
  for (const st of states) {
    for (const sub of st.subjects) {
      if (sub.override?.kind === "VALUE") {
        sub.records.push(overrideMark(sub.override, sub.score));
        sub.score = sub.override.value;
      }
    }
  }

  // ---- étape 2 : moyenne de période et des sections -------------------------------------------------------------------
  const rows = (st: State, filter?: string) => st.subjects.filter((s) => s.node.countsInAverage && (filter === undefined || s.node.sectionKey === filter)).map((s) => ({ score: s.score, coef: s.node.coefficient as string }));
  const s2: Array<StageItem<{ st: State; section: SectionState | null }>> = [];
  states.forEach((st, i) => {
    s2.push({ owner: i, ruleKey: "moyenne_periode", variables: { matieres: rows(st) }, tag: { st, section: null } });
    for (const sec of st.sections) s2.push({ owner: i, ruleKey: "moyenne_section", variables: { matieres: rows(st, sec.key) }, tag: { st, section: sec } });
  });
  for (const o of runner.batch(s2)) {
    const { st, section } = o.tag;
    st.records.push(o.record);
    if (section) section.score = asString(o.value);
    else {
      st.moyenne = asString(o.value);
      if (st.moyOverride?.kind === "VALUE") {
        st.records.push(overrideMark(st.moyOverride, o.value));
        st.moyenne = st.moyOverride.value;
      }
    }
  }

  // ---- étape 3 : mention / suggestion d'appréciation (optionnelles) et valeurs d'affichage -------------------------------
  const s3: Array<StageItem<{ st: State; sub: SubjectState | null; sec: SectionState | null; what: string }>> = [];
  states.forEach((st, i) => {
    if (input.hasRule("mention_periode")) s3.push({ owner: i, ruleKey: "mention_periode", variables: { moyenne: st.moyenne }, tag: { st, sub: null, sec: null, what: "mention" } });
    if (input.hasRule("appreciation_periode")) s3.push({ owner: i, ruleKey: "appreciation_periode", variables: { moyenne: st.moyenne }, tag: { st, sub: null, sec: null, what: "appreciation" } });
    s3.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: st.moyenne }, tag: { st, sub: null, sec: null, what: "display" } });
    for (const sub of st.subjects) s3.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: sub.score }, tag: { st, sub, sec: null, what: "display" } });
    for (const sec of st.sections) s3.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: sec.score }, tag: { st, sub: null, sec, what: "display" } });
  });
  for (const o of runner.batch(s3)) {
    const { st, sub, sec, what } = o.tag;
    (sub ?? st).records.push(o.record);
    if (what === "mention") st.mention = asString(o.value);
    else if (what === "appreciation") st.appreciation = asString(o.value);
    else if (sub) sub.display = asString(o.value);
    else if (sec) sec.display = asString(o.value);
    else st.display = asString(o.value);
  }

  // ---- étape 4 : rangs (matière, période), après le calcul de tout le groupe -----------------------------------------------
  const rankInputs: Array<StageItem<{ apply: (rank: number | null) => void; st: State }>> = [];
  const cohortSizes = { global: 0, subjects: new Map<string, number>() };
  const live = states.map((st, i) => ({ st, i })).filter(({ i }) => !runner.isFailed(i));
  const globalValues = live.filter(({ st }) => st.moyenne !== null).map(({ st }) => st.moyenne);
  cohortSizes.global = globalValues.length;
  for (const { st, i } of live) {
    if (st.moyenne !== null) rankInputs.push({ owner: i, ruleKey: "rang_periode", variables: { moyenne: st.moyenne, cohorte: globalValues }, tag: { st, apply: (r) => (st.rank = r) } });
  }
  subjects.forEach((node, k) => {
    const values = live.map(({ st }) => st.subjects[k]?.score ?? null).filter((v): v is string => v !== null);
    cohortSizes.subjects.set(node.id, values.length);
    for (const { st, i } of live) {
      const sub = st.subjects[k] as SubjectState;
      if (sub.score !== null) rankInputs.push({ owner: i, ruleKey: "rang_matiere", variables: { moyenne: sub.score, cohorte: values }, tag: { st, apply: (r) => (sub.rank = r) } });
    }
  });
  for (const o of runner.batch(rankInputs)) {
    o.tag.st.records.push(o.record);
    o.tag.apply(o.value === null ? null : Number(o.value));
  }

  // ---- étape 5 : dernière période — moyenne générale annuelle, cas à examiner, proposition de décision ------------------------
  let annualCohort = 0;
  if (last) {
    const periodsOf = (st: State) =>
      yearPeriods.map((p) => ({ moyenne: p.id === structure.period.id ? st.moyenne : (input.priorAverages.get(st.ref.enrollmentId)?.get(p.id) ?? null), poids: p.weight ?? "1" }));
    const s5: Array<StageItem<State>> = states.map((st, i) => ({ owner: i, ruleKey: "moyenne_generale_annuelle", variables: { periodes: periodsOf(st) }, tag: st }));
    for (const o of runner.batch(s5)) {
      o.tag.records.push(o.record);
      o.tag.mga = asString(o.value);
    }
    states.forEach((st) => (st.periodsGraded = periodsOf(st).filter((p) => p.moyenne !== null).length));

    const factsOf = (st: State): EnrollmentYearFacts => input.yearFacts?.get(st.ref.enrollmentId) ?? { absencesDays: 0, openDays: 0, cycleRepeats: 0 };
    const s5b: Array<StageItem<{ st: State; what: string }>> = [];
    states.forEach((st, i) => {
      s5b.push({ owner: i, ruleKey: "cas_limite", variables: { mga: st.mga }, tag: { st, what: "limite" } });
      s5b.push({ owner: i, ruleKey: "cas_absences", variables: { absences_journees: factsOf(st).absencesDays, jours_ouverts: factsOf(st).openDays }, tag: { st, what: "absences" } });
      s5b.push({ owner: i, ruleKey: "cas_deja_redoublant", variables: { redoublements_cycle: factsOf(st).cycleRepeats }, tag: { st, what: "redoublant" } });
      s5b.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: st.mga }, tag: { st, what: "display" } });
    });
    for (const o of runner.batch(s5b)) {
      const { st, what } = o.tag;
      st.records.push(o.record);
      if (what === "limite") st.limite = asBool(o.value);
      else if (what === "absences") st.absences = asBool(o.value);
      else if (what === "redoublant") st.redoublant = asBool(o.value);
      else st.mgaDisplay = asString(o.value);
    }
    const s5c: Array<StageItem<State>> = states.map((st, i) => ({ owner: i, ruleKey: "cas_a_examiner", variables: { limite: st.limite === true, absences: st.absences === true, redoublant: st.redoublant === true }, tag: st }));
    for (const o of runner.batch(s5c)) {
      o.tag.records.push(o.record);
      o.tag.aExaminer = asBool(o.value);
    }
    const s5d: Array<StageItem<State>> = states.map((st, i) => ({
      owner: i,
      ruleKey: "decision_fin_annee",
      variables: { mga: st.mga, periodes_notees: st.periodsGraded, periodes_attendues: yearPeriods.length, cas_examen: st.aExaminer === true },
      tag: st,
    }));
    for (const o of runner.batch(s5d)) {
      o.tag.records.push(o.record);
      o.tag.yearDecision = asString(o.value);
    }
    const liveAnnual = states.map((st, i) => ({ st, i })).filter(({ st, i }) => !runner.isFailed(i) && st.mga !== null);
    const values = liveAnnual.map(({ st }) => st.mga);
    annualCohort = values.length;
    const s5e: Array<StageItem<State>> = liveAnnual.map(({ st, i }) => ({ owner: i, ruleKey: "rang_annuel", variables: { moyenne: st.mga, cohorte: values }, tag: st }));
    for (const o of runner.batch(s5e)) {
      o.tag.records.push(o.record);
      o.tag.mgaRank = o.value === null ? null : Number(o.value);
    }
  }

  // ---- assemblage ------------------------------------------------------------------------------------------------------
  const out: EnrollmentComputation[] = states.map((st, i) => {
    const failure = runner.failures.get(i) ?? null;
    const inputsHash = hashOf(st.inputs);
    if (failure) return { enrollmentId: st.ref.enrollmentId, studentId: st.ref.studentId, error: failure, inputsHash, inputs: st.inputs, header: null, lines: [], outputsHash: null };
    const trace = (r: readonly TraceRecord[]): TraceRecord[] | null => (input.withTrace ? [...r] : null);
    const lines: ComputedLine[] = [];
    let position = 0;
    for (const sub of st.subjects) {
      lines.push({
        level: "SUBJECT",
        curriculumNodeId: sub.node.id,
        parentNodeId: null,
        value: sub.score,
        displayValue: sub.display,
        credits: null,
        coefficient: sub.node.coefficient,
        validated: null,
        statusCode: null,
        sessionObtained: null,
        resitEligible: null,
        rank: sub.rank,
        cohortSize: sub.rank === null ? null : (cohortSizes.subjects.get(sub.node.id) ?? null),
        overridden: sub.override?.kind === "VALUE",
        overrideId: sub.override?.kind === "VALUE" ? sub.override.id : null,
        outputs: { section: sub.node.sectionKey, counts_in_average: sub.node.countsInAverage, notes_count: sub.notes.length },
        trace: trace(sub.records),
        position: position++,
      });
    }
    lines.push({
      level: "PERIOD",
      curriculumNodeId: null,
      parentNodeId: null,
      value: st.moyenne,
      displayValue: st.display,
      credits: null,
      coefficient: null,
      validated: null,
      statusCode: null,
      sessionObtained: null,
      resitEligible: null,
      rank: st.rank,
      cohortSize: st.rank === null ? null : cohortSizes.global,
      overridden: st.moyOverride?.kind === "VALUE",
      overrideId: st.moyOverride?.kind === "VALUE" ? st.moyOverride.id : null,
      outputs: {
        mention: st.mention,
        appreciation: st.appreciation,
        sections: Object.fromEntries(st.sections.map((s) => [s.key, { value: s.score, display: s.display, rank: null, cohortSize: null }])),
      },
      trace: trace(st.records),
      position: position++,
    });
    if (last) {
      lines.push({
        level: "YEAR",
        curriculumNodeId: null,
        parentNodeId: null,
        value: st.mga,
        displayValue: st.mgaDisplay,
        credits: null,
        coefficient: null,
        validated: null,
        statusCode: st.yearDecision,
        sessionObtained: null,
        resitEligible: null,
        rank: st.mgaRank,
        cohortSize: st.mgaRank === null ? null : annualCohort,
        overridden: false,
        overrideId: null,
        outputs: { periodsGraded: st.periodsGraded, periodsExpected: yearPeriods.length, reasons: reasonsOf(st), yearFacts: st.factsAvailable ? "AVAILABLE" : "UNAVAILABLE" },
        trace: null,
        position: position++,
      });
    }
    const header = {
      average: st.moyenne,
      averageDisplay: st.display,
      rank: st.rank,
      cohortSize: st.rank === null ? null : cohortSizes.global,
      mentionCode: st.mention,
      decisionCode: null,
      decisionOutcome: null,
      creditsAcquired: null,
      creditsRequired: null,
      validated: null,
      summary: last
        ? {
            classSize: states.length,
            annual: { average: st.mga, display: st.mgaDisplay, rank: st.mgaRank, cohortSize: st.mgaRank === null ? null : annualCohort },
            yearDecision: st.yearDecision,
            yearDecisionOutcome: st.yearDecision === null ? null : outcomeOf(st.yearDecision),
            reasons: reasonsOf(st),
            appreciation: st.appreciation,
            yearFacts: st.factsAvailable ? "AVAILABLE" : "UNAVAILABLE",
            pending: st.moyenne === null,
          }
        : { classSize: states.length, pending: st.moyenne === null },
    };
    const outputsHash = hashOf({ header, lines: lines.map((l) => ({ ...l, trace: undefined })) });
    return { enrollmentId: st.ref.enrollmentId, studentId: st.ref.studentId, error: null, inputsHash, inputs: st.inputs, header, lines, outputsHash };
  });
  return { contractId: COEF_PERIOD_CONTRACT, enrollments: out };
}
