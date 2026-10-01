import {
  evaluerUe,
  moyenneDevoirs,
  noteEcue,
  normaliserNote,
  peutPasserAnneeSuperieure,
  semestreValide,
  type EcueInput,
} from "../../../apps/api/src/services/bulletin-calc";
import type { GradeDecl, Scenario } from "../scenarios/types";
import type { DefectCollector } from "./defects";
import { Rat, shortestDecimal, weightedMean } from "./exact";
import type { SeedContext } from "./seeder";

/**
 * ORACLE de la pile Professional : recalcule en arithmétique exacte (rationnels) ce que les règles DOCUMENTÉES
 * imposent, à partir des seules notes déclarées dans le scénario, puis compare aux valeurs persistées/observées
 * pour repérer les bogues du legacy (voir defects.ts). L'oracle ne lit AUCUNE valeur produite par le legacy pour
 * calculer la valeur attendue ; il ne s'en sert que pour la comparaison.
 */

export interface HigherDetectionInput {
  scenario: Scenario;
  ctx: SeedContext;
  /** Préfixe de chemin de l'observation analysée (ex. `observations.final`). */
  observationKey: string;
  observation: Record<string, any>;
  /** Notes réellement appliquées à la fin (déclarées + saisies par les étapes qui ont abouti). */
  grades?: GradeDecl[];
}

interface ExactEcue {
  /** Note exacte devoirs×0,4 + examen×0,6, ou `null` sans examen. */
  note: Rat | null;
  floatDevoirs: number[];
  floatExam: number | null;
  /** Note recalculée en flottant sur les valeurs EXACTES (ce que `recomputeEcueResult` décide). */
  floatNote: number | null;
  /** Entrées arrondies à 2 décimales telles que relues en base (ce que bulletin et validation d'UE recalculent). */
  roundedDevoirs: number | null;
  roundedExam: number | null;
}

const TEN = Rat.of(10);
const FIVE = Rat.of(5);
const WEIGHT_DEV = Rat.of("0.4");
const WEIGHT_EXAM = Rat.of("0.6");

function rat(value: number, max: number): Rat {
  return Rat.of(value).div(max).mul(20);
}

/** Valeur numeric(6,2) relue : le float passe en texte, PostgreSQL arrondit demi-supérieur à 2 décimales. */
function storedTwoDecimals(x: number | null): number | null {
  if (x === null) return null;
  return Number(Rat.of(shortestDecimal(x)).toFixedHalfUp(2));
}

export function exactEcueFor(grades: GradeDecl[], group: string, student: string, ecue: string): ExactEcue {
  const mine = grades.filter((g) => g.group === group && g.student === student && g.ecue === ecue);
  const devoirs = mine.filter((g) => g.nature === "devoir");
  // Même sélection que computeEcueBreakdown : examen manuel de session la plus haute, sinon dernier examen d'évaluation noté.
  const manualExams = mine.filter((g) => g.nature === "examen" && (g.via ?? "manual") === "manual");
  const assessmentExams = mine.filter((g) => g.nature === "examen" && g.via === "assessment");
  const exam =
    manualExams.length > 0
      ? manualExams.reduce((best, g) => ((g.session ?? 1) >= (best.session ?? 1) ? g : best))
      : assessmentExams.length > 0
        ? assessmentExams[assessmentExams.length - 1]
        : null;

  const floatDevoirs = devoirs.map((g) => normaliserNote(g.value, g.max ?? 20));
  const floatExam = exam ? normaliserNote(exam.value, exam.max ?? 20) : null;
  const meanFloat = moyenneDevoirs(floatDevoirs);
  const floatNote = noteEcue(meanFloat, floatExam);

  let note: Rat | null = null;
  if (exam) {
    const mean = devoirs.length
      ? devoirs.map((g) => rat(g.value, g.max ?? 20)).reduce((a, b) => a.add(b)).div(devoirs.length)
      : Rat.of(0);
    note = mean.mul(WEIGHT_DEV).add(rat(exam.value, exam.max ?? 20).mul(WEIGHT_EXAM));
  }
  return {
    note,
    floatDevoirs,
    floatExam,
    floatNote,
    roundedDevoirs: storedTwoDecimals(meanFloat),
    roundedExam: storedTwoDecimals(floatExam),
  };
}

type Pattern = string;

/** Sous-arbres de snapshot que la perte/le gain de validation d'un étudiant peut légitimement faire bouger. */
function scopeFor(obs: string, semesters: string[], student: string, cohorts: string[]): Pattern[] {
  const scope: Pattern[] = [
    "steps.**",
    `${obs}.ueResults.${student}.**`,
    `${obs}.studentRattrapages.${student}.**`,
    `${obs}.conduite.**`,
  ];
  for (const c of cohorts) scope.push(`${obs}.ecueResults.${c}.${student}/*.**`);
  for (const sem of semesters) {
    scope.push(
      `${obs}.bulletins.${sem}.${student}.**`,
      `${obs}.bts.${sem}.${student}.**`,
      `${obs}.rosters.${sem}.students.${student}.**`,
      `${obs}.fullBulletins.${sem}.${student}.**`,
      `${obs}.generated.${sem}.${student}.**`,
      `${obs}.rattrapages.${sem}.${student}/*.**`,
      // rang des autres étudiants de la promotion : leur classement dépend de la moyenne de celui-ci
      `${obs}.bulletins.${sem}.*.data.rang`,
      `${obs}.fullBulletins.${sem}.*.rang`,
      `${obs}.rosters.${sem}.students.*.moyenne_session`,
      `${obs}.bts.${sem}.*.data.rang`,
      `${obs}.bts.${sem}.*.data.disciplines.**`,
      `${obs}.bts.${sem}.*.data.savoir_etre.**`,
      `${obs}.bts.${sem}.*.data.annuel.**`,
    );
  }
  return scope;
}

export function detectHigherDefects(defects: DefectCollector, input: HigherDetectionInput): void {
  const { scenario, ctx, observationKey: obs, observation } = input;
  const setup = scenario.higher!.higher;
  const grades = input.grades ?? setup.grades;

  for (const group of setup.groups) {
    const programme = setup.programmes.find((p) => p.key === group.programme)!;
    const semestersOfUe = (ueKey: string) => programme.semesters.filter((s) => s.ues.includes(ueKey)).map((s) => s.key);
    const ecueByKey = new Map(programme.ecues.map((e) => [e.key, e]));

    for (const student of group.students) {
      for (const ue of programme.ues) {
        if (ue.conduct) continue;
        const cohortKey = `${group.key}:${ue.key}`;
        const rows = observation.ecueResults?.[cohortKey] as Record<string, any> | undefined;
        if (!rows) continue;
        const sems = semestersOfUe(ue.key);
        const cohorts = programme.ues.map((u) => `${group.key}:${u.key}`);
        const scope = scopeFor(obs, sems, student, cohorts);
        let ecueLevelDefect = false;

        const exacts = ue.ecues.map((ek) => ({ ek, ecue: ecueByKey.get(ek)!, row: rows[`${student}/${ek}`], exact: exactEcueFor(grades, group.key, student, ek) }));

        for (const { ek, row, exact } of exacts) {
          if (!row || exact.note === null) continue;
          const rowPath = `${obs}.ecueResults.${cohortKey}.${student}/${ek}`;

          // Session 2 plus basse que la session 1 : le legacy retient quand même la session 2.
          const exams = grades.filter(
            (g) => g.group === group.key && g.student === student && g.ecue === ek && g.nature === "examen" && (g.via ?? "manual") === "manual",
          );
          const s1 = exams.find((g) => (g.session ?? 1) === 1);
          const s2 = exams.find((g) => g.session === 2);
          if (s1 && s2 && Rat.of(s2.value).div(s2.max ?? 20).lt(Rat.of(s1.value).div(s1.max ?? 20))) {
            defects.flag("SESSION2_REPLACES_EVEN_IF_LOWER", `${rowPath}.note_examen`, row.note_examen, "à arbitrer (règle métier non écrite)", {
              scope,
              note: `examen session 1 = ${s1.value}/${s1.max ?? 20}, session 2 = ${s2.value}/${s2.max ?? 20} ; le legacy retient la session 2`,
            });
          }
          if (!row.validee_manuellement) {
            const exactValid = exact.note.gte(TEN);
            if (row.validee !== exactValid) {
              ecueLevelDefect = true;
              defects.flag("FLOAT_ECUE_VALIDATION_10", `${rowPath}.validee`, row.validee, exactValid, {
                scope,
                note: `note exacte ${exact.note.toString()} ; flottant ${exact.floatNote}`,
              });
            }
          }
          const exactElim = exact.note.lt(FIVE);
          if (row.eliminee !== exactElim) {
            ecueLevelDefect = true;
            defects.flag("FLOAT_ECUE_ELIMINATOIRE_5", `${rowPath}.eliminee`, row.eliminee, exactElim, {
              scope,
              note: `note exacte ${exact.note.toString()} ; flottant ${exact.floatNote}`,
            });
          }
        }

        // UE : validée selon l'oracle (moyenne pondérée exacte >= 10, aucune ECUE éliminatoire non validée par le jury, UE complète).
        const ueRows = (observation.ueResults?.[student] as any[] | undefined) ?? [];
        const ueIdx = ueRows.findIndex((r) => r.ue_code === ue.code);
        if (ueIdx < 0) continue;
        const incomplete = exacts.some((x) => x.exact.note === null);
        const eliminated = exacts.some((x) => x.exact.note !== null && x.exact.note.lt(FIVE) && !(x.row?.validee_manuellement === true));
        const mean = incomplete && exacts.every((x) => x.exact.note === null)
          ? null
          : weightedMean(exacts.filter((x) => x.exact.note !== null).map((x) => ({ value: x.exact.note!, weight: Math.max(x.ecue.credits ?? 0, 0) })));
        const exactUeValid = !incomplete && mean !== null && mean.gte(TEN) && !eliminated;
        const legacyUeValid = ueRows[ueIdx].statut === "validee";
        if (legacyUeValid !== exactUeValid && !ecueLevelDefect) {
          // Cause : flottant sur les valeurs exactes, ou arrondi à 2 décimales des entrées relues en base ?
          const floatInputs: EcueInput[] = exacts.map((x) => ({
            moyenneDevoirs: x.exact.floatDevoirs.length ? moyenneDevoirs(x.exact.floatDevoirs) : null,
            noteExamen: x.exact.floatExam,
            credits: x.ecue.credits ?? 0,
            validationManuelle: x.row?.validee_manuellement === true,
          }));
          const roundedInputs: EcueInput[] = exacts.map((x) => ({
            moyenneDevoirs: x.exact.roundedDevoirs,
            noteExamen: x.exact.roundedExam,
            credits: x.ecue.credits ?? 0,
            validationManuelle: x.row?.validee_manuellement === true,
          }));
          const floatValid = evaluerUe(floatInputs).validee;
          const roundedValid = evaluerUe(roundedInputs).validee;
          const path = `${obs}.ueResults.${student}[${ueIdx}].statut`;
          const legacyStatut = ueRows[ueIdx].statut;
          const correctStatut = exactUeValid ? "validee" : "echec|en_cours";
          if (floatValid !== exactUeValid) {
            defects.flag("FLOAT_UE_VALIDATION_10", path, legacyStatut, correctStatut, {
              scope,
              note: `moyenne UE exacte ${mean?.toString() ?? "n/a"}`,
            });
          } else if (roundedValid !== exactUeValid) {
            defects.flag("ROUNDED_INPUTS_ECUE_RECOMPUTE", path, legacyStatut, correctStatut, {
              scope,
              note: `moyenne UE exacte ${mean?.toString() ?? "n/a"} ; valeurs relues arrondies à 2 décimales`,
            });
          } else {
            throw new Error(`Écart UE inexpliqué pour ${student}/${ue.key} (legacy ${legacyStatut}, exact ${exactUeValid})`);
          }
        }
      }
    }
  }

  // Règles « mortes » : la fonction pure semestreValide (20 crédits) contredit la décision du bulletin (toutes les UE validées).
  for (const [semKey, perStudent] of Object.entries(observation.bulletins ?? {})) {
    for (const [student, res] of Object.entries(perStudent as Record<string, any>)) {
      if (!res.ok) continue;
      const b = res.data;
      if (semestreValide(b.credits_valides) !== b.semestre_valide) {
        defects.flag(
          "RULES_NOT_WIRED_SEMESTER_20_CREDITS",
          `${obs}.bulletins.${semKey}.${student}.data.semestre_valide`,
          b.semestre_valide,
          "à arbitrer (semestreValide(" + b.credits_valides + ") = " + semestreValide(b.credits_valides) + ")",
          { scope: scopeFor(obs, [semKey], student, []), note: b.credits_valides + " crédits acquis sur " + b.credits_total + " ; décision du bulletin : " + b.decision },
        );
      }
    }
  }
  // Passage en année supérieure (> 48 crédits) : jamais calculé par le legacy ; on chiffre ce que dirait la fonction pure.
  for (const [semKey, perStudent] of Object.entries(observation.bts ?? {})) {
    for (const [student, res] of Object.entries(perStudent as Record<string, any>)) {
      if (!res.ok || !res.data.annuel) continue;
      let total = 0;
      for (const roster of Object.values(observation.rosters ?? {}) as any[]) total += roster.students?.[student]?.credits_valides ?? 0;
      defects.flag(
        "RULES_NOT_WIRED_YEAR_48_CREDITS",
        `${obs}.bts.${semKey}.${student}.data.annuel`,
        "aucune décision de passage",
        "à arbitrer (peutPasserAnneeSuperieure(" + total + ") = " + peutPasserAnneeSuperieure(total) + ")",
        { scope: [`${obs}.bts.${semKey}.${student}.data.annuel.**`], note: total + " crédits acquis sur l'année" },
      );
    }
  }

  // Moyenne d'UE AFFICHÉE >= 10 mais UE non validée (règle voulue : validation sur la valeur non arrondie).
  for (const [semKey, perStudent] of Object.entries(observation.bulletins ?? {})) {
    for (const [student, res] of Object.entries(perStudent as Record<string, any>)) {
      if (!res.ok) continue;
      (res.data.ues as any[]).forEach((u, i) => {
        if (u.is_conduite || u.validee || u.moyenne_ue == null || u.moyenne_ue < 10) return;
        if ((u.motifs as string[]).some((m) => m === "NOTE_ELIMINATOIRE" || m === "INCOMPLET")) return;
        defects.flag(
          "DISPLAYED_AVERAGE_10_NOT_VALIDATED",
          `${obs}.bulletins.${semKey}.${student}.data.ues[${i}].moyenne_ue`,
          u.moyenne_ue,
          "règle voulue (ADR-003) : validation sur la valeur non arrondie ; affichage à arbitrer",
          { scope: [], note: `UE ${u.code} : moyenne affichée ${u.moyenne_ue}, état ${u.etat}` },
        );
      });
    }
  }

  // Contradictions entre le résultat persisté (rattrapages) et le bulletin (valeurs relues arrondies).
  for (const [semKey, perStudent] of Object.entries(observation.bulletins ?? {})) {
    for (const [student, res] of Object.entries(perStudent as Record<string, any>)) {
      if (!res.ok) continue;
      const b = res.data;
      b.ues.forEach((u: any, i: number) => {
        if (u.is_conduite) return;
        u.ecues.forEach((e: any, j: number) => {
          const ecueKey = Object.values(setup.programmes.flatMap((p) => p.ecues)).find((x) => x.code === e.code)?.key;
          if (!ecueKey) return;
          const group = setup.groups.find((g) => g.students.includes(student));
          const ueKey = setup.programmes.flatMap((p) => p.ues).find((x) => x.code === u.code)?.key;
          if (!group || !ueKey) return;
          const row = observation.ecueResults?.[`${group.key}:${ueKey}`]?.[`${student}/${ecueKey}`];
          if (!row || e.validee_manuellement) return;
          if (row.validee !== e.validee) {
            const exact = exactEcueFor(grades, group.key, student, ecueKey);
            const exactValid = exact.note ? exact.note.gte(TEN) : null;
            defects.flag("DIVERGENT_ECUE_VALIDITY", `${obs}.bulletins.${semKey}.${student}.data.ues[${i}].ecues[${j}].validee`, e.validee, exactValid, {
              scope: scopeFor(obs, [semKey], student, []),
              note: `résultat persisté validee=${row.validee} (moyenne ${row.moyenne}) mais bulletin validee=${e.validee}`,
            });
          }
        });
      });
    }
  }
}
