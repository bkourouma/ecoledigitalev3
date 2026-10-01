import { student } from "./helpers";
import { defineScenario, type ClassicSetup, type ClassicStep } from "./types";

/**
 * (g, pile classique) Moyennes pondérées dont la valeur EXACTE est un seuil (8, 10, 12, 14, 16) mais que le double
 * calcule juste en dessous : mention, décision du conseil et décision de fin d'année basculent dans la catégorie inférieure.
 *
 * Exemple central : matières à 6,40 (coefficient 1) et 11,20 (coefficient 3) -> (6,4 + 33,6)/4 = 10 exactement ;
 * le legacy calcule 9,999999999999998 : « Passable », « Renforcement recommande », « Redoublement ».
 * Coefficients décimaux (migration 0054) : 1,5 et 2,5.
 */

type Avg = ClassicSetup["averages"][number];
const A = "tl"; // classe 1 : matières A (coef 1) et B (coef 3)
const B = "td"; // classe 2 : matières X (coef 1,5) et Y (coef 2,5)

const pair = (cls: string, who: string, c1: string, v1: number, c2: string, v2: number): Avg[] =>
  (["S1", "S2"] as const).flatMap((period) => [
    { class: cls, student: who, course: c1, period, value: v1 },
    { class: cls, student: who, course: c2, period, value: v2 },
  ]);

const averages: Avg[] = [
  // Seuils exacts, matières 1 et 3.
  ...pair(A, "f16", "MA", 6.01, "MB", 19.33), // 16
  ...pair(A, "f14", "MA", 6.05, "MB", 16.65), // 14
  ...pair(A, "f12", "MA", 6.15, "MB", 13.95), // 12
  ...pair(A, "f10", "MA", 6.4, "MB", 11.2), // 10
  ...pair(A, "f08", "MA", 6.2, "MB", 8.6), // 8
  // Témoins : exactement représentables, juste au-dessus et juste en dessous du seuil de 10.
  ...pair(A, "t10", "MA", 10, "MB", 10),
  ...pair(A, "t10b", "MA", 6.4, "MB", 11.21), // 10,0025
  ...pair(A, "t09", "MA", 6.4, "MB", 11.19), // 9,9975
  // Coefficients décimaux 1,5 et 2,5.
  ...pair(B, "d12", "MX", 6.1, "MY", 15.54), // 12
  ...pair(B, "d14", "MX", 6.1, "MY", 18.74), // 14
  ...pair(B, "d08", "MX", 6.3, "MY", 9.02), // 8
  ...pair(B, "d13", "MX", 10, "MY", 16), // 13,75 exactement représentable
];

const setup: ClassicSetup = {
  academicYear: { name: "2025-2026", start: "2025-09-15", end: "2026-06-30" },
  programme: { key: "flot", name: "Programme seuils flottants", code: "FLOT" },
  periods: [
    { key: "S1", name: "Semestre 1", start: "2025-09-15", end: "2026-01-31", role: "first-semester" },
    { key: "S2", name: "Semestre 2", start: "2026-02-01", end: "2026-06-30", role: "second-semester" },
  ],
  courses: [
    { key: "MA", code: "MA", name: "Matière A", coefficient: 1, section: "Bilan général" },
    { key: "MB", code: "MB", name: "Matière B", coefficient: 3, section: "Bilan général" },
    { key: "MX", code: "MX", name: "Matière X", coefficient: 1.5, section: "Bilan général" },
    { key: "MY", code: "MY", name: "Matière Y", coefficient: 2.5, section: "Bilan général" },
  ],
  classes: [
    { key: A, name: "Classe seuils 1-3", students: ["f16", "f14", "f12", "f10", "f08", "t10", "t10b", "t09"] },
    { key: B, name: "Classe coefficients décimaux", students: ["d12", "d14", "d08", "d13"] },
  ],
  averages,
};

const steps: ClassicStep[] = [
  { do: "report", class: A, period: "S1", label: "bulletins S1 classe 1-3" },
  { do: "report", class: A, period: "S2", label: "bulletins S2 classe 1-3 (annuel)" },
  { do: "report", class: B, period: "S1", label: "bulletins S1 coefficients décimaux" },
  { do: "report", class: B, period: "S2", label: "bulletins S2 coefficients décimaux (annuel)" },
];

export default defineScenario({
  meta: {
    name: "classique-flottants",
    title: "Pile classique : moyennes pondérées exactement sur un seuil, jugées en dessous par le flottant",
    description:
      "Douze élèves dont huit ont une moyenne pondérée qui vaut EXACTEMENT 8, 10, 12, 14 ou 16 en arithmétique décimale (les quatre autres sont des témoins). Le legacy calcule en double " +
      "(Σ moyenne×coef / Σ coef) : plusieurs tombent sous le seuil de 1 à 2 unités du dernier chiffre (9,999999999999998) et changent de " +
      "mention, de décision de période, de distinction et de décision de fin d'année. Témoins exactement représentables et coefficients décimaux inclus.",
    slices: ["2.4"],
    rules: [
      "Une moyenne exactement égale à un seuil appartient à la catégorie supérieure (>= seuil)",
      "Coefficients décimaux admis (1,5 ; 2,5) : migration 0054",
    ],
  },
  tenant: { slug: "char-flottants", name: "Établissement de test flottants" },
  students: [
    ...["f16", "f14", "f12", "f10", "f08", "t10", "t10b", "t09", "d12", "d14", "d08", "d13"].map((k) => student(k, k.toUpperCase(), "Seuil")),
  ],
  teachers: [],
  classic: { setup, steps },
});
