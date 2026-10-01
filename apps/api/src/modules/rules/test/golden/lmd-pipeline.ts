/**
 * Pipeline `credit-semester@1` côté TEST : ce que fera le module `results` (hors périmètre de `rules`) — construire les
 * contextes typés depuis les notes d'un scénario DÉCLARATIF (sans schéma legacy) et enchaîner les règles du RuleSet dans
 * l'ordre du contrat. AUCUNE formule, AUCUN seuil ici : tout passe par `RuleRunner.value/num/bool/str`.
 *
 * Le scénario est rejoué étape par étape (saisies de notes, validation du jury, session 2…), puis les sorties sont mises
 * sous la forme des observations du legacy (`observations.<label>.{ecueResults,ueResults,bulletins,fullBulletins,rosters}`)
 * pour être comparées aux snapshots de caractérisation.
 */
import type { GradeDecl, HigherSetup, ProgrammeDecl, Step, UeDecl } from "../../../../../../../tests/characterization/scenarios/types";
import type { RuleRunner } from "../support/runner";

interface Cell {
  devoirs: Array<{ note: number; bareme: number }>;
  exams: Array<{ session: number; note: number; bareme: number }>;
  manual: boolean;
  touched: boolean;
}

const key = (group: string, student: string, ecue: string): string => `${group}/${student}/${ecue}`;

const EMPTY_COMPUTATION = {
  moyenneDevoirs: null,
  noteS1: null,
  noteS2: null,
  noteExamen: null,
  sessionRetenue: 1,
  note: null,
  manual: false,
  hasS2: false,
} as const;

export interface EcueComputation {
  moyenneDevoirs: number | null;
  noteS1: number | null;
  noteS2: number | null;
  noteExamen: number | null;
  sessionRetenue: number;
  note: number | null;
  manual: boolean;
  hasS2: boolean;
}

export class LmdScenarioWorld {
  private readonly cells = new Map<string, Cell>();
  private readonly programmeOf = new Map<string, ProgrammeDecl>();

  constructor(
    private readonly rules: RuleRunner,
    readonly setup: HigherSetup,
  ) {
    for (const g of setup.groups) this.programmeOf.set(g.key, setup.programmes.find((p) => p.key === g.programme) as ProgrammeDecl);
    for (const grade of setup.grades) this.enter(grade);
  }

  private cell(group: string, student: string, ecue: string): Cell {
    const k = key(group, student, ecue);
    let c = this.cells.get(k);
    if (!c) {
      c = { devoirs: [], exams: [], manual: false, touched: false };
      this.cells.set(k, c);
    }
    return c;
  }

  /** Saisie d'une note ; refusée (comme par `assess`) hors de [0, barème]. */
  enter(grade: GradeDecl): boolean {
    const max = grade.max ?? 20;
    if (!(grade.value >= 0 && grade.value <= max)) return false;
    const c = this.cell(grade.group, grade.student, grade.ecue);
    c.touched = true;
    if (grade.nature === "devoir") c.devoirs.push({ note: grade.value, bareme: max });
    else c.exams.push({ session: grade.session ?? 1, note: grade.value, bareme: max });
    return true;
  }

  apply(step: Step): void {
    switch (step.do) {
      case "enter-grade":
        this.enter(step.grade);
        break;
      case "jury-validate": {
        const c = this.cell(step.group, step.student, step.ecue);
        c.manual = step.validated;
        c.touched = true;
        break;
      }
      case "update-grade": {
        const c = this.cell(step.group, step.student, step.ecue);
        const list = step.nature === "devoir" ? c.devoirs : c.exams;
        if (list.length > 0) (list[list.length - 1] as { note: number }).note = step.value;
        break;
      }
      case "delete-grade": {
        const c = this.cell(step.group, step.student, step.ecue);
        (step.nature === "devoir" ? c.devoirs : c.exams).pop();
        break;
      }
      default:
        break; // recompute, generate-bulletins, close-*, observe : sans effet sur les règles
    }
  }

  /* ------------------------------ ECUE ------------------------------ */

  ecue(group: string, student: string, ecue: string): EcueComputation | null {
    const c = this.cells.get(key(group, student, ecue));
    if (!c || !c.touched) return null;
    const r = this.rules;
    const moyenneDevoirs = r.num("moyenne_devoirs", { devoirs: c.devoirs.map((d) => ({ ...d, poids: 1 })) });
    const latest = (session: number): number | null => {
      const exams = c.exams.filter((e) => e.session === session);
      const e = exams[exams.length - 1];
      return e ? r.num("note_sur_20", { note: e.note, bareme: e.bareme }) : null;
    };
    const noteS1 = latest(1);
    const noteS2 = latest(2);
    const noteExamen = r.num("note_examen_retenue", { note_s1: noteS1, note_s2: noteS2 });
    const sessionRetenue = r.num("session_examen_retenue", { note_s1: noteS1, note_s2: noteS2 }) as number;
    const note = r.num("note_ecue", { moyenne_devoirs: moyenneDevoirs, note_examen: noteExamen });
    return { moyenneDevoirs, noteS1, noteS2, noteExamen, sessionRetenue, note, manual: c.manual, hasS2: noteS2 !== null };
  }

  /* ------------------------------ UE ------------------------------ */

  ueOf(group: string, student: string, ue: UeDecl) {
    const programme = this.programmeOf.get(group) as ProgrammeDecl;
    const r = this.rules;
    const creditsOf = (ecueKey: string): number => programme.ecues.find((e) => e.key === ecueKey)?.credits ?? 0;

    if (ue.conduct) {
      // Conduite : note unique /20 (saisie directe), exclue des résultats d'ECUE ; jamais repassable (resit_allowed = false).
      const ecueKey = ue.ecues[0] as string;
      const c = this.cells.get(key(group, student, ecueKey));
      const exam = c?.exams[c.exams.length - 1];
      if (!exam) return null;
      const note = r.num("note_ecue_directe", { note_examen: r.num("note_sur_20", { note: exam.note, bareme: exam.bareme }) });
      const validee = r.bool("ecue_validee", { note, validation_manuelle: false });
      return {
        ue,
        conduct: true as const,
        credits: creditsOf(ecueKey),
        moyenne: note,
        validee,
        etat: r.str("etat_ue", { validee, session2_tentee: true }),
        sessionValidation: r.num("session_validation_ue", { validee, sessions: validee ? [1] : [] }),
        motifs: [] as string[],
        ecues: [{ ecue: ecueKey, credits: creditsOf(ecueKey), computation: null as EcueComputation | null, note, validee, statut: validee ? "VALIDATED" : "INSUFFICIENT", sessionObtention: validee ? 1 : null, manual: false }],
      };
    }

    // Toute ECUE de l'UE figure au relevé d'un étudiant inscrit à la cohorte, notée ou non (note absente = UE incomplète).
    const rows = ue.ecues.map((ecueKey) => ({ ecueKey, comp: this.ecue(group, student, ecueKey) ?? EMPTY_COMPUTATION }));

    const lines = rows.map((x) => ({ note: x.comp.note, credits: creditsOf(x.ecueKey), validation_manuelle: x.comp.manual }));
    const moyenne = r.num("moyenne_ue", { ecues: lines });
    const validee = r.bool("ue_validee", { moyenne, ecues: lines });
    const session2Tentee = rows.some((x) => x.comp.hasS2);
    const ecues = rows.map((x, i) => {
      const line = lines[i] as (typeof lines)[number];
      const ecueValidee = r.bool("ecue_validee", { note: line.note, validation_manuelle: line.validation_manuelle });
      const autoValide = r.bool("ecue_validee", { note: line.note, validation_manuelle: false });
      return {
        ecue: x.ecueKey,
        credits: line.credits,
        computation: x.comp,
        note: line.note,
        validee: ecueValidee,
        statut: r.str("statut_ecue", { note: line.note, ue_validee: validee }),
        // Session d'obtention : au mérite -> session de l'examen retenu ; par le jury seul -> 2.
        sessionObtention: ecueValidee ? (autoValide ? x.comp.sessionRetenue : 2) : null,
        manual: x.comp.manual,
      };
    });
    const obtained = ecues.map((e) => e.sessionObtention).filter((s): s is number => s !== null);
    const sessions = obtained.length > 0 ? obtained : [rows.some((x) => x.comp.manual) ? 2 : 1];
    const motifs: string[] = [];
    if (lines.some((l) => r.bool("ecue_eliminee", { note: l.note, validation_manuelle: l.validation_manuelle }) && !r.bool("ecue_validee", { note: l.note, validation_manuelle: l.validation_manuelle }))) motifs.push("NOTE_ELIMINATOIRE");
    if (!r.bool("ecue_validee", { note: moyenne, validation_manuelle: false })) motifs.push("MOYENNE_INSUFFISANTE");
    if (lines.some((l) => l.note === null)) motifs.push("INCOMPLET");
    return {
      ue,
      conduct: false as const,
      credits: r.num("credits_ue", { ecues: lines }) as number,
      moyenne,
      validee,
      etat: r.str("etat_ue", { validee, session2_tentee: session2Tentee }),
      sessionValidation: r.num("session_validation_ue", { validee, sessions }),
      motifs,
      ecues,
    };
  }

  /* ------------------------------ semestre ------------------------------ */

  semester(group: string, student: string, semesterKey: string) {
    const programme = this.programmeOf.get(group) as ProgrammeDecl;
    const semester = programme.semesters.find((s) => s.key === semesterKey);
    if (!semester) throw new Error(`Semestre inconnu : ${semesterKey}`);
    const r = this.rules;
    const ues = semester.ues
      .map((k) => programme.ues.find((u) => u.key === k) as UeDecl)
      .map((ue) => this.ueOf(group, student, ue))
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const ponds = ues.map((u) => ({ moyenne: u.moyenne, credits: u.credits, validee: u.validee }));
    const moyenneSession = ues.length > 0 ? r.num("moyenne_session", { ues: ponds }) : null;
    const semestreValide = ues.length > 0 && r.bool("semestre_valide", { ues: ponds.map((p) => ({ validee: p.validee, credits: p.credits })) });
    const enRattrapage = ues.filter((u) => u.etat === "RESIT").length;
    const decision = r.str("decision_semestre", { semestre_valide: semestreValide, ue_en_rattrapage: enRattrapage });
    return {
      ues,
      moyenneSession,
      creditsValides: r.num("credits_valides", { ues: ponds }) as number,
      creditsTotal: r.num("credits_total", { ues: ponds }) as number,
      semestreValide,
      decision,
      enRattrapage,
    };
  }

  /** Un résultat d'ECUE existe-t-il (au moins une note ou une validation du jury) ? */
  hasResult(group: string, student: string, ecue: string): boolean {
    return this.ecue(group, student, ecue) !== null;
  }

  /** Le legacy n'émet ni bulletin consultable ni bulletin généré tant qu'une UE reste « à repasser ». */
  bulletinUnavailable(sem: ReturnType<LmdScenarioWorld["semester"]>): boolean {
    return sem.enRattrapage > 0;
  }
}
