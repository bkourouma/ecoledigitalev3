import { ecueGrades, student } from "./helpers";
import { defineScenario, type AttendanceDecl, type GradeDecl, type ProgrammeDecl } from "./types";

/**
 * (d) Conduite et absences, pile Professional.
 *
 * La conduite est une note unique /20 portée par une ECUE dédiée (libellé « Conduite... » ou code « ...EC-CON... ») d'une UE sans
 * inscription. Elle compte dans la moyenne du semestre et dans les crédits, mais est exclue des moyennes de matière et des calculs de
 * résultat d'ECUE. Validée à >= 10 sur la note arrondie. Les absences du bulletin BTS comptent les présences « absent » (non justifiées)
 * et « excuse » (justifiées) de toutes les séances du semestre.
 */

const G = "l2c";

const programme: ProgrammeDecl = {
  key: "l2c",
  name: "Licence 2 Conduite",
  code: "L2COND",
  domain: "Gestion",
  semesters: [{ key: "S3", label: "Semestre 3", ues: ["UE-MAT", "UE-COND"] }],
  ues: [
    { key: "UE-MAT", code: "UE-MAT", label: "Matières", declaredCredits: 4, category: "fondamentale", ecues: ["M1", "M2"] },
    { key: "UE-COND", code: "UE-COND", label: "Conduite (S3)", declaredCredits: 2, conduct: true, ecues: ["COND"] },
  ],
  ecues: [
    { key: "M1", code: "L2C-M1", label: "Gestion financière", credits: 2 },
    { key: "M2", code: "L2C-M2", label: "Droit des affaires", credits: 2 },
    // Reconnue comme conduite par le libellé (« Conduite... ») ou par le code (« ...EC-CON... »).
    { key: "COND", code: "L2C-EC-CON-S3", label: "Conduite", credits: 2 },
  ],
};

const matieres = (who: string, note: number) => [...ecueGrades(G, who, "M1", note, note), ...ecueGrades(G, who, "M2", note, note)];
const conduite = (who: string, value: number): GradeDecl => ({ student: who, group: G, ecue: "COND", nature: "examen", value, label: "Conduite" });

const grades: GradeDecl[] = [
  ...matieres("ana", 14), conduite("ana", 16),
  // ben : conduite 9,99 -> UE de conduite non validée, sans rattrapage possible : décision « ajourné » d'emblée.
  ...matieres("ben", 14), conduite("ben", 9.99),
  // chi : conduite exactement 10 -> validée.
  ...matieres("chi", 12), conduite("chi", 10),
  // dan : pas de note de conduite -> pas d'UE de conduite dans son bulletin.
  ...matieres("dan", 12),
  // eli : échoue en matières (8), conduite 18 : en attente de session 2.
  ...matieres("eli", 8), conduite("eli", 18),
  // fay : conduite 9,995 (enregistrée 10,00 par numeric(6,2)) -> validée.
  ...matieres("fay", 15), conduite("fay", 9.995),
];

const attendance: AttendanceDecl[] = [
  { student: "ana", group: G, ecue: "M1", date: "2025-10-06", status: "absent" },
  { student: "ana", group: G, ecue: "M1", date: "2025-10-13", status: "absent" },
  { student: "ana", group: G, ecue: "M2", date: "2025-10-07", status: "excused" },
  { student: "ana", group: G, ecue: "M2", date: "2025-10-14", status: "late" },
  { student: "ben", group: G, ecue: "M1", date: "2025-10-06", status: "excused" },
  { student: "ben", group: G, ecue: "M2", date: "2025-10-07", status: "excused" },
  { student: "ben", group: G, ecue: "M2", date: "2025-10-14", status: "excused" },
  { student: "chi", group: G, ecue: "M1", date: "2025-10-06", status: "present" },
  { student: "chi", group: G, ecue: "M2", date: "2025-10-07", status: "present" },
];

export default defineScenario({
  meta: {
    name: "conduite-absences",
    title: "Conduite (note unique /20 comptée dans le semestre) et absences du bulletin BTS",
    description:
      "Six étudiants de Licence 2 avec une UE de conduite à 2 crédits : conduite 16, 9,99 (non validée), 10 (validée), absente, 9,995 (enregistrée 10,00) " +
      "et une conduite correcte chez un étudiant en attente de session 2. Fige l'effet de la conduite sur la moyenne du semestre, les crédits, " +
      "la décision, la grille de saisie des conduites et le décompte des absences justifiées / non justifiées du bulletin BTS.",
    slices: ["2.3", "2.4", "2.5"],
    rules: [
      "La conduite est une note brute /20 (pas de pondération devoirs/examen) qui compte dans la moyenne du semestre au poids de ses crédits",
      "La conduite est exclue des moyennes de matière, des résultats d'ECUE et des statistiques de résultats",
      "UE de conduite validée si la note arrondie est >= 10 ; une conduite < 10 rend le semestre non validé sans rattrapage possible",
      "Bulletin BTS : absences non justifiées = présences « absent » ; justifiées = présences « excuse » ; les retards ne comptent pas",
      "Tableau d'honneur 12 <= moyenne < 15, encouragement >= 15, avertissement < 10 (bulletin BTS)",
    ],
  },
  tenant: { slug: "char-conduite", name: "Établissement de test conduite" },
  students: [
    student("ana", "Ana", "Conduite"),
    student("ben", "Ben", "Conduite"),
    student("chi", "Chi", "Conduite"),
    student("dan", "Dan", "Conduite"),
    student("eli", "Eli", "Conduite"),
    student("fay", "Fay", "Conduite"),
  ],
  teachers: [],
  higher: {
    higher: {
      programmes: [programme],
      groups: [
        {
          key: G,
          name: "L2 Conduite 2025-2026",
          programme: "l2c",
          students: ["ana", "ben", "chi", "dan", "eli", "fay"],
          start: "2025-09-15",
          end: "2026-02-15",
          semesterLink: "ue",
        },
      ],
      grades,
      attendance,
    },
    steps: [
      { do: "recompute", label: "calcul" },
      { do: "generate-bulletins", semester: "S3", label: "bulletins S3" },
      { do: "observe", label: "final" },
    ],
  },
});
