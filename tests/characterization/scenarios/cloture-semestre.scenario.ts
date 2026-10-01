import { ecueGrades, sameOnEcues, student } from "./helpers";
import { defineScenario, type GradeDecl, type ProgrammeDecl } from "./types";

/**
 * (e) Clôture de semestre bloquant la saisie.
 *
 * Clôturer les BULLETINS d'un semestre (professional_semestres.bulletins_clotures_at) arrête ses notes : saisie, modification, suppression,
 * recalcul de cohorte et correction d'une copie sont refusés avec « Le semestre « ... » a été clôturé le JJ/MM/AAAA ». Un semestre dont les
 * bulletins n'ont pas été générés ne peut pas être clôturé. Clôturer les NOTES (cohortes « terminé ») est un autre geste, qui ne bloque rien.
 * Le verrou suit les deux chemins de rattachement d'une cohorte à son semestre (par l'UE et par la cohorte).
 *
 * Deux filières : A (rattachement par l'UE ET par la cohorte, deux semestres) et B (rattachement par la cohorte seule).
 */

const A = "cla";
const B = "clb";

const progA: ProgrammeDecl = {
  key: "pa",
  name: "Licence 3 Clôture A",
  code: "L3CLA",
  semesters: [
    { key: "SA1", label: "Semestre A1", ues: ["UA1"] },
    { key: "SA2", label: "Semestre A2", ues: ["UA2"] },
  ],
  ues: [
    { key: "UA1", code: "UA1", label: "UE A1", declaredCredits: 4, ecues: ["A1X", "A1Y"] },
    { key: "UA2", code: "UA2", label: "UE A2", declaredCredits: 4, ecues: ["A2X", "A2Y"] },
  ],
  ecues: [
    { key: "A1X", code: "CLA-A1X", label: "A1 matière X", credits: 2 },
    { key: "A1Y", code: "CLA-A1Y", label: "A1 matière Y", credits: 2 },
    { key: "A2X", code: "CLA-A2X", label: "A2 matière X", credits: 2 },
    { key: "A2Y", code: "CLA-A2Y", label: "A2 matière Y", credits: 2 },
  ],
};

const progB: ProgrammeDecl = {
  key: "pb",
  name: "Licence 3 Clôture B",
  code: "L3CLB",
  semesters: [{ key: "SB1", label: "Semestre B1", ues: ["UB1"] }],
  ues: [{ key: "UB1", code: "UB1", label: "UE B1", declaredCredits: 4, ecues: ["B1X"] }],
  ecues: [{ key: "B1X", code: "CLB-B1X", label: "B1 matière X", credits: 4 }],
};

const grades: GradeDecl[] = [
  ...sameOnEcues(A, "ana", ["A1X", "A1Y", "A2X", "A2Y"], 14, 14),
  ...sameOnEcues(A, "ben", ["A1X", "A1Y", "A2X", "A2Y"], 12, 12),
  // Copies d'évaluation (captées automatiquement) pour exercer la garde de correction.
  ...ecueGrades(A, "chi", "A1X", 13, 13, { via: "assessment" }),
  ...sameOnEcues(A, "chi", ["A1Y", "A2X", "A2Y"], 13, 13),
  ...sameOnEcues(B, "dan", ["B1X"], 11, 11),
];

export default defineScenario({
  meta: {
    name: "cloture-semestre",
    title: "Clôture de semestre : la saisie, la modification, la suppression, le recalcul et la correction sont bloqués",
    description:
      "Trois étudiants sur la filière A (deux semestres) et un sur la filière B (rattachement par la cohorte). Génère les bulletins, clôture le semestre A1 " +
      "puis tente toutes les écritures de notes ; vérifie l'idempotence de la clôture, le refus de régénérer, le refus de clôturer sans bulletin, " +
      "l'indépendance du semestre A2 et de la clôture des NOTES (qui ne bloque rien). La date de clôture est figée au 31/01/2026 dans les messages.",
    slices: ["2.5", "2.6"],
    rules: [
      "Bulletins clôturés : plus de saisie, de modification, de suppression, de recalcul de cohorte ni de correction de copie sur ce semestre",
      "Message : « Le semestre « X » a été clôturé le JJ/MM/AAAA : ses notes ne sont plus modifiables, les bulletins étant arrêtés. »",
      "Clôturer sans bulletin généré est refusé ; clôturer deux fois est sans effet (idempotent, la date n'est pas modifiée)",
      "Un semestre clôturé ne peut plus régénérer ses bulletins",
      "Clôturer les NOTES (cohortes « terminé ») est indépendant et ne bloque pas la saisie",
      "Le verrou suit le rattachement par l'UE et par la cohorte",
    ],
  },
  tenant: { slug: "char-cloture", name: "Établissement de test clôture" },
  students: [student("ana", "Ana", "Clôture"), student("ben", "Ben", "Clôture"), student("chi", "Chi", "Clôture"), student("dan", "Dan", "Clôture")],
  teachers: [],
  higher: {
    higher: {
      programmes: [progA, progB],
      groups: [
        { key: A, name: "L3 Clôture A", programme: "pa", students: ["ana", "ben", "chi"], start: "2025-09-15", end: "2026-02-15", semesterLink: "both" },
        { key: B, name: "L3 Clôture B", programme: "pb", students: ["dan"], start: "2025-09-15", end: "2026-02-15", semesterLink: "session" },
      ],
      grades,
    },
    steps: [
      { do: "recompute", label: "calcul initial" },
      { do: "close-bulletins", semester: "SA1", label: "refus : clôturer sans bulletin généré" },
      { do: "enter-grade", grade: { student: "ben", group: A, ecue: "A1X", nature: "devoir", value: 16, label: "Devoir 2" }, label: "saisie avant clôture (ben A1X devoir 16) : acceptée" },
      { do: "generate-bulletins", semester: "SA1", label: "bulletins SA1" },
      { do: "generate-bulletins", semester: "SB1", label: "bulletins SB1" },
      { do: "close-bulletins", semester: "SA1", label: "clôture SA1" },
      { do: "close-bulletins", semester: "SA1", label: "seconde clôture SA1 : idempotente" },
      { do: "close-bulletins", semester: "SB1", label: "clôture SB1 (rattachement par la cohorte)" },
      { do: "enter-grade", grade: { student: "ana", group: A, ecue: "A1X", nature: "devoir", value: 20, label: "Devoir tardif" }, label: "saisie après clôture SA1 : refusée" },
      { do: "enter-grade", grade: { student: "ana", group: A, ecue: "A1Y", nature: "examen", value: 20 }, label: "examen après clôture SA1 : refusé" },
      { do: "update-grade", student: "ben", ecue: "A1X", group: A, nature: "devoir", value: 5, label: "modification après clôture SA1 : refusée" },
      { do: "delete-grade", student: "ben", ecue: "A1X", group: A, nature: "devoir", label: "suppression après clôture SA1 : refusée" },
      { do: "grade-evaluation", student: "chi", ecue: "A1X", group: A, nature: "examen", value: 20, label: "correction d'une copie après clôture SA1 : refusée" },
      { do: "enter-grade", grade: { student: "dan", group: B, ecue: "B1X", nature: "examen", value: 20 }, label: "saisie après clôture SB1 (lien par la cohorte) : refusée" },
      { do: "recompute", label: "recalcul de toutes les cohortes : SA1 et SB1 refusés, SA2 accepté" },
      { do: "generate-bulletins", semester: "SA1", label: "régénération SA1 : refusée" },
      { do: "enter-grade", grade: { student: "ana", group: A, ecue: "A2X", nature: "devoir", value: 18, label: "Devoir S2" }, label: "saisie dans SA2 (non clôturé) : acceptée" },
      { do: "close-bulletins", semester: "SA2", label: "refus : clôturer SA2 sans bulletin généré" },
      { do: "close-grades", semester: "SA2", label: "clôture des NOTES de SA2 (cohortes terminées)" },
      { do: "enter-grade", grade: { student: "ana", group: A, ecue: "A2Y", nature: "devoir", value: 17, label: "Devoir après clôture des notes" }, label: "saisie dans SA2 après clôture des notes : toujours acceptée" },
      { do: "observe", label: "final" },
    ],
  },
});
