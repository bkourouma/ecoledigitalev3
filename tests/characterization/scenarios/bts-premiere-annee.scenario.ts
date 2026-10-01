import { ecueGrades, sameOnEcues, student, teacher } from "./helpers";
import { defineScenario, type GradeDecl, type ProgrammeDecl } from "./types";

/**
 * (a) BTS 1re année, deux semestres.
 *
 * Règles figées : note d'ECUE = devoirs×0,4 + examen×0,6 ; moyenne d'UE pondérée par les crédits des ECUE
 * (compensation intra-UE) ; ECUE éliminatoire sous 5 (verrou de l'UE) ; validation à 10 sur la valeur non
 * arrondie (exactement 10 valide, 9,99 non) ; semestre 1 à 20 crédits ; année de 56 crédits (> 48 pour passer).
 *
 * Le nom de la filière contient « Licence 1 » : c'est ce motif (et non « BTS ») qui ouvre le bulletin de style
 * BTS (getBulletinBts) dans le legacy.
 */

const S1 = ["E101A", "E101B", "E102A", "E102B", "E103A", "E103B"];
const S2 = ["E201A", "E201B", "E202A", "E202B", "E203A", "E203B", "E204A", "E204B"];
const G = "bts1";

const programme: ProgrammeDecl = {
  key: "bts1",
  name: "Licence 1 Comptabilité Gestion (BTS 1re année)",
  code: "BTS1-CG",
  domain: "Gestion",
  semesters: [
    { key: "S1", label: "Semestre 1", ues: ["UE101", "UE102", "UE103"] },
    { key: "S2", label: "Semestre 2", ues: ["UE201", "UE202", "UE203", "UE204"] },
  ],
  ues: [
    { key: "UE101", code: "UE101", label: "Comptabilité générale", declaredCredits: 6, category: "fondamentale", ecues: ["E101A", "E101B"] },
    { key: "UE102", code: "UE102", label: "Droit et économie", declaredCredits: 6, category: "culture_generale", ecues: ["E102A", "E102B"] },
    { key: "UE103", code: "UE103", label: "Informatique de gestion", declaredCredits: 8, category: "specialite", ecues: ["E103A", "E103B"] },
    { key: "UE201", code: "UE201", label: "Comptabilité approfondie", declaredCredits: 12, category: "fondamentale", ecues: ["E201A", "E201B"] },
    { key: "UE202", code: "UE202", label: "Fiscalité", declaredCredits: 10, category: "specialite", ecues: ["E202A", "E202B"] },
    { key: "UE203", code: "UE203", label: "Gestion commerciale", declaredCredits: 8, category: "specialite", ecues: ["E203A", "E203B"] },
    { key: "UE204", code: "UE204", label: "Communication", declaredCredits: 6, category: "culture_generale", ecues: ["E204A", "E204B"] },
  ],
  ecues: [
    { key: "E101A", code: "BTS1-101A", label: "Comptabilité financière", credits: 4 },
    { key: "E101B", code: "BTS1-101B", label: "Calcul commercial", credits: 2 },
    { key: "E102A", code: "BTS1-102A", label: "Droit civil", credits: 3 },
    { key: "E102B", code: "BTS1-102B", label: "Économie générale", credits: 3 },
    { key: "E103A", code: "BTS1-103A", label: "Bureautique", credits: 4 },
    { key: "E103B", code: "BTS1-103B", label: "Algorithmique", credits: 4 },
    { key: "E201A", code: "BTS1-201A", label: "Comptabilité analytique", credits: 6 },
    { key: "E201B", code: "BTS1-201B", label: "Comptabilité des sociétés", credits: 6 },
    { key: "E202A", code: "BTS1-202A", label: "Fiscalité des entreprises", credits: 5 },
    { key: "E202B", code: "BTS1-202B", label: "Fiscalité des particuliers", credits: 5 },
    { key: "E203A", code: "BTS1-203A", label: "Marketing", credits: 4 },
    { key: "E203B", code: "BTS1-203B", label: "Techniques de vente", credits: 4 },
    { key: "E204A", code: "BTS1-204A", label: "Expression écrite", credits: 3 },
    { key: "E204B", code: "BTS1-204B", label: "Anglais des affaires", credits: 3 },
  ],
};

const grades: GradeDecl[] = [
  // amina et kofi : mêmes notes en S1 (ex æquo au rang 1) ; amina réussit tout S2.
  ...sameOnEcues(G, "amina", S1, 16, 15),
  ...sameOnEcues(G, "kofi", S1, 16, 15),
  ...sameOnEcues(G, "amina", S2, 15, 14),
  // kofi échoue UE203 (8 crédits) en S2 : 20 + 28 = 48 crédits, exactement le seuil (non strictement supérieur).
  ...sameOnEcues(G, "kofi", ["E201A", "E201B", "E202A", "E202B", "E204A", "E204B"], 13, 13),
  ...sameOnEcues(G, "kofi", ["E203A", "E203B"], 6, 6),

  // bako : compensation intra-UE (UE101 : 14 pondéré 4 + 7,6 pondéré 2 = 11,87) ; échoue UE204 en S2 (30 crédits acquis sur 36).
  ...ecueGrades(G, "bako", "E101A", 14, 14),
  ...ecueGrades(G, "bako", "E101B", 7, 8),
  ...sameOnEcues(G, "bako", ["E102A", "E102B", "E103A", "E103B"], 12, 12),
  ...sameOnEcues(G, "bako", ["E201A", "E201B", "E202A", "E202B", "E203A", "E203B"], 12, 12),
  ...sameOnEcues(G, "bako", ["E204A", "E204B"], 7, 7),

  // chloe : ECUE éliminatoire (4,6 < 5) dans UE102 malgré 19 dans l'autre ECUE (moyenne d'UE 11,8 mais UE non validée).
  ...ecueGrades(G, "chloe", "E102A", 19, 19),
  ...ecueGrades(G, "chloe", "E102B", 4, 5),
  ...sameOnEcues(G, "chloe", ["E101A", "E101B", "E103A", "E103B"], 12, 12),

  // drissa : exactement 10 partout (valide).
  ...sameOnEcues(G, "drissa", S1, 10, 10),

  // emma : 9,99 partout (non valide), le reste à 12.
  ...sameOnEcues(G, "emma", ["E101A", "E101B"], 9.99, 9.99),
  ...sameOnEcues(G, "emma", ["E102A", "E102B", "E103A", "E103B"], 12, 12),

  // fatou : devoirs 0,4 / examen 16,4 valent exactement 10, le flottant dit 9,999999999999998 -> UE101 en échec à tort.
  ...sameOnEcues(G, "fatou", ["E101A", "E101B"], 0.4, 16.4),
  ...sameOnEcues(G, "fatou", ["E102A", "E102B", "E103A", "E103B"], 12, 12),

  // gael : examen manquant sur E103B -> UE103 en cours.
  ...sameOnEcues(G, "gael", ["E101A", "E101B", "E102A", "E102B", "E103A"], 12, 12),
  ...ecueGrades(G, "gael", "E103B", 15, null),

  // hawa : E101B = 3 (éliminatoire), validée manuellement par le jury -> UE101 validée.
  ...ecueGrades(G, "hawa", "E101A", 13, 13),
  ...ecueGrades(G, "hawa", "E101B", 3, 3),
  ...sameOnEcues(G, "hawa", ["E102A", "E102B", "E103A", "E103B"], 12, 12),

  // ibrahim : E102B = 0,2 / 8,2 vaut exactement 5 (non éliminatoire), le flottant dit 4,999999999999999 -> UE102 verrouillée à tort.
  ...ecueGrades(G, "ibrahim", "E102A", 18, 18),
  ...ecueGrades(G, "ibrahim", "E102B", 0.2, 8.2),
  ...sameOnEcues(G, "ibrahim", ["E101A", "E101B", "E103A", "E103B"], 12, 12),

  // jade : S1 réussi, S2 : échoue UE201 (12 crédits) -> 20 + 24 = 44 crédits.
  ...sameOnEcues(G, "jade", S1, 11.5, 11.5),
  ...sameOnEcues(G, "jade", ["E201A", "E201B"], 8, 8),
  ...sameOnEcues(G, "jade", ["E202A", "E202B", "E203A", "E203B", "E204A", "E204B"], 12, 12),
];

export default defineScenario({
  meta: {
    name: "bts-premiere-annee",
    title: "BTS 1re année : deux semestres, compensation, éliminatoire, seuil à 10, 20 crédits, > 48 crédits",
    description:
      "Onze étudiants de BTS 1re année (filière « Licence 1 ... » pour ouvrir le bulletin BTS) sur deux semestres de 20 et 36 crédits. " +
      "Couvre la compensation intra-UE, l'ECUE éliminatoire, la validation limite à 10 et 9,99, la validation manuelle par le jury, " +
      "l'UE incomplète, l'ex æquo au classement et le décalage entre la règle des 20 crédits et la règle réellement appliquée.",
    slices: ["2.4", "2.5", "2.6"],
    rules: [
      "Note ECUE = moyenne des devoirs x 0,4 + examen x 0,6 (devoirs absents = 0 ; sans examen, pas de note)",
      "Moyenne UE = somme(note ECUE x crédits ECUE) / somme(crédits ECUE) ; compensation à l'intérieur de l'UE seulement",
      "ECUE < 5 : éliminatoire, l'UE n'est pas validée même si sa moyenne dépasse 10 (sauf validation manuelle)",
      "Validation à 10 sur la valeur non arrondie : 10 valide, 9,99 non",
      "Semestre validé = toutes les UE validées (et non 20 crédits), aucune compensation entre UE",
      "Rang = nombre d'étudiants strictement meilleurs + 1 (ex æquo partagés)",
    ],
  },
  tenant: { slug: "char-bts1", name: "Établissement de test BTS" },
  students: [
    student("amina", "Amina", "Barry"),
    student("bako", "Bako", "Camara"),
    student("chloe", "Chloé", "Diallo"),
    student("drissa", "Drissa", "Keita"),
    student("emma", "Emma", "Sylla"),
    student("fatou", "Fatou", "Traoré"),
    student("gael", "Gaël", "Soumah"),
    student("hawa", "Hawa", "Bangoura"),
    student("ibrahim", "Ibrahim", "Condé"),
    student("jade", "Jade", "Touré"),
    student("kofi", "Kofi", "Mensah"),
  ],
  teachers: [teacher("prof-compta", "Marie", "Lenoir", "permanent")],
  higher: {
    higher: {
      programmes: [programme],
      groups: [
        {
          key: G,
          name: "BTS1 2025-2026",
          programme: "bts1",
          students: ["amina", "bako", "chloe", "drissa", "emma", "fatou", "gael", "hawa", "ibrahim", "jade", "kofi"],
          start: "2025-09-15",
          end: "2026-07-15",
          semesterLink: "ue",
          teaching: [{ ecue: "E101A", teacher: "prof-compta" }],
        },
      ],
      grades,
    },
    steps: [
      { do: "recompute", label: "calcul initial" },
      { do: "jury-validate", student: "hawa", ecue: "E101B", group: G, validated: true, label: "jury : hawa E101B" },
      // Session 2 des UE échouées du second semestre : toujours insuffisantes -> dette ; le bulletin devient consultable
      // (30, 28 et 24 crédits acquis sur 36 : au-dessus des 20 crédits de la fonction semestreValide, mais semestre non validé).
      { do: "enter-grade", grade: { student: "bako", group: G, ecue: "E204A", nature: "examen", value: 8, session: 2 }, label: "session 2 : bako E204A 8" },
      { do: "enter-grade", grade: { student: "bako", group: G, ecue: "E204B", nature: "examen", value: 8, session: 2 }, label: "session 2 : bako E204B 8" },
      { do: "enter-grade", grade: { student: "kofi", group: G, ecue: "E203A", nature: "examen", value: 7, session: 2 }, label: "session 2 : kofi E203A 7" },
      { do: "enter-grade", grade: { student: "kofi", group: G, ecue: "E203B", nature: "examen", value: 7, session: 2 }, label: "session 2 : kofi E203B 7" },
      { do: "enter-grade", grade: { student: "jade", group: G, ecue: "E201A", nature: "examen", value: 9, session: 2 }, label: "session 2 : jade E201A 9" },
      { do: "enter-grade", grade: { student: "jade", group: G, ecue: "E201B", nature: "examen", value: 9, session: 2 }, label: "session 2 : jade E201B 9" },
      { do: "generate-bulletins", semester: "S1", label: "bulletins S1" },
      { do: "generate-bulletins", semester: "S2", label: "bulletins S2" },
      { do: "observe", label: "final" },
    ],
  },
});
