/**
 * Scénarios DÉCLARATIFS de caractérisation.
 *
 * Ces types décrivent un monde académique (élèves, filières, UE/ECUE, évaluations, périodes, séances,
 * enseignants) SANS référence au schéma legacy : ni nom de table, ni colonne, ni statut SQL. Chaque seeder
 * (le seeder legacy de ce dossier, puis le seeder v2 de la Phase 2) traduit le même scénario dans son
 * propre modèle ; les sorties observées sont alors comparées aux snapshots.
 *
 * Règles de rédaction :
 *   - tout est sérialisable en JSON (pas de fonction, pas de Date) ; les dates sont `YYYY-MM-DD` ;
 *   - toute entité porte une `key` stable, unique dans sa nature : c'est l'alias lisible qui remplace les
 *     UUID dans les snapshots (`student:amina`) et le chemin des « défauts connus » ;
 *   - les notes sont exprimées /20 par défaut (`max`) ; les notes manquantes sont simplement absentes ;
 *   - les `steps` décrivent ce qu'on FAIT au scénario (calculer, saisir une note, clôturer...) ; les
 *     observations qu'on en tire sont consignées dans la snapshot sous le nom de l'étape.
 */

export type Key = string;
export type IsoDate = string; // YYYY-MM-DD

export interface ScenarioMeta {
  /** Nom du fichier sans suffixe (`bts-premiere-annee`). */
  name: string;
  title: string;
  description: string;
  /** Tranches de la Phase 2 couvertes (2.1 ... 2.8). */
  slices: string[];
  /** Règles métier figées, en une phrase chacune (sert au README et au rapport de couverture). */
  rules: string[];
}

export interface StudentDecl {
  key: Key;
  firstName: string;
  lastName: string;
  gender?: "masculin" | "feminin";
  birthDate?: IsoDate;
  birthPlace?: string;
  /** Matricule d'établissement (numéro étudiant). */
  studentNumber?: string;
  repeating?: boolean;
}

export interface TeacherDecl {
  key: Key;
  firstName: string;
  lastName: string;
  /** `permanent` = salarié de l'établissement ; `vacataire` = payé à l'heure. */
  status: "permanent" | "vacataire";
  email?: string;
}

/* ------------------------------------------------------------------ */
/* Enseignement supérieur : BTS / Licence / LMD (pile « Professional »)  */
/* ------------------------------------------------------------------ */

export type UeCategory = "fondamentale" | "specialite" | "culture_generale";

export interface EcueDecl {
  key: Key;
  code: string;
  label: string;
  /** Crédits de l'ECUE = poids dans la moyenne de l'UE. `null` = non renseigné. */
  credits: number | null;
}

export interface UeDecl {
  key: Key;
  code: string;
  label: string;
  /** Crédits « déclarés » de l'UE (UV acquises à la validation). Distincts de la somme des ECUE dans le legacy. */
  declaredCredits: number;
  category?: UeCategory;
  /** ECUE de l'UE, dans l'ordre d'affichage. */
  ecues: Key[];
  /** `true` : UE de conduite (note unique /20 saisie sur son ECUE, hors moyennes de matière). */
  conduct?: boolean;
}

export interface SemesterDecl {
  key: Key;
  label: string;
  ues: Key[];
}

export interface ProgrammeDecl {
  key: Key;
  name: string;
  code: string;
  domain?: string;
  semesters: SemesterDecl[];
  ues: UeDecl[];
  ecues: EcueDecl[];
}

/** Promotion : un groupe d'étudiants suivant les UE d'un semestre sur une période. */
export interface ClassGroupDecl {
  key: Key;
  name: string;
  programme: Key;
  students: Key[];
  start: IsoDate;
  end: IsoDate;
  /** Statut des cohortes (une par UE). Défaut `en_cours`. */
  status?: "ouvert" | "en_cours" | "termine" | "annule";
  /**
   * Rattachement semestre -> cohortes : par l'UE (modèle courant), par la cohorte (modèle historique) ou les deux.
   * Les deux chemins existent en production et sont toujours parcourus ensemble par le legacy.
   */
  semesterLink?: "ue" | "session" | "both";
  /** Affectation des enseignants aux ECUE de la promotion. */
  teaching?: { ecue: Key; teacher: Key }[];
}

export type GradeNature = "devoir" | "examen";

export interface GradeDecl {
  student: Key;
  /** ECUE notée. */
  ecue: Key;
  /** Promotion dont la cohorte porte la note. */
  group: Key;
  nature: GradeNature;
  value: number;
  /** Barème (défaut 20). */
  max?: number;
  /** 1 = session normale, 2 = rattrapage (la session 2 REMPLACE l'examen de la session 1). */
  session?: 1 | 2;
  label?: string;
  /**
   * `manual` : saisie directe par ECUE ; `assessment` : évaluation (devoir/examen en ligne) avec copie notée,
   * captée automatiquement. Défaut `manual`.
   */
  via?: "manual" | "assessment";
}

export interface AttendanceDecl {
  student: Key;
  group: Key;
  ecue: Key;
  date: IsoDate;
  status: "present" | "absent" | "excused" | "late";
}

export interface HigherSetup {
  programmes: ProgrammeDecl[];
  groups: ClassGroupDecl[];
  grades: GradeDecl[];
  attendance?: AttendanceDecl[];
}

/* ------------------------------------------------------------------ */
/* Pile « classique » : classes, matières à coefficient, moyennes saisies */
/* ------------------------------------------------------------------ */

export interface ClassicCourseDecl {
  key: Key;
  code: string;
  name: string;
  coefficient: number;
  /** Section du bulletin (type de bilan). */
  section?: string;
}

export interface ClassicPeriodDecl {
  key: Key;
  name: string;
  start: IsoDate;
  end: IsoDate;
  /**
   * Rôle SÉMANTIQUE de la période, indépendant de son nom : c'est la règle métier (« moyenne annuelle = (S1 + 2·S2)/3 au
   * deuxième semestre »). Le legacy, lui, devine le rôle d'après le nom (voir CLASSIC_SEMESTER_DETECTED_BY_NAME).
   */
  role?: "first-semester" | "second-semester" | "other";
}

export interface ClassicClassDecl {
  key: Key;
  name: string;
  students: Key[];
  /** Classe de 2e année de BTS (sémantique) : au 2e semestre, la décision de fin d'année est « Redouble en cas d'échec au BTS ». */
  finalYearBts?: boolean;
}

export interface ClassicSetup {
  academicYear: { name: string; start: IsoDate; end: IsoDate };
  programme: { key: Key; name: string; code: string };
  periods: ClassicPeriodDecl[];
  courses: ClassicCourseDecl[];
  classes: ClassicClassDecl[];
  /** Moyennes de période SAISIES par matière (le legacy ne les calcule pas à partir d'évaluations). */
  averages: { class: Key; student: Key; course: Key; period: Key; value: number }[];
  /** Heures d'absence de la période (récapitulatif de bulletin). */
  absences?: { class: Key; student: Key; period: Key; absenceHours: number; justifiedHours: number }[];
}

/* ------------------------------------------------------------------ */
/* Paie des enseignants                                                */
/* ------------------------------------------------------------------ */

export interface PayConfigDecl {
  teacher: Key;
  type: "salary" | "hourly" | "mixed";
  monthlySalary?: number;
  hourlyRate?: number;
  /** Heures hebdomadaires au-delà desquelles les heures sont supplémentaires (défaut 40). */
  overtimeThreshold?: number;
  overtimeMultiplier?: number;
  from: IsoDate;
  to?: IsoDate;
}

export interface PayPeriodDecl {
  key: Key;
  name: string;
  start: IsoDate;
  end: IsoDate;
  /** Périmètre ciblé (vide = tous les enseignants). */
  teachers?: Key[];
}

/** Séance de cours « académique » : présence enseignant (pile classique), durée en heures entières. */
export interface AcademicSessionDecl {
  key: Key;
  teacher: Key;
  course: Key;
  class: Key;
  date: IsoDate;
  hours: number;
  status: "completed" | "cancelled";
}

/** Séance d'ECUE (pile Professional). */
export interface SeanceDecl {
  key: Key;
  teacher: Key;
  ecue: Key;
  group: Key;
  date: IsoDate;
  start?: string; // HH:MM
  end?: string;
  /** Volume horaire comptable (dérogation) en heures. */
  paidVolume?: number;
  status: "planifiee" | "realisee" | "annulee";
  /** Séance validée pour la paie. */
  validated?: boolean;
}

export interface RateDecl {
  /** ECUE (pile Professional) ou matière (pile classique). */
  ecue?: Key;
  course?: Key;
  teacher?: Key;
  amount: number;
  from: IsoDate;
  to?: IsoDate;
}

export interface PayrollSetup {
  /** Pile classique nécessaire aux séances académiques (cours, classe). */
  classic?: ClassicSetup;
  /** Pile Professional nécessaire aux séances d'ECUE. */
  higher?: HigherSetup;
  configs: PayConfigDecl[];
  rates: RateDecl[];
  academicSessions: AcademicSessionDecl[];
  seances: SeanceDecl[];
  periods: PayPeriodDecl[];
}

/* ------------------------------------------------------------------ */
/* Étapes                                                               */
/* ------------------------------------------------------------------ */

export type Step =
  /** Recalcule les résultats de TOUTES les cohortes (ECUE, UE). */
  | { do: "recompute"; label?: string }
  /** Validation manuelle (jury) d'un résultat d'ECUE. */
  | { do: "jury-validate"; student: Key; ecue: Key; group: Key; validated: boolean; label?: string }
  /** Saisie d'une note après coup (peut être refusée : clôture, barème...). */
  | { do: "enter-grade"; grade: GradeDecl; label: string }
  /** Modifie la dernière note manuelle (devoir) d'un étudiant sur une ECUE. */
  | { do: "update-grade"; student: Key; ecue: Key; group: Key; nature: GradeNature; value: number; label: string }
  | { do: "delete-grade"; student: Key; ecue: Key; group: Key; nature: GradeNature; label: string }
  /** Génère (ou régénère) les bulletins de tout un semestre. */
  | { do: "generate-bulletins"; semester: Key; label: string }
  /** Clôture les bulletins d'un semestre (verrou de saisie). */
  | { do: "close-bulletins"; semester: Key; label: string }
  /** Clôture les NOTES d'un semestre (cohortes terminées) - geste distinct de la clôture des bulletins. */
  | { do: "close-grades"; semester: Key; label: string }
  /**
   * Correction d'une copie d'évaluation déjà déclarée (`via: "assessment"`), suivie de la réintégration automatique de la note
   * dans le résultat d'ECUE (comme le fait la route). Refusée si le semestre de la cohorte est clôturé.
   */
  | { do: "grade-evaluation"; student: Key; ecue: Key; group: Key; nature: GradeNature; value: number; label: string }
  /** Collecte les observations finales (résultats, bulletins, rangs, rattrapages...). */
  | { do: "observe"; label: string };

export interface HigherScenario {
  higher: HigherSetup;
  /** Étapes jouées dans l'ordre. L'observation finale est toujours ajoutée. */
  steps: Step[];
}

export type ClassicStep =
  | { do: "report"; class: Key; period: Key; student?: Key; label: string }
  | { do: "matrix"; class: Key; period: Key; label: string }
  | { do: "put-matrix"; class: Key; period: Key; cells: { student: Key; course: Key; value: number | null }[]; absences?: { student: Key; absenceHours: number | null; justifiedHours: number | null }[]; label: string };

export type PayrollStep =
  /** Crée une période de paie (nom, dates ; périmètre ciblé facultatif). `periodStart/End` vides = refus de validation attendu. */
  | { do: "create-period"; period: Key; name: string; start?: IsoDate; end?: IsoDate; teachers?: Key[]; label: string }
  | { do: "validate-seances"; seances: Key[]; validated: boolean; label: string }
  | { do: "set-paid-volume"; seance: Key; volume: number | null; label: string }
  | { do: "set-seance-status"; seance: Key; status: "planifiee" | "realisee" | "annulee"; label: string }
  | { do: "calculate"; period: Key; dryRun?: boolean; recalculate?: boolean; scope?: "all" | "academique" | "professionnel"; teachers?: Key[]; label: string }
  | { do: "adjust"; period: Key; teacher: Key; bonus?: number; deductions?: number; label: string }
  | { do: "approve"; period: Key; teachers?: Key[]; label: string }
  /** Archivage (« arrêter » le bulletin) : `teachers` absent = tous les bulletins non archivés du tenant. */
  | { do: "archive"; teachers?: Key[]; period?: Key; label: string }
  /** Versement : `verser` (écran des bulletins) ou `bulk-action` (mark_paid). */
  | { do: "pay"; period: Key; teachers?: Key[]; via?: "verser" | "bulk-action"; label: string }
  | { do: "cancel"; period: Key; teachers?: Key[]; label: string }
  | { do: "force-status"; period: Key; teacher: Key; status: "calculated" | "approved" | "paid" | "cancelled"; label: string };

export interface Scenario {
  meta: ScenarioMeta;
  students: StudentDecl[];
  teachers: TeacherDecl[];
  /** Établissement de test. */
  tenant: { slug: string; name: string };
  higher?: HigherScenario;
  classic?: { setup: ClassicSetup; steps: ClassicStep[] };
  payroll?: { setup: PayrollSetup; steps: PayrollStep[] };
}

export function defineScenario(s: Scenario): Scenario {
  return s;
}
