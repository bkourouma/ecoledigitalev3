/**
 * Pipeline du contrat `credit-semester@1` (supérieur à crédits : ECUE → UE → semestre → rang).
 *
 * `results` ORCHESTRE : il constitue le contexte typé (notes publiées, structure, surcharges), appelle les règles dans
 * l'ordre du contrat, persiste. AUCUNE formule, AUCUN seuil, AUCUNE arithmétique de moyenne ici : tout vient des règles
 * (`note_sur_20`, `moyenne_devoirs`, `note_examen_retenue`, `note_ecue`, `moyenne_ue`, `ue_validee`, `moyenne_session`,
 * `semestre_valide`, `decision_semestre`, `rang`…). Seul le TRI et le regroupement des données sont faits ici.
 *
 * Décisions de contexte (rule-contracts.md §4) :
 *  - uniquement des notes PUBLIÉES ; une note absente / dispensée / non évaluée ne produit AUCUN zéro (la règle voit « pas de
 *    note ») ; ordre déterministe (date, puis identifiant) ; aucune identité d'élève dans le contexte ;
 *  - devoirs = notes de session 1 des types hors groupe d'examen ; examen = la dernière note du groupe d'examen de chaque
 *    session ; chaque note d'examen est ramenée sur 20 par la règle `note_sur_20` ;
 *  - session 2 : `note_s1` et `note_s2` séparées (la règle `note_examen_retenue` décide : la session 2 REMPLACE) ;
 *  - validation manuelle (jury) et valeurs surchargées : issues de `results.overrides` APPROUVÉES, tracées.
 */
import { canonicalJson, hashOf } from "../hash";
import { EXAM_AGGREGATION_GROUP, outcomeOf } from "../catalog";
import type {
  ApprovedOverride,
  ClassComputation,
  ClassStructure,
  ComputedLine,
  EnrollmentComputation,
  EnrollmentRef,
  GradeFact,
  RuleValue,
  StructureNode,
  TraceRecord,
} from "../types";
import { StageRunner, StructureError, asBool, asString, type BatchEvaluator, type StageItem } from "./runner";

export interface CreditInput {
  readonly structure: ClassStructure;
  readonly enrollments: readonly EnrollmentRef[];
  readonly grades: readonly GradeFact[];
  readonly overrides: readonly ApprovedOverride[];
  readonly withTrace: boolean;
}

interface ExamNote {
  readonly note: string;
  readonly bareme: string;
}

interface EcueState {
  readonly node: StructureNode;
  readonly devoirs: Array<{ note: string; bareme: string; poids: string }>;
  readonly examS1: ExamNote | null;
  readonly examS2: ExamNote | null;
  noteS1: string | null;
  noteS2: string | null;
  moyDevoirs: string | null;
  noteExamen: string | null;
  sessionRetenue: number | null;
  noteEcue: string | null;
  noteOverride: ApprovedOverride | null;
  vm: boolean;
  vmOverride: ApprovedOverride | null;
  eliminee: boolean | null;
  validee: boolean | null;
  statut: string | null;
  eligible: boolean | null;
  display: string | null;
  records: TraceRecord[];
}

interface UeState {
  readonly node: StructureNode;
  readonly ecues: EcueState[];
  moyenne: string | null;
  moyOverride: ApprovedOverride | null;
  validee: boolean | null;
  valOverride: ApprovedOverride | null;
  credits: string | null;
  etat: string | null;
  sessionValidation: string | null;
  display: string | null;
  records: TraceRecord[];
}

interface EnrollmentState {
  readonly ref: EnrollmentRef;
  readonly ues: UeState[];
  moyenne: string | null;
  moyOverride: ApprovedOverride | null;
  creditsValides: string | null;
  creditsTotal: string | null;
  semestreValide: boolean | null;
  valOverride: ApprovedOverride | null;
  decision: string | null;
  mention: string | null;
  appreciation: string | null;
  distinction: string | null;
  display: string | null;
  rank: number | null;
  records: TraceRecord[];
  inputs: unknown;
}

const byOrder = <T extends { ordinal: number; id: string }>(a: T, b: T): number => a.ordinal - b.ordinal || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const gradeOrder = (a: GradeFact, b: GradeFact): number =>
  a.assessedOn < b.assessedOn ? -1 : a.assessedOn > b.assessedOn ? 1 : a.assessmentId < b.assessmentId ? -1 : a.assessmentId > b.assessmentId ? 1 : 0;

/** Valide la structure : crédits renseignés sur chaque ECUE, au moins une ECUE par UE (jamais de `credits || 0` silencieux). */
export function validateCreditStructure(structure: ClassStructure): { ues: StructureNode[]; ecuesOf: Map<string, StructureNode[]> } {
  const ues = structure.nodes.filter((n) => n.kind === "UE").sort(byOrder);
  const ecuesOf = new Map<string, StructureNode[]>();
  const missing: string[] = [];
  const empty: string[] = [];
  for (const ue of ues) {
    const ecues = structure.nodes.filter((n) => n.kind === "ECUE" && n.parentId === ue.id).sort(byOrder);
    if (ecues.length === 0) empty.push(ue.code);
    for (const e of ecues) if (e.credits === null) missing.push(e.code);
    ecuesOf.set(ue.id, ecues);
  }
  if (ues.length === 0 || missing.length > 0 || empty.length > 0) {
    throw new StructureError("Curriculum incomplet pour le calcul à crédits : renseignez les crédits de chaque ECUE et au moins une ECUE par UE.", {
      noUe: ues.length === 0,
      ecuesWithoutCredits: missing,
      uesWithoutEcue: empty,
    });
  }
  return { ues, ecuesOf };
}

function findOverride(overrides: readonly ApprovedOverride[], enrollmentId: string, ruleKey: string, nodeId: string | null): ApprovedOverride | null {
  return overrides.find((o) => o.enrollmentId === enrollmentId && o.ruleKey === ruleKey && o.curriculumNodeId === nodeId) ?? null;
}

const overrideMark = (o: ApprovedOverride | null, original: RuleValue): TraceRecord | null =>
  o ? { ruleKey: o.ruleKey, value: o.kind === "VALUE" ? o.value : o.flag, inputsHash: hashOf({ override: o.id }), outputsHash: hashOf({ override: o.id, value: o.kind === "VALUE" ? o.value : o.flag }), nodesEvaluated: 0, overridden: { overrideId: o.id, original } } : null;

export function computeCreditSemester(input: CreditInput, evaluator: BatchEvaluator): ClassComputation {
  const { structure, enrollments, overrides } = input;
  const { ues, ecuesOf } = validateCreditStructure(structure);
  const runner = new StageRunner(evaluator, input.withTrace);

  // ---- constitution des contextes (tri et regroupement uniquement) ------------------------------------------
  const gradesBy = new Map<string, GradeFact[]>();
  for (const g of input.grades) {
    const list = gradesBy.get(g.enrollmentId);
    if (list) list.push(g);
    else gradesBy.set(g.enrollmentId, [g]);
  }
  const states: EnrollmentState[] = enrollments.map((ref) => {
    const mine = (gradesBy.get(ref.enrollmentId) ?? []).filter((g) => g.entryStatus === "ENTERED" && g.score !== null).sort(gradeOrder);
    const ueStates: UeState[] = ues.map((ue) => ({
      node: ue,
      moyenne: null,
      moyOverride: null,
      validee: null,
      valOverride: null,
      credits: null,
      etat: null,
      sessionValidation: null,
      display: null,
      records: [],
      ecues: (ecuesOf.get(ue.id) ?? []).map((node) => {
        const ofNode = mine.filter((g) => g.curriculumNodeId === node.id);
        const exams = (session: 1 | 2): ExamNote | null => {
          const last = ofNode.filter((g) => g.sessionNo === session && g.aggregationGroup === EXAM_AGGREGATION_GROUP).at(-1);
          return last ? { note: last.score as string, bareme: last.scaleMax } : null;
        };
        const vmOverride = findOverride(overrides, ref.enrollmentId, "ecue_validee", node.id);
        return {
          node,
          devoirs: ofNode.filter((g) => g.sessionNo === 1 && g.aggregationGroup !== EXAM_AGGREGATION_GROUP).map((g) => ({ note: g.score as string, bareme: g.scaleMax, poids: g.weight })),
          examS1: exams(1),
          examS2: exams(2),
          noteS1: null,
          noteS2: null,
          moyDevoirs: null,
          noteExamen: null,
          sessionRetenue: null,
          noteEcue: null,
          noteOverride: findOverride(overrides, ref.enrollmentId, "note_ecue", node.id),
          vm: vmOverride?.flag === true,
          vmOverride: vmOverride?.flag === true ? vmOverride : null,
          eliminee: null,
          validee: null,
          statut: null,
          eligible: null,
          display: null,
          records: [],
        };
      }),
    }));
    const myOverrides = overrides.filter((o) => o.enrollmentId === ref.enrollmentId).map((o) => ({ id: o.id, level: o.level, node: o.curriculumNodeId, ruleKey: o.ruleKey, kind: o.kind, value: o.value, flag: o.flag })).sort((a, b) => (a.id < b.id ? -1 : 1));
    return {
      ref,
      ues: ueStates,
      moyenne: null,
      moyOverride: findOverride(overrides, ref.enrollmentId, "moyenne_session", null),
      creditsValides: null,
      creditsTotal: null,
      semestreValide: null,
      valOverride: findOverride(overrides, ref.enrollmentId, "semestre_valide", null),
      decision: null,
      mention: null,
      appreciation: null,
      distinction: null,
      display: null,
      rank: null,
      records: [],
      inputs: {
        contract: "credit-semester@1",
        period: { id: structure.period.id, rank: structure.period.rankInYear, second: structure.period.isSecondSemester },
        structure: ues.map((u) => ({ id: u.id, code: u.code, ecues: (ecuesOf.get(u.id) ?? []).map((e) => ({ id: e.id, credits: e.credits, mode: e.gradingMode, resit: e.resitAllowed })) })),
        grades: mine.map((g) => ({ node: g.curriculumNodeId, session: g.sessionNo, group: g.aggregationGroup, score: g.score, scale: g.scaleMax, weight: g.weight, assessment: g.assessmentId, on: g.assessedOn })),
        overrides: myOverrides,
      },
    };
  });
  const ecueRows = (ue: UeState) => ue.ecues.map((e) => ({ note: e.noteEcue, credits: e.node.credits as string, validation_manuelle: e.vm }));

  // ---- étape 1 : notes d'examen sur 20, moyenne des devoirs --------------------------------------------------
  const s1: Array<StageItem<{ e: EcueState; what: "s1" | "s2" | "dev" }>> = [];
  states.forEach((st, i) =>
    st.ues.forEach((ue) =>
      ue.ecues.forEach((e) => {
        if (e.examS1) s1.push({ owner: i, ruleKey: "note_sur_20", variables: { note: e.examS1.note, bareme: e.examS1.bareme }, tag: { e, what: "s1" }, nodeId: e.node.id });
        if (e.examS2) s1.push({ owner: i, ruleKey: "note_sur_20", variables: { note: e.examS2.note, bareme: e.examS2.bareme }, tag: { e, what: "s2" }, nodeId: e.node.id });
        if (e.node.gradingMode === "COMPOSED") s1.push({ owner: i, ruleKey: "moyenne_devoirs", variables: { devoirs: e.devoirs }, tag: { e, what: "dev" }, nodeId: e.node.id });
      }),
    ),
  );
  for (const o of runner.batch(s1)) {
    const { e, what } = o.tag;
    e.records.push(o.record);
    if (what === "s1") e.noteS1 = asString(o.value);
    else if (what === "s2") e.noteS2 = asString(o.value);
    else e.moyDevoirs = asString(o.value);
  }

  // ---- étape 2 : examen retenu et session retenue ---------------------------------------------------------
  const s2: Array<StageItem<{ e: EcueState; what: "note" | "session" }>> = [];
  states.forEach((st, i) =>
    st.ues.forEach((ue) =>
      ue.ecues.forEach((e) => {
        const variables = { note_s1: e.noteS1, note_s2: e.noteS2 };
        s2.push({ owner: i, ruleKey: "note_examen_retenue", variables, tag: { e, what: "note" }, nodeId: e.node.id });
        s2.push({ owner: i, ruleKey: "session_examen_retenue", variables, tag: { e, what: "session" }, nodeId: e.node.id });
      }),
    ),
  );
  for (const o of runner.batch(s2)) {
    o.tag.e.records.push(o.record);
    if (o.tag.what === "note") o.tag.e.noteExamen = asString(o.value);
    else o.tag.e.sessionRetenue = o.value === null ? null : Number(o.value);
  }

  // ---- étape 3 : note d'ECUE (composée ou directe) ---------------------------------------------------------
  const s3: Array<StageItem<EcueState>> = [];
  states.forEach((st, i) =>
    st.ues.forEach((ue) =>
      ue.ecues.forEach((e) =>
        s3.push(
          e.node.gradingMode === "DIRECT"
            ? { owner: i, ruleKey: "note_ecue_directe", variables: { note_examen: e.noteExamen }, tag: e, nodeId: e.node.id }
            : { owner: i, ruleKey: "note_ecue", variables: { moyenne_devoirs: e.moyDevoirs, note_examen: e.noteExamen }, tag: e, nodeId: e.node.id },
        ),
      ),
    ),
  );
  for (const o of runner.batch(s3)) {
    const e = o.tag;
    e.records.push(o.record);
    e.noteEcue = asString(o.value);
    if (e.noteOverride?.kind === "VALUE") {
      const mark = overrideMark(e.noteOverride, o.value);
      if (mark) e.records.push(mark);
      e.noteEcue = e.noteOverride.value;
    }
  }

  // ---- étape 4 : moyenne d'UE -----------------------------------------------------------------------------
  const s4: Array<StageItem<UeState>> = [];
  states.forEach((st, i) => st.ues.forEach((ue) => s4.push({ owner: i, ruleKey: "moyenne_ue", variables: { ecues: ecueRows(ue) }, tag: ue, nodeId: ue.node.id })));
  states.forEach((st, i) =>
    st.ues.forEach((ue) => {
      ue.moyOverride = findOverride(overrides, st.ref.enrollmentId, "moyenne_ue", ue.node.id);
      ue.valOverride = findOverride(overrides, st.ref.enrollmentId, "ue_validee", ue.node.id);
      void i;
    }),
  );
  for (const o of runner.batch(s4)) {
    const ue = o.tag;
    ue.records.push(o.record);
    ue.moyenne = asString(o.value);
    if (ue.moyOverride?.kind === "VALUE") {
      const mark = overrideMark(ue.moyOverride, o.value);
      if (mark) ue.records.push(mark);
      ue.moyenne = ue.moyOverride.value;
    }
  }

  // ---- étape 5 : validation d'UE, élimination et validation d'ECUE, crédits d'UE ------------------------------
  const s5: Array<StageItem<{ ue: UeState; e: EcueState | null; what: string }>> = [];
  states.forEach((st, i) =>
    st.ues.forEach((ue) => {
      s5.push({ owner: i, ruleKey: "ue_validee", variables: { moyenne: ue.moyenne, ecues: ecueRows(ue) }, tag: { ue, e: null, what: "ue_validee" }, nodeId: ue.node.id });
      s5.push({ owner: i, ruleKey: "credits_ue", variables: { ecues: ecueRows(ue) }, tag: { ue, e: null, what: "credits_ue" }, nodeId: ue.node.id });
      for (const e of ue.ecues) {
        s5.push({ owner: i, ruleKey: "ecue_eliminee", variables: { note: e.noteEcue, validation_manuelle: e.vm }, tag: { ue, e, what: "eliminee" }, nodeId: e.node.id });
        s5.push({ owner: i, ruleKey: "ecue_validee", variables: { note: e.noteEcue, validation_manuelle: e.vm }, tag: { ue, e, what: "validee" }, nodeId: e.node.id });
      }
    }),
  );
  for (const o of runner.batch(s5)) {
    const { ue, e, what } = o.tag;
    (e ?? ue).records.push(o.record);
    switch (what) {
      case "ue_validee": {
        ue.validee = asBool(o.value);
        if (ue.valOverride?.kind === "VALIDATION") {
          const mark = overrideMark(ue.valOverride, o.value);
          if (mark) ue.records.push(mark);
          ue.validee = ue.valOverride.flag;
        }
        break;
      }
      case "credits_ue":
        ue.credits = asString(o.value);
        break;
      case "eliminee":
        if (e) e.eliminee = asBool(o.value);
        break;
      case "validee":
        if (e) {
          e.validee = asBool(o.value);
          if (e.vmOverride) {
            const mark = overrideMark(e.vmOverride, null) /* la validation manuelle est une ENTRÉE de la règle : pas de valeur « d'origine » à ce niveau */;
            if (mark) e.records.push(mark);
          }
        }
        break;
    }
  }

  // ---- étape 6 : statut d'ECUE, état LMD de l'UE, session de validation, éligibilité au rattrapage ---------------
  const s6: Array<StageItem<{ ue: UeState; e: EcueState | null; what: string }>> = [];
  states.forEach((st, i) =>
    st.ues.forEach((ue) => {
      if (ue.validee === null) return;
      // une UE dont AUCUNE ECUE n'accepte de session 2 ne peut pas être « à repasser » : sa non-validation est une dette
      const resitPossible = ue.ecues.some((e) => e.node.resitAllowed);
      const session2Tried = ue.ecues.some((e) => e.examS2 !== null) || !resitPossible;
      s6.push({ owner: i, ruleKey: "etat_ue", variables: { validee: ue.validee, session2_tentee: session2Tried }, tag: { ue, e: null, what: "etat_ue" }, nodeId: ue.node.id });
      s6.push({
        owner: i,
        ruleKey: "session_validation_ue",
        variables: { validee: ue.validee, sessions: ue.ecues.map((e) => e.sessionRetenue ?? (e.vm ? 2 : 1)) },
        tag: { ue, e: null, what: "session_validation" },
        nodeId: ue.node.id,
      });
      for (const e of ue.ecues) {
        s6.push({ owner: i, ruleKey: "statut_ecue", variables: { note: e.noteEcue, ue_validee: ue.validee }, tag: { ue, e, what: "statut" }, nodeId: e.node.id });
        s6.push({
          owner: i,
          ruleKey: "eligible_rattrapage",
          variables: { note: e.noteEcue, validee: e.validee ?? false, session2_tentee: e.examS2 !== null, rattrapage_autorise: e.node.resitAllowed },
          tag: { ue, e, what: "eligible" },
          nodeId: e.node.id,
        });
      }
    }),
  );
  for (const o of runner.batch(s6)) {
    const { ue, e, what } = o.tag;
    (e ?? ue).records.push(o.record);
    if (what === "etat_ue") ue.etat = asString(o.value);
    else if (what === "session_validation") ue.sessionValidation = asString(o.value);
    else if (what === "statut" && e) e.statut = asString(o.value);
    else if (what === "eligible" && e) e.eligible = asBool(o.value);
  }

  // ---- étape 7 : semestre ---------------------------------------------------------------------------------
  const ueRows = (st: EnrollmentState) => st.ues.map((u) => ({ moyenne: u.moyenne, credits: u.credits, validee: u.validee ?? false }));
  const s7: Array<StageItem<{ st: EnrollmentState; what: string }>> = [];
  states.forEach((st, i) => {
    if (st.ues.some((u) => u.credits === null)) return;
    const rows = ueRows(st);
    s7.push({ owner: i, ruleKey: "moyenne_session", variables: { ues: rows }, tag: { st, what: "moyenne" } });
    s7.push({ owner: i, ruleKey: "credits_valides", variables: { ues: rows }, tag: { st, what: "valides" } });
    s7.push({ owner: i, ruleKey: "credits_total", variables: { ues: rows }, tag: { st, what: "total" } });
    s7.push({ owner: i, ruleKey: "semestre_valide", variables: { ues: rows.map((r) => ({ validee: r.validee, credits: r.credits })) }, tag: { st, what: "valide" } });
  });
  for (const o of runner.batch(s7)) {
    const { st, what } = o.tag;
    st.records.push(o.record);
    if (what === "moyenne") {
      st.moyenne = asString(o.value);
      if (st.moyOverride?.kind === "VALUE") {
        const mark = overrideMark(st.moyOverride, o.value);
        if (mark) st.records.push(mark);
        st.moyenne = st.moyOverride.value;
      }
    } else if (what === "valides") st.creditsValides = asString(o.value);
    else if (what === "total") st.creditsTotal = asString(o.value);
    else if (what === "valide") {
      st.semestreValide = asBool(o.value);
      if (st.valOverride?.kind === "VALIDATION") {
        const mark = overrideMark(st.valOverride, o.value);
        if (mark) st.records.push(mark);
        st.semestreValide = st.valOverride.flag;
      }
    }
  }

  // ---- étape 8 : décision, mentions, valeurs d'affichage --------------------------------------------------------
  const s8: Array<StageItem<{ st: EnrollmentState; ue: UeState | null; e: EcueState | null; what: string }>> = [];
  states.forEach((st, i) => {
    if (st.semestreValide === null) return;
    if (st.moyenne !== null) {
      const enResit = st.ues.filter((u) => u.etat === "RESIT").length;
      s8.push({ owner: i, ruleKey: "decision_semestre", variables: { semestre_valide: st.semestreValide, ue_en_rattrapage: enResit }, tag: { st, ue: null, e: null, what: "decision" } });
    }
    s8.push({ owner: i, ruleKey: "mention_releve", variables: { moyenne: st.moyenne }, tag: { st, ue: null, e: null, what: "mention" } });
    s8.push({ owner: i, ruleKey: "appreciation_generale", variables: { moyenne: st.moyenne }, tag: { st, ue: null, e: null, what: "appreciation" } });
    s8.push({ owner: i, ruleKey: "distinction_semestre", variables: { moyenne: st.moyenne }, tag: { st, ue: null, e: null, what: "distinction" } });
    s8.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: st.moyenne }, tag: { st, ue: null, e: null, what: "display" } });
    for (const ue of st.ues) {
      s8.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: ue.moyenne }, tag: { st, ue, e: null, what: "display" } });
      for (const e of ue.ecues) s8.push({ owner: i, ruleKey: "arrondi_affichage", variables: { valeur: e.noteEcue }, tag: { st, ue, e, what: "display" } });
    }
  });
  for (const o of runner.batch(s8)) {
    const { st, ue, e, what } = o.tag;
    if (what === "display") {
      (e ?? ue ?? st).records.push(o.record);
      if (e) e.display = asString(o.value);
      else if (ue) ue.display = asString(o.value);
      else st.display = asString(o.value);
    } else {
      st.records.push(o.record);
      if (what === "decision") st.decision = asString(o.value);
      else if (what === "mention") st.mention = asString(o.value);
      else if (what === "appreciation") st.appreciation = asString(o.value);
      else if (what === "distinction") st.distinction = asString(o.value);
    }
  }

  // ---- étape 9 : rang (phase de cohorte, après le calcul de tous les inscrits) ----------------------------------
  const cohort = states.map((st, i) => ({ st, i })).filter(({ st, i }) => !runner.isFailed(i) && st.moyenne !== null);
  const cohortValues = cohort.map(({ st }) => st.moyenne);
  const s9: Array<StageItem<EnrollmentState>> = cohort.map(({ st, i }) => ({ owner: i, ruleKey: "rang", variables: { moyenne: st.moyenne, cohorte: cohortValues }, tag: st }));
  for (const o of runner.batch(s9)) {
    o.tag.records.push(o.record);
    o.tag.rank = o.value === null ? null : Number(o.value);
  }
  const cohortSize = cohortValues.length;

  // ---- assemblage -------------------------------------------------------------------------------------------
  const out: EnrollmentComputation[] = states.map((st, i) => {
    const failure = runner.failures.get(i) ?? null;
    const inputsHash = hashOf(st.inputs);
    if (failure) return { enrollmentId: st.ref.enrollmentId, studentId: st.ref.studentId, error: failure, inputsHash, inputs: st.inputs, header: null, lines: [], outputsHash: null };

    const lines: ComputedLine[] = [];
    let position = 0;
    const trace = (records: readonly TraceRecord[]): TraceRecord[] | null => (input.withTrace ? [...records] : null);
    for (const ue of st.ues) {
      for (const e of ue.ecues) {
        const sessionObtained = e.validee ? (e.vm ? 2 : ((e.sessionRetenue ?? 1) as 1 | 2)) : null;
        lines.push({
          level: "ECUE",
          curriculumNodeId: e.node.id,
          parentNodeId: ue.node.id,
          value: e.noteEcue,
          displayValue: e.display,
          credits: e.node.credits,
          coefficient: null,
          validated: e.validee,
          statusCode: e.statut,
          sessionObtained,
          resitEligible: e.eligible,
          rank: null,
          cohortSize: null,
          overridden: e.noteOverride?.kind === "VALUE" || e.vmOverride !== null,
          overrideId: e.noteOverride?.kind === "VALUE" ? e.noteOverride.id : (e.vmOverride?.id ?? null),
          outputs: { moyenne_devoirs: e.moyDevoirs, note_examen: e.noteExamen, note_s1: e.noteS1, note_s2: e.noteS2, eliminee: e.eliminee, validation_manuelle: e.vm, session_retenue: e.sessionRetenue },
          trace: trace(e.records),
          position: position++,
        });
      }
      lines.push({
        level: "UE",
        curriculumNodeId: ue.node.id,
        parentNodeId: null,
        value: ue.moyenne,
        displayValue: ue.display,
        credits: ue.credits,
        coefficient: null,
        validated: ue.validee,
        statusCode: ue.etat,
        sessionObtained: ue.sessionValidation === null ? null : (Number(ue.sessionValidation) as 1 | 2),
        resitEligible: null,
        rank: null,
        cohortSize: null,
        overridden: ue.moyOverride?.kind === "VALUE" || ue.valOverride?.kind === "VALIDATION",
        overrideId: ue.moyOverride?.kind === "VALUE" ? ue.moyOverride.id : ue.valOverride?.kind === "VALIDATION" ? ue.valOverride.id : null,
        outputs: { category: ue.node.category },
        trace: trace(ue.records),
        position: position++,
      });
    }
    lines.push({
      level: "PERIOD",
      curriculumNodeId: null,
      parentNodeId: null,
      value: st.moyenne,
      displayValue: st.display,
      credits: st.creditsTotal,
      coefficient: null,
      validated: st.semestreValide,
      statusCode: st.decision,
      sessionObtained: null,
      resitEligible: null,
      rank: st.rank,
      cohortSize: st.rank === null ? null : cohortSize,
      overridden: st.moyOverride?.kind === "VALUE" || st.valOverride?.kind === "VALIDATION",
      overrideId: st.moyOverride?.kind === "VALUE" ? st.moyOverride.id : st.valOverride?.kind === "VALIDATION" ? st.valOverride.id : null,
      outputs: { mention: st.mention, appreciation: st.appreciation, distinction: st.distinction, credits_valides: st.creditsValides },
      trace: trace(st.records),
      position: position++,
    });

    const header = {
      average: st.moyenne,
      averageDisplay: st.display,
      rank: st.rank,
      cohortSize: st.rank === null ? null : cohortSize,
      mentionCode: st.mention,
      decisionCode: st.decision,
      decisionOutcome: st.decision === null ? ("PENDING" as const) : outcomeOf(st.decision),
      creditsAcquired: st.creditsValides,
      creditsRequired: st.creditsTotal,
      validated: st.moyenne === null ? null : st.semestreValide,
      summary: { appreciation: st.appreciation, distinction: st.distinction, uesInResit: st.ues.filter((u) => u.etat === "RESIT").length, uesValidated: st.ues.filter((u) => u.validee === true).length, uesTotal: st.ues.length, pending: st.moyenne === null },
    };
    const outputsHash = hashOf({ header, lines: lines.map((l) => ({ ...l, trace: undefined })) });
    return { enrollmentId: st.ref.enrollmentId, studentId: st.ref.studentId, error: null, inputsHash, inputs: st.inputs, header, lines, outputsHash };
  });
  void canonicalJson;
  return { contractId: "credit-semester@1", enrollments: out };
}
