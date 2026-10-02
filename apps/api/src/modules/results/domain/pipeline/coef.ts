/**
 * Pipeline du contrat `coef-semester@1` (matières à coefficients : pile « classique » et BTS) :
 * matière → période (global, sections) → rang (matière, section, global) → mention, décision du conseil →
 * (2ᵉ semestre) moyenne annuelle → rang annuel → décision de fin d'année, distinction, appréciation.
 *
 * Même règle d'or que `credit` : AUCUNE formule ni seuil ici. Le « 2ᵉ semestre » vient du rang de la période (donnée de
 * calendrier, plus jamais le nom), l'examen terminal requis de l'attribut de programme, la décision se lit dans le CODE.
 * Les sections (types de bilan) ne sont pas des nœuds : leurs résultats sont portés par la ligne `PERIOD` (`outputs.sections`).
 *
 * Le même pipeline sert le contrat `secondary-annual@1` (secondaire, N périodes pondérées : spec 006 §6.4) : mêmes règles et mêmes
 * codes de sortie ; seules changent l'étape annuelle — `moyenne_annuelle` reçoit TOUTES les périodes de l'année `{ moyenne, poids }`
 * (poids du plan de périodes) et `decision_fin_annee` reçoit `derniere_periode` à la place de `second_semestre`. La « dernière
 * période » est une donnée de calendrier (`PeriodFacts.isSecondSemester` = dernière de l'année), jamais un nom.
 */
import { hashOf } from "../hash";
import { outcomeOf } from "../catalog";
import type { ApprovedOverride, ClassComputation, ClassStructure, ComputedLine, EnrollmentComputation, EnrollmentRef, GradeFact, RuleValue, StructureNode, TraceRecord } from "../types";
import { StageRunner, StructureError, asString, type BatchEvaluator, type StageItem } from "./runner";

export interface CoefInput {
  readonly structure: ClassStructure;
  readonly enrollments: readonly EnrollmentRef[];
  readonly grades: readonly GradeFact[];
  readonly overrides: readonly ApprovedOverride[];
  /** Moyenne du 1er semestre de chaque inscription (période précédente de l'année), `null` si absente. */
  readonly firstSemesterAverages: ReadonlyMap<string, string | null>;
  /** `secondary-annual@1` : contrat de la version épinglée (défaut `coef-semester@1`). */
  readonly contractId?: "coef-semester@1" | "secondary-annual@1" | undefined;
  /** `secondary-annual@1` : moyennes (FINAL) des périodes précédentes de l'année, par inscription puis par période. */
  readonly priorAverages?: ReadonlyMap<string, ReadonlyMap<string, string | null>> | undefined;
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
  rank: number | null;
}

interface State {
  readonly ref: EnrollmentRef;
  readonly subjects: SubjectState[];
  readonly sections: SectionState[];
  moyenne: string | null;
  moyOverride: ApprovedOverride | null;
  mention: string | null;
  decision: string | null;
  display: string | null;
  rank: number | null;
  s1: string | null;
  annual: string | null;
  annualDisplay: string | null;
  annualRank: number | null;
  yearDecision: string | null;
  distinction: string | null;
  appreciation: string | null;
  records: TraceRecord[];
  inputs: unknown;
}

const byOrder = (a: StructureNode, b: StructureNode): number => a.ordinal - b.ordinal || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const gradeOrder = (a: GradeFact, b: GradeFact): number =>
  a.assessedOn < b.assessedOn ? -1 : a.assessedOn > b.assessedOn ? 1 : a.assessmentId < b.assessmentId ? -1 : a.assessmentId > b.assessmentId ? 1 : 0;

export function validateCoefStructure(structure: ClassStructure): StructureNode[] {
  const subjects = structure.nodes.filter((n) => n.kind === "SUBJECT").sort(byOrder);
  const missing = subjects.filter((s) => s.countsInAverage && s.coefficient === null).map((s) => s.code);
  if (subjects.length === 0 || missing.length > 0) {
    // jamais `coef || 1` : un coefficient absent n'est pas 1 en silence
    throw new StructureError("Curriculum incomplet pour le calcul à coefficients : renseignez le coefficient de chaque matière comptée dans la moyenne.", {
      noSubject: subjects.length === 0,
      subjectsWithoutCoefficient: missing,
    });
  }
  return subjects;
}

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

export function computeCoefSemester(input: CoefInput, evaluator: BatchEvaluator): ClassComputation {
  const { structure, enrollments, overrides } = input;
  const contractId = input.contractId ?? "coef-semester@1";
  const nPeriods = contractId === "secondary-annual@1";
  const subjects = validateCoefStructure(structure);
  const sectionKeys = [...new Set(subjects.filter((s) => s.countsInAverage && s.sectionKey !== null).map((s) => s.sectionKey as string))].sort();
  const runner = new StageRunner(evaluator, input.withTrace);

  const gradesBy = new Map<string, GradeFact[]>();
  for (const g of input.grades) {
    const l = gradesBy.get(g.enrollmentId);
    if (l) l.push(g);
    else gradesBy.set(g.enrollmentId, [g]);
  }
  const states: State[] = enrollments.map((ref) => {
    const mine = (gradesBy.get(ref.enrollmentId) ?? []).filter((g) => g.entryStatus === "ENTERED" && g.score !== null && g.sessionNo === 1).sort(gradeOrder);
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
      sections: sectionKeys.map((key) => ({ key, score: null, display: null, rank: null })),
      moyenne: null,
      moyOverride: findOverride(overrides, ref.enrollmentId, "moyenne_ponderee", null),
      mention: null,
      decision: null,
      display: null,
      rank: null,
      s1: input.firstSemesterAverages.get(ref.enrollmentId) ?? null,
      annual: null,
      annualDisplay: null,
      annualRank: null,
      yearDecision: null,
      distinction: null,
      appreciation: null,
      records: [],
      inputs: {
        contract: contractId,
        ...(nPeriods ? { weights: structure.yearPeriods.map((p) => ({ id: p.id, weight: p.weight ?? "1" })), prior: structure.yearPeriods.filter((p) => p.id !== structure.period.id).map((p) => ({ id: p.id, average: input.priorAverages?.get(ref.enrollmentId)?.get(p.id) ?? null })) } : {}),
        period: { id: structure.period.id, rank: structure.period.rankInYear, second: structure.period.isSecondSemester },
        terminalExamRequired: structure.terminalExamRequired,
        firstSemester: input.firstSemesterAverages.get(ref.enrollmentId) ?? null,
        structure: subjects.map((s) => ({ id: s.id, coef: s.coefficient, counts: s.countsInAverage, section: s.sectionKey })),
        grades: mine.map((g) => ({ node: g.curriculumNodeId, group: g.aggregationGroup, score: g.score, scale: g.scaleMax, weight: g.weight, assessment: g.assessmentId, on: g.assessedOn })),
        overrides: overrides.filter((o) => o.enrollmentId === ref.enrollmentId).map((o) => ({ id: o.id, node: o.curriculumNodeId, ruleKey: o.ruleKey, kind: o.kind, value: o.value })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      },
    };
  });

  // ---- étape 1 : moyenne de chaque matière (aucune note ⇒ pas de note, jamais 0) ---------------------------------
  const s1: Array<StageItem<SubjectState>> = [];
  states.forEach((st, i) => {
    for (const sub of st.subjects) {
      if (sub.notes.length > 0) s1.push({ owner: i, ruleKey: "moyenne_matiere", variables: { notes: sub.notes }, tag: sub, nodeId: sub.node.id });
    }
  });
  for (const o of runner.batch(s1)) {
    const sub = o.tag;
    sub.records.push(o.record);
    sub.score = asString(o.value);
  }
  for (const st of states) {
    for (const sub of st.subjects) {
      if (sub.override?.kind === "VALUE") {
        sub.records.push(overrideMark(sub.override, sub.score));
        sub.score = sub.override.value;
      }
    }
  }

  // ---- étape 2 : moyenne de période et des sections --------------------------------------------------------------
  const rows = (st: State, filter?: string) => st.subjects.filter((s) => s.node.countsInAverage && (filter === undefined || s.node.sectionKey === filter)).map((s) => ({ score: s.score, coef: s.node.coefficient as string }));
  const s2: Array<StageItem<{ st: State; section: SectionState | null }>> = [];
  states.forEach((st, i) => {
    s2.push({ owner: i, ruleKey: "moyenne_ponderee", variables: { matieres: rows(st) }, tag: { st, section: null } });
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

  // ---- étape 3 : mention, décision du conseil, valeurs d'affichage ---------------------------------------------------
  const s3: Array<StageItem<{ st: State; sub: SubjectState | null; sec: SectionState | null; what: string }>> = [];
  states.forEach((st, i) => {
    s3.push({ owner: i, ruleKey: "mention", variables: { moyenne: st.moyenne }, tag: { st, sub: null, sec: null, what: "mention" } });
    s3.push({ owner: i, ruleKey: "decision_conseil", variables: { moyenne: st.moyenne }, tag: { st, sub: null, sec: null, what: "decision" } });
    s3.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: st.moyenne }, tag: { st, sub: null, sec: null, what: "display" } });
    for (const sub of st.subjects) s3.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: sub.score }, tag: { st, sub, sec: null, what: "display" } });
    for (const sec of st.sections) s3.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: sec.score }, tag: { st, sub: null, sec, what: "display" } });
  });
  for (const o of runner.batch(s3)) {
    const { st, sub, sec, what } = o.tag;
    (sub ?? st).records.push(o.record);
    if (what === "mention") st.mention = asString(o.value);
    else if (what === "decision") st.decision = asString(o.value);
    else if (sub) sub.display = asString(o.value);
    else if (sec) sec.display = asString(o.value);
    else st.display = asString(o.value);
  }

  // ---- étape 4 : rangs (matière, section, global), après le calcul de tout le groupe -----------------------------------
  const rankInputs: Array<StageItem<{ apply: (rank: number | null) => void; st: State }>> = [];
  const cohortSizes = { global: 0, subjects: new Map<string, number>(), sections: new Map<string, number>() };
  const live = states.map((st, i) => ({ st, i })).filter(({ i }) => !runner.isFailed(i));
  const globalValues = live.filter(({ st }) => st.moyenne !== null).map(({ st }) => st.moyenne);
  cohortSizes.global = globalValues.length;
  for (const { st, i } of live) {
    if (st.moyenne !== null) rankInputs.push({ owner: i, ruleKey: "rang", variables: { moyenne: st.moyenne, cohorte: globalValues }, tag: { st, apply: (r) => (st.rank = r) } });
  }
  subjects.forEach((node, k) => {
    const values = live.map(({ st }) => st.subjects[k]?.score ?? null).filter((v): v is string => v !== null);
    cohortSizes.subjects.set(node.id, values.length);
    for (const { st, i } of live) {
      const sub = st.subjects[k] as SubjectState;
      if (sub.score !== null) rankInputs.push({ owner: i, ruleKey: "rang", variables: { moyenne: sub.score, cohorte: values }, tag: { st, apply: (r) => (sub.rank = r) } });
    }
  });
  sectionKeys.forEach((key, k) => {
    const values = live.map(({ st }) => st.sections[k]?.score ?? null).filter((v): v is string => v !== null);
    cohortSizes.sections.set(key, values.length);
    for (const { st, i } of live) {
      const sec = st.sections[k] as SectionState;
      if (sec.score !== null) rankInputs.push({ owner: i, ruleKey: "rang", variables: { moyenne: sec.score, cohorte: values }, tag: { st, apply: (r) => (sec.rank = r) } });
    }
  });
  for (const o of runner.batch(rankInputs)) {
    o.tag.st.records.push(o.record);
    o.tag.apply(o.value === null ? null : Number(o.value));
  }

  // ---- étape 5 : 2ᵉ semestre — moyenne annuelle, rang annuel, décision de fin d'année -------------------------------------
  const second = structure.period.isSecondSemester;
  let annualCohort = 0;
  if (second) {
    const s5: Array<StageItem<{ st: State; what: string }>> = [];
    const periodsOf = (st: State) =>
      (structure.yearPeriods.length > 0 ? structure.yearPeriods : [structure.period]).map((p) => ({ moyenne: p.id === structure.period.id ? st.moyenne : (input.priorAverages?.get(st.ref.enrollmentId)?.get(p.id) ?? null), poids: p.weight ?? "1" }));
    states.forEach((st, i) => s5.push({ owner: i, ruleKey: "moyenne_annuelle", variables: nPeriods ? { periodes: periodsOf(st) } : { s1: st.s1, s2: st.moyenne, second_semestre: true }, tag: { st, what: "annual" } }));
    for (const o of runner.batch(s5)) {
      o.tag.st.records.push(o.record);
      o.tag.st.annual = asString(o.value);
    }
    const s5b: Array<StageItem<{ st: State; what: string }>> = [];
    states.forEach((st, i) => {
      s5b.push({ owner: i, ruleKey: "decision_fin_annee", variables: nPeriods ? { moyenne: st.annual, derniere_periode: true, examen_terminal_requis: structure.terminalExamRequired } : { moyenne: st.annual, second_semestre: true, examen_terminal_requis: structure.terminalExamRequired }, tag: { st, what: "year" } });
      s5b.push({ owner: i, ruleKey: "distinction", variables: { moyenne: st.annual }, tag: { st, what: "distinction" } });
      s5b.push({ owner: i, ruleKey: "appreciation_conseil", variables: { moyenne: st.annual }, tag: { st, what: "appreciation" } });
      s5b.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: st.annual }, tag: { st, what: "display" } });
    });
    for (const o of runner.batch(s5b)) {
      const { st, what } = o.tag;
      st.records.push(o.record);
      if (what === "year") st.yearDecision = asString(o.value);
      else if (what === "distinction") st.distinction = asString(o.value);
      else if (what === "appreciation") st.appreciation = asString(o.value);
      else st.annualDisplay = asString(o.value);
    }
    const liveAnnual = states.map((st, i) => ({ st, i })).filter(({ st, i }) => !runner.isFailed(i) && st.annual !== null);
    const values = liveAnnual.map(({ st }) => st.annual);
    annualCohort = values.length;
    const s5c: Array<StageItem<State>> = liveAnnual.map(({ st, i }) => ({ owner: i, ruleKey: "rang", variables: { moyenne: st.annual, cohorte: values }, tag: st }));
    for (const o of runner.batch(s5c)) {
      o.tag.records.push(o.record);
      o.tag.annualRank = o.value === null ? null : Number(o.value);
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
      statusCode: st.decision,
      sessionObtained: null,
      resitEligible: null,
      rank: st.rank,
      cohortSize: st.rank === null ? null : cohortSizes.global,
      overridden: st.moyOverride?.kind === "VALUE",
      overrideId: st.moyOverride?.kind === "VALUE" ? st.moyOverride.id : null,
      outputs: {
        mention: st.mention,
        sections: Object.fromEntries(st.sections.map((s) => [s.key, { value: s.score, display: s.display, rank: s.rank, cohortSize: s.rank === null ? null : (cohortSizes.sections.get(s.key) ?? null) }])),
      },
      trace: trace(st.records),
      position: position++,
    });
    if (second) {
      lines.push({
        level: "YEAR",
        curriculumNodeId: null,
        parentNodeId: null,
        value: st.annual,
        displayValue: st.annualDisplay,
        credits: null,
        coefficient: null,
        validated: null,
        statusCode: st.yearDecision,
        sessionObtained: null,
        resitEligible: null,
        rank: st.annualRank,
        cohortSize: st.annualRank === null ? null : annualCohort,
        overridden: false,
        overrideId: null,
        outputs: { s1: st.s1, s2: st.moyenne, distinction: st.distinction, appreciation: st.appreciation },
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
      decisionCode: st.decision,
      decisionOutcome: st.decision === null ? ("PENDING" as const) : outcomeOf(st.decision),
      creditsAcquired: null,
      creditsRequired: null,
      validated: null,
      summary: second
        ? { classSize: states.length, annual: { average: st.annual, display: st.annualDisplay, rank: st.annualRank, cohortSize: st.annualRank === null ? null : annualCohort }, yearDecision: st.yearDecision, distinction: st.distinction, appreciation: st.appreciation, pending: st.moyenne === null }
        : { classSize: states.length, pending: st.moyenne === null },
    };
    const outputsHash = hashOf({ header, lines: lines.map((l) => ({ ...l, trace: undefined })) });
    return { enrollmentId: st.ref.enrollmentId, studentId: st.ref.studentId, error: null, inputsHash, inputs: st.inputs, header, lines, outputsHash };
  });
  return { contractId, enrollments: out };
}
