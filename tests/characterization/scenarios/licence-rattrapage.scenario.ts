import { ecueGrades, sameOnEcues, student } from "./helpers";
import { defineScenario, type GradeDecl, type ProgrammeDecl } from "./types";

/**
 * (b) Licence avec rattrapage : la session 2 REMPLACE la session 1, dette d'UE, décisions admis / rattrapage / ajourné.
 *
 * Filière « Licence 3 ... » (hors du motif « Licence 1/2 » : pas de bulletin BTS ici, snapshot plus compacte).
 * Un étudiant dont une UE n'est pas validée et qui n'a pas encore passé la session 2 est « en attente de session 2 » :
 * son bulletin n'est ni consultable ni généré. Après la session 2, une UE encore non validée devient une DETTE.
 */

const G = "l3gl";
const ALL = ["E501A", "E501B", "E502A", "E503A", "E504A", "E504B"];

const programme: ProgrammeDecl = {
  key: "l3gl",
  name: "Licence 3 Génie logiciel",
  code: "L3GL",
  domain: "Informatique",
  semesters: [{ key: "S5", label: "Semestre 5", ues: ["UE501", "UE502", "UE503", "UE504"] }],
  ues: [
    { key: "UE501", code: "UE501", label: "Algorithmique avancée", declaredCredits: 8, category: "fondamentale", ecues: ["E501A", "E501B"] },
    { key: "UE502", code: "UE502", label: "Bases de données", declaredCredits: 6, category: "specialite", ecues: ["E502A"] },
    { key: "UE503", code: "UE503", label: "Anglais technique", declaredCredits: 4, category: "culture_generale", ecues: ["E503A"] },
    { key: "UE504", code: "UE504", label: "Projet de développement", declaredCredits: 6, category: "specialite", ecues: ["E504A", "E504B"] },
  ],
  ecues: [
    { key: "E501A", code: "L3GL-501A", label: "Structures de données", credits: 5 },
    { key: "E501B", code: "L3GL-501B", label: "Complexité", credits: 3 },
    { key: "E502A", code: "L3GL-502A", label: "Modélisation relationnelle", credits: 6 },
    { key: "E503A", code: "L3GL-503A", label: "Anglais informatique", credits: 4 },
    { key: "E504A", code: "L3GL-504A", label: "Conception", credits: 3 },
    { key: "E504B", code: "L3GL-504B", label: "Réalisation", credits: 3 },
  ],
};

const without = (excluded: string[]) => ALL.filter((e) => !excluded.includes(e));

const grades: GradeDecl[] = [
  // kofi : tout réussi en session 1 -> admis.
  ...sameOnEcues(G, "kofi", ALL, 14, 14),
  // lea : échoue UE502 (6/20) -> en attente de session 2 ; l'examen de session 2 à 15 la valide (note 11,4).
  ...sameOnEcues(G, "lea", without(["E502A"]), 13, 13),
  ...ecueGrades(G, "lea", "E502A", 6, 6),
  // marc : échoue UE501 (5,375 de moyenne d'UE), session 2 insuffisante -> dette -> ajourné.
  ...sameOnEcues(G, "marc", without(["E501A", "E501B"]), 13, 13),
  ...ecueGrades(G, "marc", "E501A", 5, 5),
  ...ecueGrades(G, "marc", "E501B", 6, 6),
  // nadia : échoue UE503 (7), n'a pas passé la session 2 -> décision 'rattrapage', bulletin indisponible.
  ...sameOnEcues(G, "nadia", without(["E503A"]), 13, 13),
  ...ecueGrades(G, "nadia", "E503A", 7, 7),
  // omar : réussit tout en session 1 (12), passe quand même la session 2 de E504A (4) : elle REMPLACE sa note.
  ...sameOnEcues(G, "omar", ALL, 12, 12),
  // paul : E502A éliminatoire (4) validée par le jury -> UE502 validée en session 2.
  ...sameOnEcues(G, "paul", without(["E502A"]), 13, 13),
  ...ecueGrades(G, "paul", "E502A", 4, 4),
  // quentin : E502A à 8, session 2 à 12 -> 0,4×8 + 0,6×12 = 10,4 validée.
  ...sameOnEcues(G, "quentin", without(["E502A"]), 13, 13),
  ...ecueGrades(G, "quentin", "E502A", 8, 8),
  // rita : E503A à 9,99, session 2 à 10 -> 9,996 : toujours insuffisant -> dette.
  ...sameOnEcues(G, "rita", without(["E503A"]), 13, 13),
  ...ecueGrades(G, "rita", "E503A", 9.99, 9.99),
  // sofia : notes issues d'évaluations (copies notées) sur barèmes 10, 20 et 40 -> ramenées sur 20.
  ...ecueGrades(G, "sofia", "E501A", [7, 18], 36, { via: "assessment" }).map((g, i) => ({ ...g, max: i === 0 ? 10 : i === 1 ? 20 : 40 })),
  ...sameOnEcues(G, "sofia", without(["E501A"]), 12, 12),
];

export default defineScenario({
  meta: {
    name: "licence-rattrapage",
    title: "Licence 3 : rattrapage (session 2 remplace session 1), dette d'UE, décisions admis / rattrapage / ajourné",
    description:
      "Neuf étudiants sur un semestre de 24 crédits. Couvre l'état LMD de l'UE (validée, en rattrapage, en dette), la décision du semestre " +
      "(admis, rattrapage, ajourné), l'indisponibilité du bulletin en attente de session 2, la validation par le jury, le remplacement de la note " +
      "d'examen par la session 2 (même plus basse), la liste des rattrapages et les évaluations à barèmes différents.",
    slices: ["2.5", "2.6"],
    rules: [
      "Une ECUE non validée sans note de session 2 est « à repasser » (UE en rattrapage) ; avec une note de session 2 non validée, l'UE est en dette",
      "Décision du semestre : admis (toutes UE validées), rattrapage (au moins une UE jamais repassée), ajourné (UE non validées toutes déjà repassées)",
      "L'examen de session 2 REMPLACE celui de session 1 (même s'il est plus bas) ; les devoirs sont conservés",
      "Un étudiant en attente de session 2 n'a ni bulletin consultable ni bulletin généré",
      "Une ECUE validée par le jury compte comme obtenue en session 2",
      "Les notes sont ramenées sur 20 : (note / barème) x 20",
    ],
  },
  tenant: { slug: "char-l3gl", name: "Établissement de test Licence" },
  students: [
    student("kofi", "Kofi", "Mensah"),
    student("lea", "Léa", "Marchand"),
    student("marc", "Marc", "Duval"),
    student("nadia", "Nadia", "Benali"),
    student("omar", "Omar", "Sow"),
    student("paul", "Paul", "Girard"),
    student("quentin", "Quentin", "Roche"),
    student("rita", "Rita", "Okafor"),
    student("sofia", "Sofia", "Lopez"),
  ],
  teachers: [],
  higher: {
    higher: {
      programmes: [programme],
      groups: [
        {
          key: G,
          name: "L3 Génie logiciel 2025-2026",
          programme: "l3gl",
          students: ["kofi", "lea", "marc", "nadia", "omar", "paul", "quentin", "rita", "sofia"],
          start: "2025-09-15",
          end: "2026-02-15",
          semesterLink: "both",
        },
      ],
      grades,
    },
    steps: [
      { do: "recompute", label: "calcul session 1" },
      { do: "observe", label: "apres-session-1" },
      { do: "enter-grade", grade: { student: "lea", group: G, ecue: "E502A", nature: "examen", value: 15, session: 2 }, label: "session 2 : lea E502A 15" },
      { do: "enter-grade", grade: { student: "marc", group: G, ecue: "E501A", nature: "examen", value: 8, session: 2 }, label: "session 2 : marc E501A 8" },
      { do: "enter-grade", grade: { student: "marc", group: G, ecue: "E501B", nature: "examen", value: 7, session: 2 }, label: "session 2 : marc E501B 7" },
      { do: "enter-grade", grade: { student: "omar", group: G, ecue: "E504A", nature: "examen", value: 4, session: 2 }, label: "session 2 : omar E504A 4 (plus bas que 12)" },
      { do: "enter-grade", grade: { student: "quentin", group: G, ecue: "E502A", nature: "examen", value: 12, session: 2 }, label: "session 2 : quentin E502A 12" },
      { do: "enter-grade", grade: { student: "rita", group: G, ecue: "E503A", nature: "examen", value: 10, session: 2 }, label: "session 2 : rita E503A 10" },
      { do: "enter-grade", grade: { student: "kofi", group: G, ecue: "E501A", nature: "examen", value: 25, session: 1 }, label: "refus : note 25 sur un barème de 20" },
      { do: "jury-validate", student: "paul", ecue: "E502A", group: G, validated: true, label: "jury : paul E502A" },
      { do: "generate-bulletins", semester: "S5", label: "bulletins S5" },
      { do: "observe", label: "final" },
    ],
  },
});
