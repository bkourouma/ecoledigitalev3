import { ecueGrades, student } from "./helpers";
import { defineScenario, type GradeDecl, type ProgrammeDecl } from "./types";

/**
 * (g) Notes aux valeurs-limites : documente le comportement FLOTTANT ACTUEL du legacy (ADR-003).
 *
 * Grille des notes à deux décimales (0,00-20,00) pour les devoirs ET l'examen : 24 couples (devoirs, examen) valent EXACTEMENT 10 que le
 * double juge < 10, et 8 couples valent EXACTEMENT 5 que le double juge < 5 (donc « éliminatoire »). S'y ajoutent les bornes habituelles
 * (0, 20, 4,99, 5, 5,01, 9,99, 10, 10,01), l'absence de devoirs, le cas où l'arrondi à 2 décimales des devoirs relus en base fait basculer
 * la validation (9,99 et 10,00 -> 9,995 enregistré 10,00), une évaluation notée sur 10, et deux UE dont la MOYENNE pondérée vaut exactement 10.
 *
 * Programme « Master 1 ... » : hors du motif « Licence 1/2 », donc sans bulletin de style BTS.
 */

const G = "lim";

/** Les 24 couples (devoirs, examen) dont la note vaut exactement 10 mais est calculée 9.999999999999998. */
const EXACT_TEN: [number, number][] = [
  [0.13, 16.58], [0.16, 16.56], [0.22, 16.52], [0.4, 16.4], [0.46, 16.36], [0.64, 16.24], [0.7, 16.2], [0.88, 16.08],
  [0.94, 16.04], [1.39, 15.74], [1.63, 15.58], [1.75, 15.5], [1.87, 15.42], [1.99, 15.34], [2.11, 15.26], [2.23, 15.18],
  [2.35, 15.1], [2.47, 15.02], [2.59, 14.94], [2.71, 14.86], [2.83, 14.78], [2.95, 14.7], [3.07, 14.62], [3.19, 14.54],
];

/** Les 8 couples dont la note vaut exactement 5 mais est calculée 4.999999999999999 (jugée éliminatoire). */
const EXACT_FIVE: [number, number][] = [
  [0.08, 8.28], [0.11, 8.26], [0.2, 8.2], [0.23, 8.18], [0.32, 8.12], [0.35, 8.1], [0.44, 8.04], [0.47, 8.02],
];

const pad = (n: number) => String(n).padStart(2, "0");

const programme: ProgrammeDecl = {
  key: "m1nl",
  name: "Master 1 Notes limites",
  code: "M1NL",
  domain: "Test",
  semesters: [{ key: "SL", label: "Semestre limites", ues: ["UELIM", "UEPAIR"] }],
  ues: [
    { key: "UELIM", code: "UELIM", label: "UE à une seule ECUE", declaredCredits: 4, ecues: ["LIM"] },
    { key: "UEPAIR", code: "UEPAIR", label: "UE à deux ECUE (crédits 1 et 3)", declaredCredits: 4, ecues: ["P1", "P3"] },
  ],
  ecues: [
    { key: "LIM", code: "NL-LIM", label: "ECUE limite", credits: 4 },
    { key: "P1", code: "NL-P1", label: "ECUE à 1 crédit", credits: 1 },
    { key: "P3", code: "NL-P3", label: "ECUE à 3 crédits", credits: 3 },
  ],
};

const studentKeys: string[] = [];
const grades: GradeDecl[] = [];
const add = (key: string, devoirs: number | number[] | null, exam: number | null, extra: Parameters<typeof ecueGrades>[5] = {}) => {
  studentKeys.push(key);
  grades.push(...ecueGrades(G, key, "LIM", devoirs, exam, extra));
  // UE à deux ECUE réussie : le bulletin du semestre reste consultable quand l'ECUE limite est validée.
  grades.push(...ecueGrades(G, key, "P1", 12, 12), ...ecueGrades(G, key, "P3", 12, 12));
};

EXACT_TEN.forEach(([d, e], i) => add(`ten${pad(i + 1)}`, d, e));
EXACT_FIVE.forEach(([d, e], i) => add(`five${pad(i + 1)}`, d, e));
add("zero", 0, 0);
add("vingt", 20, 20);
add("dix-pile", 10, 10);
add("neuf99", 9.99, 9.99);
add("dix01", 10.01, 10.01);
add("cinq-pile", 5, 5);
add("quatre99", 4.99, 4.99);
add("cinq01", 5.01, 5.01);
add("sans-devoir-valide", null, 16.67); // 0,6 × 16,67 = 10,002
add("sans-devoir-limite", null, 16.66); // 0,6 × 16,66 = 9,996
// Moyenne des devoirs 9,995 : enregistrée 10,00 (numeric(6,2)) ; la note exacte 9,998 n'atteint pas 10 mais le bulletin recalcule 10.
add("devoirs-arrondis", [9.99, 10.0], 10.0);
// Évaluation (copie notée) sur un barème de 10 : 7/10 = 14/20.
studentKeys.push("evaluation-sur-10");
grades.push(
  ...ecueGrades(G, "evaluation-sur-10", "LIM", 7, 7, { via: "assessment", max: 10 }),
  ...ecueGrades(G, "evaluation-sur-10", "P1", 12, 12),
  ...ecueGrades(G, "evaluation-sur-10", "P3", 12, 12),
);

// UE à deux ECUE (1 et 3 crédits) dont la moyenne vaut exactement 10 : (6,4×1 + 11,2×3)/4 et (7,15×1 + 10,95×3)/4 ; témoin exactement représentable (7×1 + 11×3)/4.
const pairStudents: [string, number, number][] = [
  ["ue-dix-a", 6.4, 11.2],
  ["ue-dix-b", 7.15, 10.95],
  ["ue-dix-c", 7, 11],
];
for (const [key, p1, p3] of pairStudents) {
  studentKeys.push(key);
  grades.push(...ecueGrades(G, key, "P1", p1, p1), ...ecueGrades(G, key, "P3", p3, p3));
}

export default defineScenario({
  meta: {
    name: "notes-limites",
    title: "Notes aux valeurs-limites : 24 couples flottants à 10, 8 couples à 5, bornes usuelles, arrondi des devoirs",
    description:
      "Quarante-sept étudiants dont la note d'ECUE (devoirs×0,4 + examen×0,6) est EXACTEMENT sur un seuil (10 ou 5) ou à un centième près. Fige le " +
      "comportement flottant actuel : ECUE exactement égale à 10 non validée, exactement égale à 5 déclarée éliminatoire (UE verrouillée), moyenne " +
      "d'UE exactement égale à 10 non validée, validation décidée sur la valeur exacte mais relue arrondie à 2 décimales par le bulletin.",
    slices: ["2.4", "2.5"],
    rules: [
      "Seuil de validation d'une ECUE : note >= 10 sur la valeur NON arrondie",
      "Seuil éliminatoire : note < 5 sur la valeur non arrondie ; une ECUE éliminatoire verrouille son UE",
      "Moyenne d'UE >= 10 pour valider",
      "Sans devoir, le contrôle continu compte pour 0",
      "Les notes d'évaluation sont ramenées sur 20 : (note / barème) × 20",
    ],
  },
  tenant: { slug: "char-limites", name: "Établissement de test limites" },
  students: studentKeys.map((k) => student(k, k, "Limite")),
  teachers: [],
  higher: {
    higher: {
      programmes: [programme],
      groups: [
        {
          key: G,
          name: "M1 notes limites",
          programme: "m1nl",
          students: studentKeys,
          start: "2025-09-15",
          end: "2026-02-15",
          semesterLink: "ue",
        },
      ],
      grades,
    },
    steps: [
      { do: "recompute", label: "calcul" },
      { do: "observe", label: "final" },
    ],
  },
});
