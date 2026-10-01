import { student } from "./helpers";
import { defineScenario, type ClassicSetup, type ClassicStep } from "./types";

/**
 * (c) + (d) Bulletin de la pile classique : moyennes par matière SAISIES, coefficients, sections (types de bilan),
 * moyenne annuelle (S1 + 2·S2)/3, classement avec ex æquo, mentions aux bornes 16/14/12/10/8, appréciation du conseil,
 * distinctions, décision de fin d'année, récapitulatif des absences.
 *
 * Matières (coefficient) : FRA 4, HIG 2, ANG 2 (section « Matières littéraires ») ; MAT 3, PHY 2 (« Matières scientifiques ») ;
 * EPS 1 (section « Éducation physique et sportive »). Total des coefficients : 14.
 */

const COURSES = ["FRA", "HIG", "ANG", "MAT", "PHY", "EPS"] as const;

type Avg = ClassicSetup["averages"][number];
const CLASS = "tla";

function uniform(studentKey: string, period: string, value: number): Avg[] {
  return COURSES.map((c) => ({ class: CLASS, student: studentKey, course: c, period, value }));
}
function custom(studentKey: string, period: string, values: (number | null)[]): Avg[] {
  return COURSES.flatMap((c, i) => (values[i] === null ? [] : [{ class: CLASS, student: studentKey, course: c, period, value: values[i] as number }]));
}

const averages: Avg[] = [
  // Une moyenne par seuil de mention, au plus juste : S1 = S2 (la moyenne annuelle vaut donc la même valeur).
  ...uniform("e01", "S1", 16), ...uniform("e01", "S2", 16),
  ...uniform("e02", "S1", 15.99), ...uniform("e02", "S2", 15.99),
  ...uniform("e03", "S1", 14), ...uniform("e03", "S2", 14),
  ...uniform("e04", "S1", 13.99), ...uniform("e04", "S2", 13.99),
  ...uniform("e05", "S1", 12), ...uniform("e05", "S2", 12),
  ...uniform("e06", "S1", 11.99), ...uniform("e06", "S2", 11.99),
  ...uniform("e07", "S1", 10), ...uniform("e07", "S2", 10),
  ...uniform("e08", "S1", 9.99), ...uniform("e08", "S2", 9.99),
  ...uniform("e09", "S1", 8), ...uniform("e09", "S2", 8),
  ...uniform("e10", "S1", 7.99), ...uniform("e10", "S2", 7.99),
  // Moyennes annuelles exactement sur les seuils de distinction : (11 + 2×20)/3 = 17 ; (14 + 2×20)/3 = 18.
  ...uniform("e11", "S1", 11), ...uniform("e11", "S2", 20),
  ...uniform("e12", "S1", 14), ...uniform("e12", "S2", 20),
  // Ex æquo avec e01 (mêmes moyennes) : rang partagé.
  ...uniform("e13", "S1", 16), ...uniform("e13", "S2", 16),
  // Seulement le S1 : au S2, aucune moyenne -> « En attente », décision en attente.
  ...uniform("e14", "S1", 12),
  // Seulement le S2 : pas de S1 -> la moyenne annuelle est la moyenne du S2 (pas de formule).
  ...uniform("e15", "S2", 12),
  // (9 + 2×13,5)/3 = 12 ; (9 + 2×18)/3 = 15 : bornes du tableau d'honneur et de l'encouragement.
  ...uniform("e16", "S1", 9), ...uniform("e16", "S2", 13.5),
  ...uniform("e17", "S1", 9), ...uniform("e17", "S2", 18),
  // Notes variées par matière (pondération réelle des coefficients, classement par matière et par section).
  ...custom("e18", "S1", [12, 8, 15, 6, 10, 20]), ...custom("e18", "S2", [14, 11, 9.5, 12.25, 7, 18]),
  // Moyennes partielles : seules FRA et MAT sont notées -> moyenne sur les matières notées uniquement.
  ...custom("e19", "S2", [13, null, null, 8, null, null]),
];

const setup: ClassicSetup = {
  academicYear: { name: "2025-2026", start: "2025-09-15", end: "2026-06-30" },
  programme: { key: "sera", name: "Série A Lettres", code: "SERA" },
  periods: [
    { key: "S1", name: "Semestre 1", start: "2025-09-15", end: "2026-01-31", role: "first-semester" },
    { key: "S2", name: "Semestre 2", start: "2026-02-01", end: "2026-06-30", role: "second-semester" },
  ],
  courses: [
    { key: "FRA", code: "FRA", name: "Français", coefficient: 4, section: "Matières littéraires" },
    { key: "HIG", code: "HIG", name: "Histoire-Géographie", coefficient: 2, section: "Matières littéraires" },
    { key: "ANG", code: "ANG", name: "Anglais", coefficient: 2, section: "Matières littéraires" },
    { key: "MAT", code: "MAT", name: "Mathématiques", coefficient: 3, section: "Matières scientifiques" },
    { key: "PHY", code: "PHY", name: "Physique-Chimie", coefficient: 2, section: "Matières scientifiques" },
    { key: "EPS", code: "EPS", name: "Éducation physique", coefficient: 1, section: "Éducation physique et sportive" },
  ],
  classes: [
    {
      key: CLASS,
      name: "Terminale A",
      students: ["e01", "e02", "e03", "e04", "e05", "e06", "e07", "e08", "e09", "e10", "e11", "e12", "e13", "e14", "e15", "e16", "e17", "e18", "e19"],
    },
  ],
  averages,
  absences: [
    // Heures d'absence (dont justifiées) : formats « 00 », « 2,5 », « 12 » dans le récapitulatif.
    { class: CLASS, student: "e02", period: "S2", absenceHours: 2.5, justifiedHours: 1 },
    { class: CLASS, student: "e03", period: "S2", absenceHours: 12, justifiedHours: 12 },
    { class: CLASS, student: "e04", period: "S2", absenceHours: 0.33, justifiedHours: 0 },
    { class: CLASS, student: "e05", period: "S2", absenceHours: 0, justifiedHours: 0 },
    { class: CLASS, student: "e06", period: "S2", absenceHours: 100.5, justifiedHours: 0.5 },
  ],
};

const steps: ClassicStep[] = [
  { do: "report", class: CLASS, period: "S1", label: "bulletins S1" },
  { do: "report", class: CLASS, period: "S2", label: "bulletins S2 (annuel)" },
  { do: "report", class: CLASS, period: "S2", student: "e18", label: "bulletin S2 d'un seul élève (e18)" },
  { do: "matrix", class: CLASS, period: "S2", label: "matrice S2" },
  {
    do: "put-matrix",
    class: CLASS,
    period: "S2",
    label: "refus : heures justifiées > absences",
    cells: [],
    absences: [{ student: "e02", absenceHours: 1, justifiedHours: 2 }],
  },
  {
    do: "put-matrix",
    class: CLASS,
    period: "S2",
    label: "refus : élève non inscrit dans la classe",
    cells: [{ student: "etranger", course: "FRA", value: 10 }],
  },
  {
    do: "put-matrix",
    class: CLASS,
    period: "S2",
    label: "refus : moyenne supérieure à 20",
    cells: [{ student: "e07", course: "FRA", value: 21 }],
  },
  {
    do: "put-matrix",
    class: CLASS,
    period: "S2",
    label: "saisie valide : e07 monte en FRA, EPS effacée ; absences e07",
    cells: [
      { student: "e07", course: "FRA", value: 12.5 },
      { student: "e07", course: "EPS", value: null },
    ],
    absences: [{ student: "e07", absenceHours: 3, justifiedHours: 1 }],
  },
  { do: "report", class: CLASS, period: "S2", student: "e07", label: "bulletin S2 de e07 après saisie" },
];

export default defineScenario({
  meta: {
    name: "classique-terminale",
    title: "Pile classique : coefficients, (S1+2·S2)/3, ex æquo, mentions 16/14/12/10/8, conseil, distinctions, absences",
    description:
      "Dix-neuf élèves de Terminale A, six matières à coefficients (4, 2, 2, 3, 2, 1) réparties en deux sections, deux semestres de moyennes saisies. " +
      "Les moyennes sont placées au plus juste des seuils (16, 15,99, 14, 13,99, 12, 11,99, 10, 9,99, 8, 7,99) et des seuils de distinction annuels " +
      "(12, 15, 17, 18 obtenus exactement par la formule (S1+2·S2)/3). Couvre aussi le récapitulatif d'absences, les refus de saisie et le " +
      "bulletin d'un seul élève.",
    slices: ["2.4", "2.5", "2.6"],
    rules: [
      "Moyenne de section et générale = somme(moyenne x coefficient) / somme(coefficients) des seules matières notées",
      "Moyenne annuelle (au 2e semestre) = (S1 + 2 x S2) / 3 quand S1 et S2 existent, sinon la moyenne du semestre courant",
      "Mention : >=16 Excellent, >=14 Très bien, >=12 Bien, >=10 Assez bien, >=8 Passable, sinon Insuffisant",
      "Décision de période : >=10 validée, >=8 renforcement recommandé, sinon non validée",
      "Distinction : >=17 félicitations, >=15 encouragement, >=12 tableau d'honneur ; appréciation du conseil : seuils 8/10/12/14/16/18",
      "Décision de fin d'année : >=10 admis en année supérieure, sinon redoublement",
      "Rang : classement « compétition » (ex æquo partagent le meilleur rang, le suivant saute), égalité à 0,0001 près",
    ],
  },
  tenant: { slug: "char-classique", name: "Établissement de test classique" },
  students: [
    ...["e01", "e02", "e03", "e04", "e05", "e06", "e07", "e08", "e09", "e10", "e11", "e12", "e13", "e14", "e15", "e16", "e17", "e18", "e19"].map((k, i) =>
      student(k, `Élève${String(i + 1).padStart(2, "0")}`, "Terminale"),
    ),
    student("etranger", "Étienne", "Étranger"),
  ],
  teachers: [],
  classic: { setup, steps },
});
