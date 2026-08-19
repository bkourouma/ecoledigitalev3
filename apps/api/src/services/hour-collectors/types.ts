import type { PoolClient } from "pg";
import type { HourSource } from "@ecoledigitale/contracts";

/**
 * Collecte des heures rémunérables — feature 031.
 *
 * POURQUOI CETTE ABSTRACTION
 * Le calculateur de paie savait chercher les heures à un seul endroit : la
 * chaîne académique (`teacher_attendance_sessions` → `teacher_assignments` →
 * `class_courses`). Les séances du Module Professionnel lui étaient invisibles.
 *
 * Plutôt qu'une seconde branche `if` dans une méthode déjà longue, la collecte
 * est extraite derrière cette interface. Trois bénéfices concrets :
 *   - chaque origine est testable seule (le chemin académique doit être
 *     re-validé sans régression, SC-009) ;
 *   - le calcul lui-même — semaines, heures supplémentaires, salaire, mixte —
 *     n'est pas touché ;
 *   - une 3ᵉ origine (formateurs, encadrement) s'ajouterait sans y revenir.
 *
 * Chaque collecteur fait UNE requête pour toute la période, tous enseignants
 * confondus : le calculateur itérait auparavant enseignant par enseignant, ce
 * qui ne tient pas à 100 enseignants × 500 séances (SC-006).
 */

/** Une heure rémunérable, quelle que soit son origine. */
export interface HourRecord {
  source: HourSource;
  teacherId: string;
  /** Date de la séance (YYYY-MM-DD). Détermine la période et la semaine. */
  sessionDate: string;
  /** Durée décimale en heures. */
  hours: number;

  /** Origine académique — id de la séance de présence enseignant. */
  attendanceSessionId?: string | null;
  /** Origine académique — cours rattaché, pour la tarification par cours. */
  courseId?: string | null;

  /** Origine professionnelle — id de la séance d'ECUE. */
  seanceId?: string | null;
  /** Origine professionnelle — ECUE, pour la tarification par ECUE. */
  ecueId?: string | null;
  ueSessionId?: string | null;

  /** Libellés d'affichage (bulletin, détail de paiement). */
  intitule?: string | null;
  code?: string | null;
  cohorteLibelle?: string | null;
}

/**
 * Le périmètre d'une collecte. Regroupé en objet plutôt qu'en paramètres
 * positionnels : `periodId` s'est ajouté après coup, et cinq chaînes à la
 * suite dont deux dates finissaient par s'inverser sans que rien ne le dise.
 */
export interface HourCollectionScope {
  tenantId: string;
  /** Bornes incluses, au format YYYY-MM-DD. */
  periodStart: string;
  periodEnd: string;
  /** Restreint le périmètre ; absent ou vide = tous les enseignants du tenant. */
  teacherIds?: string[];
  /**
   * Période en cours de calcul. Les heures déjà rattachées au bulletin d'une
   * AUTRE période sont écartées — voir `heures-consommees.ts`. Celles de la
   * période courante ne le sont pas : un recalcul réécrit son propre détail et
   * doit continuer à voir ses heures.
   */
  periodId: string;
}

export interface HourCollector {
  readonly source: HourSource;
  /**
   * Toutes les heures rémunérables de la période, heures déjà consommées par
   * un autre bulletin exclues.
   */
  collect(client: PoolClient, scope: HourCollectionScope): Promise<HourRecord[]>;
}
