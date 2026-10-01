/**
 * ADAPTATEUR DE PARITÉ — pile « classique » (matières à coefficients, moyennes par matière SAISIES).
 *
 * Traductions :
 *   - classe × période → (classe, période) de `results` ; matière → nœud `SUBJECT` (coefficient décimal exact en chaîne, section = type de bilan) ;
 *     toutes les matières du programme figurent dans chaque classe (une matière sans note est « en attente », sans effet sur la moyenne) ;
 *   - une moyenne de période SAISIE → UNE note publiée de barème 20 (la règle `moyenne_matiere` la restitue telle quelle) ;
 *   - rôle sémantique de la période (`first-semester` / `second-semester`) → rang dans l'année, `isSecondSemester` et `firstPeriodId`
 *     (jamais le NOM de la période, contrairement au legacy : défaut catalogué `CLASSIC_SEMESTER_DETECTED_BY_NAME`) ;
 *   - classe de 2ᵉ année de BTS (`finalYearBts`) → `terminalExamRequired` ; niveau « BTS » → jeu CI-HIGHER-BTS ;
 *   - `put-matrix` : la requête est refusée en bloc (élève hors classe, moyenne > 20, heures justifiées > absences) comme dans le legacy ;
 *     `value: null` efface la moyenne ; les heures d'absence n'ont pas de calcul (présentation du bulletin, hors `results`).
 *
 * Projection vers le document de bulletin du legacy (`steps.<étape>.documents.<élève>`) : libellés pris dans les `labelMap` du JEU DE
 * RÈGLES épinglé (aucun libellé en dur ici) ; valeurs exactes converties en nombres (la tolérance de `compareWithTolerance` absorbe le
 * bruit du double du legacy sans masquer un écart de seuil : les bogues flottants sont dans le catalogue).
 *
 * Champs NON comparés, car hors du périmètre calculé par `results` : appréciation par matière / par section (présentation, règle
 * `mention` appliquée par `reportcards`), cumuls `totalCoef` / `weightedTotal` (sommes d'affichage), `attendanceSummary`, identité de l'élève.
 * En 1ᵉʳ semestre, le legacy affiche aussi des verdicts « de fin d'année » calculés sur la moyenne du semestre ; le contrat à coefficients
 * ne les produit qu'au 2ᵉ semestre (spec 012) : ces champs ne sont comparés qu'au 2ᵉ semestre.
 */
import type { Scenario, ClassicStep } from "../../../../../../../tests/characterization/scenarios/types";
import { unwrap } from "@ecoledigitale/kernel";
import { newId } from "@ecoledigitale/kernel";
import { computePeriod } from "../../application/compute";
import { getClassMatrix, type ClassMatrix } from "../../application/reads";
import type { ClassStructure, EnrollmentRef, GradeFact, PeriodFacts, StructureNode } from "../../domain/types";
import { CAPS_ALL, type World } from "../support/world";
import { toNumber } from "./decimal";

type Obj = Record<string, any>;

interface ClassPeriod {
  classKey: string;
  periodKey: string;
  classroomId: string;
  period: PeriodFacts;
  structure: ClassStructure;
}

interface Entered {
  seq: number;
  class: string;
  student: string;
  course: string;
  period: string;
  value: number;
}

export class ClassicParity {
  readonly students = new Map<string, string>();
  readonly enrollments = new Map<string, EnrollmentRef>();
  readonly nodeIds = new Map<string, string>();
  readonly worlds: ClassPeriod[] = [];
  readonly entered: Entered[] = [];
  readonly steps: Record<string, Obj> = {};
  readonly refusals: Array<[string, string]> = [];
  private seq = 0;
  private readonly labels = new Map<string, Map<string, string>>();

  constructor(
    private readonly w: World,
    private readonly scenario: Scenario,
    options: { levelCode?: string } = {},
  ) {
    const { setup } = scenario.classic!;
    for (const s of scenario.students) this.students.set(s.key, newId());
    for (const a of setup.averages) this.entered.push({ seq: this.seq++, ...a });
    const yearId = newId();
    const periods = new Map<string, PeriodFacts>();
    setup.periods.forEach((p, index) => periods.set(p.key, { id: newId(), rankInYear: index + 1, countInYear: setup.periods.length, isSecondSemester: p.role === "second-semester", startsOn: p.start, endsOn: p.end }));
    const firstPeriod = setup.periods.find((p) => p.role === "first-semester");
    for (const cls of setup.classes) {
      const classroomId = newId();
      for (const st of cls.students) {
        const ref = { enrollmentId: newId(), studentId: this.students.get(st) ?? newId() };
        if (!this.students.has(st)) this.students.set(st, ref.studentId);
        this.enrollments.set(`${cls.key}/${st}`, ref);
        w.roster.entries.push({ ...ref, active: true, classroomId });
      }
      for (const c of setup.courses) this.nodeIds.set(`${cls.key}/${c.key}`, newId());
      for (const p of setup.periods) {
        const period = periods.get(p.key) as PeriodFacts;
        const nodes: StructureNode[] = setup.courses.map((c, i) => ({
          id: this.nodeIds.get(`${cls.key}/${c.key}`) as string,
          parentId: null,
          kind: "SUBJECT",
          code: c.code,
          label: c.name,
          ordinal: i,
          credits: null,
          coefficient: String(c.coefficient),
          gradingMode: "COMPOSED",
          resitAllowed: false,
          countsInAverage: true,
          sectionKey: c.section ?? null,
          category: null,
        }));
        const structure: ClassStructure = {
          classroomId,
          academicYearId: yearId,
          ...(options.levelCode ? { levelCode: options.levelCode } : {}),
          contractId: "coef-semester@1",
          period,
          firstPeriodId: p.role === "second-semester" && firstPeriod ? (periods.get(firstPeriod.key) as PeriodFacts).id : null,
          terminalExamRequired: cls.finalYearBts === true,
          nodes,
          yearPeriods: setup.periods.map((x) => periods.get(x.key) as PeriodFacts),
        };
        w.curriculum.set(structure);
        this.worlds.push({ classKey: cls.key, periodKey: p.key, classroomId, period, structure });
      }
    }
    // la période de référence (1ᵉʳ semestre) est calculée avant les autres
    const first = new Set(setup.periods.filter((p) => p.role === "first-semester").map((p) => p.key));
    this.worlds.sort((a, b) => Number(first.has(b.periodKey)) - Number(first.has(a.periodKey)));
  }

  private factsOf(cp: ClassPeriod): GradeFact[] {
    return this.entered
      .filter((e) => e.class === cp.classKey && e.period === cp.periodKey)
      .map((e) => ({
        gradeId: `00000000-0000-7000-8000-${String(e.seq).padStart(12, "0")}`,
        assessmentId: `a0000000-0000-7000-8000-${String(e.seq).padStart(12, "0")}`,
        enrollmentId: (this.enrollments.get(`${e.class}/${e.student}`) as EnrollmentRef).enrollmentId,
        curriculumNodeId: this.nodeIds.get(`${e.class}/${e.course}`) as string,
        sessionNo: 1 as const,
        assessedOn: "2025-12-01",
        aggregationGroup: "CONTINUOUS",
        scaleMax: "20",
        weight: "1",
        score: String(e.value),
        entryStatus: "ENTERED" as const,
      }));
  }

  async computeAll(): Promise<void> {
    for (const cp of this.worlds) {
      this.w.assess.grades = this.factsOf(cp);
      unwrap(await computePeriod(this.w.deps, this.w.director, { classroomId: cp.classroomId, academicPeriodId: cp.period.id }));
    }
  }

  async play(): Promise<void> {
    let n = 0;
    for (const step of this.scenario.classic!.steps) {
      n++;
      const label = `${String(n).padStart(2, "0")}-${step.label}`;
      if (step.do === "report") this.steps[label] = await this.report(step);
      else if (step.do === "put-matrix") this.putMatrix(step);
    }
  }

  private putMatrix(step: Extract<ClassicStep, { do: "put-matrix" }>): void {
    const cls = this.scenario.classic!.setup.classes.find((c) => c.key === step.class)!;
    for (const c of step.cells) {
      if (!cls.students.includes(c.student)) return void this.refusals.push([step.label, "élève non inscrit dans la classe"]);
      if (c.value !== null && (c.value < 0 || c.value > 20)) return void this.refusals.push([step.label, "moyenne hors [0, 20]"]);
    }
    for (const a of step.absences ?? []) {
      if ((a.justifiedHours ?? 0) > (a.absenceHours ?? 0)) return void this.refusals.push([step.label, "heures justifiées > absences"]);
    }
    for (const c of step.cells) {
      const i = this.entered.findIndex((e) => e.class === step.class && e.student === c.student && e.course === c.course && e.period === step.period);
      if (i >= 0) this.entered.splice(i, 1);
      if (c.value !== null) this.entered.push({ seq: this.seq++, class: step.class, student: c.student, course: c.course, period: step.period, value: c.value });
    }
  }

  /** Libellé français d'un code, tiré du `labelMap` de la règle dans la version de jeu épinglée. */
  private async labelOf(ruleVersionId: string, ruleKey: string, code: string | null): Promise<string> {
    if (code === null) return "";
    let map = this.labels.get(ruleVersionId);
    if (!map) {
      const compiled = unwrap(await this.w.rulesApi.loadVersion(this.w.director, ruleVersionId));
      map = new Map();
      for (const r of compiled.rules) for (const [c, v] of Object.entries(r.labelMap ?? {})) map.set(`${r.key}/${c}`, (v as { fr?: string }).fr ?? "");
      this.labels.set(ruleVersionId, map);
    }
    const label = map.get(`${ruleKey}/${code}`);
    if (label === undefined) throw new Error(`libellé introuvable : ${ruleKey}/${code}`);
    return label;
  }

  private async report(step: Extract<ClassicStep, { do: "report" }>): Promise<Obj> {
    await this.computeAll();
    const { setup } = this.scenario.classic!;
    const cp = this.worlds.find((x) => x.classKey === step.class && x.periodKey === step.period) as ClassPeriod;
    const matrix: ClassMatrix = unwrap(await getClassMatrix(this.w.deps, this.w.director, { classroomId: cp.classroomId, academicPeriodId: cp.period.id, withLines: true, caps: CAPS_ALL }));
    const second = cp.period.isSecondSemester;
    const cls = setup.classes.find((c) => c.key === step.class)!;
    const sectionOrder = [...new Set(setup.courses.map((c) => c.section ?? ""))];
    const documents: Obj = {};
    for (const student of step.student ? [step.student] : [...cls.students].sort()) {
      const enrollment = this.enrollments.get(`${step.class}/${student}`) as EnrollmentRef;
      const row = matrix.rows.find((r) => r.header.enrollmentId === enrollment.enrollmentId);
      if (!row) continue;
      const h = row.header;
      const period = row.lines.find((l) => l.level === "PERIOD");
      const year = row.lines.find((l) => l.level === "YEAR");
      const sections = (period?.outputs.sections ?? {}) as Record<string, { value: string | null; rank: number | null }>;
      documents[student] = {
        sections: sectionOrder.map((name) => ({
          bilanTypeName: name,
          average: toNumber(sections[name]?.value),
          rank: sections[name]?.rank ?? null,
          lines: setup.courses
            .filter((c) => (c.section ?? "") === name)
            .map((c) => {
              const l = row.lines.find((x) => x.level === "SUBJECT" && x.curriculumNodeId === this.nodeIds.get(`${step.class}/${c.key}`));
              return { courseCode: c.code, coef: toNumber(l?.coefficient), average: toNumber(l?.value), rank: l?.rank ?? null };
            }),
        })),
        summary: {
          overallAverage: toNumber(h.average),
          rank: h.rank,
          totalStudents: (h.summary as Obj).classSize ?? null,
          mention: await this.labelOf(h.ruleVersionId, "mention", h.mentionCode),
          decision: await this.labelOf(h.ruleVersionId, "decision_conseil", h.decisionCode),
          ...(second
            ? {
                annualAverage: toNumber(year?.value),
                annualRank: year?.rank ?? null,
                councilAppreciation: await this.labelOf(h.ruleVersionId, "appreciation_conseil", (year?.outputs.appreciation as string | null) ?? null),
                distinctionSanctions: await this.labelOf(h.ruleVersionId, "distinction", (year?.outputs.distinction as string | null) ?? null),
                endYearDecision: await this.labelOf(h.ruleVersionId, "decision_fin_annee", year?.statusCode ?? null),
                firstSemesterAverage: toNumber((year?.outputs.s1 as string | null) ?? null),
                secondSemesterAverage: toNumber(h.average),
                repeating: year?.statusCode === "REPEAT",
              }
            : {}),
        },
      };
    }
    return { documents };
  }
}

/** Sous-ensemble comparable du document du legacy (mêmes champs que la projection ci-dessus, selon le semestre). */
export function pickLegacyStep(step: Obj, secondOf: (docPeriodName: string) => boolean): Obj | null {
  if (!step || !step.documents) return null;
  const out: Obj = { documents: {} };
  for (const [student, d] of Object.entries<Obj>(step.documents)) {
    const second = secondOf(d.periodName);
    const s = d.summary;
    out.documents[student] = {
      sections: d.sections.map((sec: Obj) => ({
        bilanTypeName: sec.bilanTypeName,
        average: sec.average,
        rank: sec.rank,
        lines: sec.lines.map((l: Obj) => ({ courseCode: l.courseCode, coef: l.coef, average: l.average, rank: l.rank })),
      })),
      summary: {
        overallAverage: s.overallAverage,
        rank: s.rank,
        totalStudents: s.totalStudents,
        mention: s.mention,
        decision: s.decision,
        ...(second
          ? {
              annualAverage: s.annualAverage,
              annualRank: s.annualRank,
              councilAppreciation: s.councilAppreciation,
              distinctionSanctions: s.distinctionSanctions,
              endYearDecision: s.endYearDecision,
              firstSemesterAverage: s.firstSemesterAverage,
              secondSemesterAverage: s.secondSemesterAverage,
              repeating: s.repeating,
            }
          : {}),
      },
    };
  }
  return out;
}
