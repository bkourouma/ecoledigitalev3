import { student, teacher } from "./helpers";
import {
  defineScenario,
  type AcademicSessionDecl,
  type ClassicSetup,
  type HigherSetup,
  type PayrollSetup,
  type PayrollStep,
  type SeanceDecl,
} from "./types";

/**
 * (f) Paie : enseignants permanent (salaire, mixte) et vacataire (horaire), séances académiques ET professionnelles,
 * états calculé -> approuvé -> payé, heures supplémentaires cumulées sur les deux origines, heures déjà consommées,
 * enseignants écartés (sans configuration, sans heure, sans tarif).
 *
 * Reprend le scénario S17-T (commit 230b03d, docs/testing/e2e-computer-use/scenarios/S17-T-paie-tenant-test-30091.md) :
 * Awa (10 000/h, seuil 40 h) a trois séances validées de 2,5 h + 3 h (volume comptable) et 0 h (annulée) = 5,5 h = 55 000 ;
 * Koné a une séance validée mais AUCUNE configuration : il est écarté du calcul.
 */

const P1 = "janvier";
const P2 = "janvier-bis";

const higher: HigherSetup = {
  programmes: [
    {
      key: "paie",
      name: "Licence 1 Paie",
      code: "L1PAIE",
      semesters: [],
      ues: [
        { key: "UE-COMPTA", code: "UE-COMPTA", label: "Comptabilité", declaredCredits: 8, ecues: ["E-COMPTA-G", "E-COMPTA-A"] },
        { key: "UE-DROIT", code: "UE-DROIT", label: "Droit", declaredCredits: 4, ecues: ["E-DROIT"] },
      ],
      ecues: [
        { key: "E-COMPTA-G", code: "PAIE-CG", label: "Comptabilité générale", credits: 4 },
        { key: "E-COMPTA-A", code: "PAIE-CA", label: "Comptabilité analytique", credits: 4 },
        { key: "E-DROIT", code: "PAIE-DC", label: "Droit civil", credits: 4 },
      ],
    },
  ],
  groups: [
    {
      key: "paie",
      name: "PAIE E2E",
      programme: "paie",
      students: [],
      start: "2026-01-01",
      end: "2026-06-30",
      status: "en_cours",
      teaching: [
        { ecue: "E-COMPTA-G", teacher: "awa" },
        { ecue: "E-COMPTA-A", teacher: "mixte" },
        { ecue: "E-DROIT", teacher: "kone" },
      ],
    },
  ],
  grades: [],
};

const classic: ClassicSetup = {
  academicYear: { name: "2025-2026", start: "2025-09-01", end: "2026-08-31" },
  programme: { key: "sec", name: "Programme secondaire", code: "SEC" },
  periods: [{ key: "T2", name: "Trimestre 2", start: "2026-01-01", end: "2026-03-31" }],
  courses: [
    { key: "MATH", code: "MATH", name: "Mathématiques", coefficient: 3, section: "Sciences" },
    { key: "FRAN", code: "FRAN", name: "Français", coefficient: 3, section: "Lettres" },
  ],
  classes: [{ key: "tle", name: "Terminale", students: [] }],
  averages: [],
};

const seances: SeanceDecl[] = [
  // Awa : le scénario S17-T. S1 (2 h prévues, corrigées à 2,5 h), S2 (3 h sans horaires), S3 annulée.
  { key: "s1", teacher: "awa", ecue: "E-COMPTA-G", group: "paie", date: "2026-01-05", start: "08:00", end: "10:00", status: "realisee" },
  { key: "s2", teacher: "awa", ecue: "E-COMPTA-G", group: "paie", date: "2026-01-31", paidVolume: 3, status: "realisee" },
  { key: "s3", teacher: "awa", ecue: "E-COMPTA-G", group: "paie", date: "2026-01-31", start: "14:00", end: "16:00", status: "annulee" },
  // Koné : séance validée, mais pas de configuration de paie.
  { key: "s5", teacher: "kone", ecue: "E-DROIT", group: "paie", date: "2026-01-31", start: "16:30", end: "17:30", status: "realisee" },
  // Mixte : 12 h professionnelles dans la semaine du 12/01 (tarif ECUE 9 000), s'ajoutent 4 h académiques.
  { key: "m1", teacher: "mixte", ecue: "E-COMPTA-A", group: "paie", date: "2026-01-12", start: "08:00", end: "12:00", status: "realisee", validated: true },
  { key: "m2", teacher: "mixte", ecue: "E-COMPTA-A", group: "paie", date: "2026-01-13", start: "08:00", end: "12:00", status: "realisee", validated: true },
  { key: "m3", teacher: "mixte", ecue: "E-COMPTA-A", group: "paie", date: "2026-01-14", start: "08:00", end: "12:00", status: "realisee", validated: true },
  // Vacataire sans tarif : ECUE sans tarif spécifique et configuration sans tarif par défaut.
  { key: "n1", teacher: "notarif", ecue: "E-DROIT", group: "paie", date: "2026-01-15", start: "08:00", end: "10:00", status: "realisee", validated: true },
  // Vacataire à 3 333,33, seuil 10 h : 5 h + 5 h + 4 h dans la semaine du 19/01 -> la 3e séance est ENTIÈREMENT en heures supplémentaires (3 333,33 x 1,5 = 4 999,995).
  { key: "c1", teacher: "cent", ecue: "E-COMPTA-G", group: "paie", date: "2026-01-19", start: "08:00", end: "13:00", status: "realisee", validated: true },
  { key: "c2", teacher: "cent", ecue: "E-COMPTA-G", group: "paie", date: "2026-01-20", start: "08:00", end: "13:00", status: "realisee", validated: true },
  { key: "c3", teacher: "cent", ecue: "E-COMPTA-G", group: "paie", date: "2026-01-21", start: "08:00", end: "12:00", status: "realisee", validated: true },
  // Mixte « sans accroc » : salaire + 2 séances de 2 h au tarif ECUE, très en dessous du seuil de 40 h.
  { key: "x1", teacher: "mixte2", ecue: "E-COMPTA-A", group: "paie", date: "2026-01-26", start: "08:00", end: "10:00", status: "realisee", validated: true },
  { key: "x2", teacher: "mixte2", ecue: "E-COMPTA-A", group: "paie", date: "2026-01-27", start: "08:00", end: "10:00", status: "realisee", validated: true },
  // Permanent salarié : une séance validée (informative, le salaire ne dépend pas des heures).
  { key: "d1", teacher: "diallo", ecue: "E-COMPTA-G", group: "paie", date: "2026-01-20", start: "14:00", end: "16:00", status: "realisee", validated: true },
  // Séance d'un autre mois : hors période.
  { key: "h1", teacher: "awa", ecue: "E-COMPTA-G", group: "paie", date: "2026-02-03", start: "08:00", end: "10:00", status: "realisee", validated: true },
];

const academicSessions: AcademicSessionDecl[] = [
  { key: "a1", teacher: "acad", course: "MATH", class: "tle", date: "2026-01-06", hours: 2, status: "completed" },
  { key: "a2", teacher: "acad", course: "FRAN", class: "tle", date: "2026-01-08", hours: 4, status: "completed" },
  { key: "a3", teacher: "acad", course: "FRAN", class: "tle", date: "2026-01-13", hours: 3, status: "cancelled" },
  { key: "a4", teacher: "mixte", course: "MATH", class: "tle", date: "2026-01-12", hours: 2, status: "completed" },
  { key: "a5", teacher: "mixte", course: "FRAN", class: "tle", date: "2026-01-13", hours: 2, status: "completed" },
];

const setup: PayrollSetup = {
  classic,
  higher,
  configs: [
    { teacher: "awa", type: "hourly", hourlyRate: 10000, overtimeThreshold: 40, from: "2025-09-01" },
    { teacher: "diallo", type: "salary", monthlySalary: 400000, from: "2025-09-01" },
    { teacher: "mixte", type: "mixed", monthlySalary: 200000, hourlyRate: 8000, overtimeThreshold: 10, overtimeMultiplier: 1.5, from: "2025-09-01" },
    { teacher: "mixte2", type: "mixed", monthlySalary: 100000, hourlyRate: 8000, overtimeThreshold: 40, from: "2025-09-01" },
    { teacher: "acad", type: "hourly", hourlyRate: 5000, overtimeThreshold: 40, from: "2025-09-01" },
    { teacher: "vide", type: "hourly", hourlyRate: 7000, from: "2025-09-01" },
    { teacher: "notarif", type: "hourly", from: "2025-09-01" },
    { teacher: "cent", type: "hourly", hourlyRate: 3333.33, overtimeThreshold: 10, overtimeMultiplier: 1.5, from: "2025-09-01" },
  ],
  rates: [
    { ecue: "E-COMPTA-A", amount: 9000, from: "2025-09-01" },
    { course: "MATH", amount: 6000, from: "2025-09-01" },
  ],
  academicSessions,
  seances,
  periods: [],
};

const steps: PayrollStep[] = [
  { do: "create-period", period: P1, name: "", start: "2026-01-05", end: "2026-01-31", label: "refus : nom vide" },
  { do: "create-period", period: P1, name: "Paie janvier", start: "2026-01-31", end: "2026-01-05", label: "refus : dates inversées" },
  { do: "create-period", period: P1, name: "Paie janvier", start: "2026-01-31", end: "2026-01-31", label: "refus : période d'un seul jour" },
  { do: "create-period", period: P1, name: "Paie janvier", start: "2026-01-05", end: "2026-01-31", label: "période collective créée" },
  { do: "create-period", period: P2, name: "Paie bis", start: "2026-01-05", end: "2026-01-31", label: "refus : une période est déjà en attente" },
  { do: "set-paid-volume", seance: "s1", volume: 2.5, label: "volume comptable s1 : 2 h -> 2,5 h" },
  { do: "set-paid-volume", seance: "s2", volume: null, label: "refus : retirer le volume d'une séance sans horaires" },
  { do: "set-paid-volume", seance: "s2", volume: 0, label: "refus : volume nul" },
  { do: "validate-seances", seances: ["s1", "s2", "s3", "s5"], validated: true, label: "validation en lot s1 s2 s3 s5 (s3 annulée refusée)" },
  { do: "calculate", period: P1, dryRun: true, label: "aperçu du calcul" },
  { do: "calculate", period: P1, label: "calcul réel" },
  { do: "calculate", period: P1, label: "second calcul sans recalcul : bulletins existants" },
  { do: "adjust", period: P1, teacher: "awa", bonus: 5000, deductions: 2000, label: "ajustement awa : prime 5 000, retenue 2 000" },
  { do: "calculate", period: P1, recalculate: true, label: "recalcul : les ajustements sont-ils conservés ?" },
  { do: "adjust", period: P1, teacher: "awa", bonus: 5000, deductions: 2000, label: "ajustement awa rétabli" },
  { do: "approve", period: P1, teachers: ["awa", "diallo"], label: "approbation awa et diallo" },
  { do: "calculate", period: P1, recalculate: true, label: "recalcul : les bulletins approuvés sont verrouillés" },
  { do: "adjust", period: P1, teacher: "awa", bonus: 100, label: "refus : ajustement d'un bulletin approuvé" },
  { do: "set-seance-status", seance: "s1", status: "annulee", label: "refus : annuler une séance déjà rattachée à un bulletin approuvé" },
  { do: "pay", period: P1, teachers: ["awa"], via: "verser", label: "versement awa" },
  { do: "pay", period: P1, teachers: ["awa"], via: "verser", label: "second versement awa : idempotent" },
  { do: "pay", period: P1, teachers: ["diallo"], via: "bulk-action", label: "versement diallo par action groupée" },
  { do: "pay", period: P1, teachers: ["acad"], via: "bulk-action", label: "refus : verser un bulletin non approuvé (acad)" },
  { do: "cancel", period: P1, teachers: ["acad"], label: "annulation du bulletin acad" },
  { do: "create-period", period: P2, name: "Paie bis", start: "2026-01-05", end: "2026-01-31", label: "seconde période sur les mêmes dates" },
  { do: "calculate", period: P2, label: "calcul de la seconde période : heures déjà consommées exclues, heures annulées relâchées, salaire reconduit" },
  { do: "cancel", period: P2, teachers: ["diallo", "mixte2"], label: "annulation des seconds salaires (diallo, mixte2)" },
  { do: "force-status", period: P1, teacher: "acad", status: "paid", label: "PATCH status : annulé -> payé" },
  { do: "force-status", period: P2, teacher: "acad", status: "paid", label: "PATCH status : calculé -> payé sans approbation" },
  { do: "archive", label: "archivage de tout ce qui reste (y compris les bulletins annulés)" },
];

export default defineScenario({
  meta: {
    name: "paie-enseignants",
    title: "Paie : permanent et vacataires, séances académiques et professionnelles, calculé -> approuvé -> payé",
    description:
      "Neuf enseignants (permanents salariés ou mixtes, vacataires horaires) et deux origines d'heures : séances de présence enseignant (pile classique) " +
      "et séances d'ECUE (pile Professional). Rejoue le parcours S17-T (période, volume comptable, validation en lot partielle, calcul, ajustements, " +
      "approbation, versement) puis les verrous (recalcul d'un bulletin approuvé, heures consommées, annulation) et les routes qui les contournent.",
    slices: ["2.3", "2.7"],
    rules: [
      "Un enseignant a UN SEUL bulletin par période, quelles que soient les origines de ses heures",
      "Heures supplémentaires = fraction hebdomadaire (semaine du lundi) au-delà du seuil, cumulée sur les deux origines ; majorées par le multiplicateur",
      "Tarif d'une heure : tarif ECUE (professionnel) ou tarif de cours (académique), sinon tarif par défaut de la configuration ; aucun tarif = enseignant écarté",
      "Salaire = salaire mensuel x jours ouvrés de la période / jours ouvrés du mois ; mixte = salaire + heures",
      "Une séance n'est payable que réalisée ET validée, avec un enseignant et une durée (horaires ou volume comptable) ; la durée payée l'emporte sur les horaires",
      "Une heure ne se paie qu'une fois : exclue dès qu'un bulletin non annulé d'une AUTRE période la porte",
      "Un bulletin approuvé, payé ou annulé n'est jamais recalculé ni ajusté ; un enseignant sans heure validée n'a pas de bulletin",
      "Statuts : calculated -> approved -> paid (cancelled / disputed hors circuit)",
    ],
  },
  tenant: { slug: "char-paie", name: "Établissement de test paie" },
  students: [student("eleve", "Élève", "Paie")],
  teachers: [
    teacher("awa", "Awa", "Sanogo", "vacataire"),
    teacher("kone", "Ibrahim", "Koné", "vacataire"),
    teacher("diallo", "Aissatou", "Diallo", "permanent"),
    teacher("mixte", "Marc", "Mixte", "permanent"),
    teacher("mixte2", "Maya", "Mixte", "permanent"),
    teacher("acad", "Alice", "Academique", "vacataire"),
    teacher("vide", "Victor", "Sansheure", "vacataire"),
    teacher("notarif", "Nora", "Sanstarif", "vacataire"),
    teacher("cent", "Cédric", "Centime", "vacataire"),
  ],
  payroll: { setup, steps },
});
