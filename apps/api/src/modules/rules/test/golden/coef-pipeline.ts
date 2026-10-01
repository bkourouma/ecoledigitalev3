/**
 * Pipeline `coef-semester@1` côté TEST (ce que fera `results` pour la pile classique) : construit les contextes typés depuis les
 * moyennes saisies d'un scénario DÉCLARATIF et enchaîne les règles du RuleSet (moyennes pondérées, mention, décision du conseil,
 * moyenne annuelle, décision de fin d'année, distinction, appréciation, rangs). Aucune formule ni aucun seuil ici.
 *
 * Le « deuxième semestre » vient du RÔLE de la période et « examen terminal requis » de l'attribut de la classe : jamais d'un nom
 * (défauts CLASSIC_SEMESTER_DETECTED_BY_NAME et isSecondYearBtsClass du legacy, non reproduits).
 */
import type { ClassicSetup, ClassicStep } from "../../../../../../../tests/characterization/scenarios/types";
import type { RuleRunner } from "../support/runner";

type Averages = Map<string, number>; // `${class}|${student}|${course}|${period}`

const k = (cls: string, student: string, course: string, period: string): string => `${cls}|${student}|${course}|${period}`;

export class ClassicScenarioWorld {
  private readonly averages: Averages = new Map();

  constructor(
    private readonly rules: RuleRunner,
    readonly setup: ClassicSetup,
  ) {
    for (const a of setup.averages) this.averages.set(k(a.class, a.student, a.course, a.period), a.value);
  }

  /** Saisie de la matrice : refusée en bloc (400 du legacy) si une valeur sort de [0, 20], un élève est étranger à la classe ou les heures sont incohérentes. */
  putMatrix(step: Extract<ClassicStep, { do: "put-matrix" }>): boolean {
    const cls = this.setup.classes.find((c) => c.key === step.class);
    if (!cls) return false;
    for (const cell of step.cells) {
      if (!cls.students.includes(cell.student)) return false;
      if (cell.value !== null && !(cell.value >= 0 && cell.value <= 20)) return false;
    }
    for (const a of step.absences ?? []) {
      if (a.absenceHours !== null && a.justifiedHours !== null && a.justifiedHours > a.absenceHours) return false;
    }
    for (const cell of step.cells) {
      if (cell.value === null) this.averages.delete(k(step.class, cell.student, cell.course, step.period));
      else this.averages.set(k(step.class, cell.student, cell.course, step.period), cell.value);
    }
    return true;
  }

  private average(cls: string, student: string, course: string, period: string): number | null {
    return this.averages.get(k(cls, student, course, period)) ?? null;
  }

  private overall(cls: string, student: string, period: string): number | null {
    const matieres = this.setup.courses.map((c) => ({ score: this.average(cls, student, c.key, period), coef: c.coefficient }));
    return this.rules.num("moyenne_ponderee", { matieres });
  }

  private firstSemesterKey(): string | null {
    return this.setup.periods.find((p) => p.role === "first-semester")?.key ?? null;
  }

  /** Documents de bulletin (un par élève) de la classe `cls` pour la période `period`. */
  documents(cls: string, period: string, only?: string): Record<string, unknown> {
    const r = this.rules;
    const klass = this.setup.classes.find((c) => c.key === cls)!;
    const periodDecl = this.setup.periods.find((p) => p.key === period)!;
    const isSecond = periodDecl.role === "second-semester";
    const first = this.firstSemesterKey();
    const sections = [...new Set(this.setup.courses.map((c) => c.section ?? "Sans type de bilan"))];

    const cohort = (fn: (student: string) => number | null): Array<number | null> => klass.students.map(fn);
    const overallOf = (s: string): number | null => this.overall(cls, s, period);
    const firstOf = (s: string): number | null => (isSecond && first ? this.overall(cls, s, first) : null);
    const annualOf = (s: string): number | null => r.num("moyenne_annuelle", { s1: firstOf(s), s2: overallOf(s), second_semestre: isSecond });
    const overallCohort = cohort(overallOf);
    const annualCohort = cohort(annualOf);

    const documents: Record<string, unknown> = {};
    for (const student of only ? [only] : klass.students) {
      const sectionDocs = sections.map((name) => {
        const courses = this.setup.courses.filter((c) => (c.section ?? "Sans type de bilan") === name);
        const matieres = courses.map((c) => ({ score: this.average(cls, student, c.key, period), coef: c.coefficient }));
        const average = r.num("moyenne_section", { matieres });
        const sectionCohort = cohort((s) => r.num("moyenne_section", { matieres: courses.map((c) => ({ score: this.average(cls, s, c.key, period), coef: c.coefficient })) }));
        return {
          bilanTypeName: name,
          average,
          appreciation: r.label("mention", r.str("mention", { moyenne: average })),
          rank: r.num("rang", { moyenne: average, cohorte: sectionCohort }),
          lines: courses.map((c) => {
            const avg = this.average(cls, student, c.key, period);
            return {
              courseCode: c.code,
              coef: c.coefficient,
              average: avg,
              appreciation: r.label("mention", r.str("mention", { moyenne: avg })),
              rank: r.num("rang", { moyenne: avg, cohorte: cohort((s) => this.average(cls, s, c.key, period)) }),
            };
          }),
        };
      });

      const overall = overallOf(student);
      const annual = annualOf(student);
      const endCode = r.str("decision_fin_annee", { moyenne: annual, second_semestre: isSecond, examen_terminal_requis: klass.finalYearBts === true });
      documents[student] = {
        sections: sectionDocs,
        summary: {
          overallAverage: overall,
          mention: r.label("mention", r.str("mention", { moyenne: overall })),
          decision: r.label("decision_conseil", r.str("decision_conseil", { moyenne: overall })),
          rank: r.num("rang", { moyenne: overall, cohorte: overallCohort }),
          firstSemesterAverage: firstOf(student),
          secondSemesterAverage: overall,
          annualAverage: annual,
          annualRank: r.num("rang", { moyenne: annual, cohorte: annualCohort }),
          councilAppreciation: r.label("appreciation_conseil", r.str("appreciation_conseil", { moyenne: annual })),
          distinctionSanctions: r.label("distinction", r.str("distinction", { moyenne: annual })),
          endYearDecision: r.label("decision_fin_annee", endCode),
          // L'indicateur « redoublant / affecté » se déduit du CODE de décision, jamais d'un libellé.
          repeating: endCode === "REPEAT",
          affected: endCode === "PROMOTED",
          totalStudents: klass.students.length,
        },
      };
    }
    return documents;
  }
}
