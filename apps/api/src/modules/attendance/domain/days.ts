/**
 * Absences en JOURNÉES et jours ouverts d'une inscription (appel journalier, spec 005 §14.2 « 010 », règle `cas_absences`).
 *
 * Fonctions PURES. Aucun seuil, aucun pourcentage : le module ne fournit que des COMPTES de jours ; la décision
 * (`absences_journees * 100 > pourcentage * jours_ouverts`) appartient à la règle (RuleSet), jamais ici.
 */
import type { IsoDate, Uuid } from "./types";

/**
 * Comptes bruts d'une inscription (appels `DAILY` soumis ou validés de la fenêtre), en JOURNÉES. Avec l'appel du matin et de l'après-midi
 * (Q-P17), une demi-journée vaut 0,5 : les valeurs sont des multiples de 0,5 (entiers avec l'appel journalier unique).
 */
export interface DailyDayCounts {
  readonly calledDays: number;
  readonly presentDays: number;
  readonly absentDays: number;
  readonly excusedAbsentDays: number;
  readonly lateDays: number;
}

export const EMPTY_DAY_COUNTS: DailyDayCounts = Object.freeze({ calledDays: 0, presentDays: 0, absentDays: 0, excusedAbsentDays: 0, lateDays: 0 });

/** Origine du nombre de jours ouverts : jours d'appel tenus (par défaut) ou nombre fourni par l'appelant (calendrier). */
export type OpenDaysSource = "CALLED_DAYS" | "CALLER";

/** Entrées de la règle `cas_absences` (noms du contrat `rule-contract.md`). */
export interface CasAbsencesInputs {
  readonly absences_journees: number;
  readonly jours_ouverts: number;
}

export interface AttendanceDays {
  readonly enrollmentId: Uuid;
  readonly from: IsoDate;
  readonly to: IsoDate;
  /** Jours ouverts : jours d'appel journalier tenus (`CALLED_DAYS`) ou valeur du calendrier fournie (`CALLER`). */
  readonly openDays: number;
  readonly openDaysSource: OpenDaysSource;
  /** Journées d'absence TOTALES (justifiées comprises) ; `excusedAbsentDays` en est le sous-ensemble justifié. */
  readonly absentDays: number;
  readonly excusedAbsentDays: number;
  readonly unexcusedAbsentDays: number;
  readonly lateDays: number;
  readonly presentDays: number;
  readonly ruleInputs: CasAbsencesInputs;
}

export interface DaysOptions {
  /** Nombre de jours ouverts du calendrier de l'établissement (remplace les jours d'appel tenus). Entier ≥ 0. */
  readonly openDays?: number | undefined;
  /** `true` : `absences_journees` ne compte que les absences NON justifiées (défaut : toutes, justifiées comprises). */
  readonly excludeExcused?: boolean | undefined;
}

/** Vue d'une inscription à partir de ses comptes (`EMPTY_DAY_COUNTS` si aucun appel dans la fenêtre). */
export function buildAttendanceDays(enrollmentId: Uuid, window: { from: IsoDate; to: IsoDate }, counts: DailyDayCounts, options: DaysOptions = {}): AttendanceDays {
  const openDays = options.openDays ?? counts.calledDays;
  const unexcused = Math.max(0, counts.absentDays - counts.excusedAbsentDays);
  return {
    enrollmentId,
    from: window.from,
    to: window.to,
    openDays,
    openDaysSource: options.openDays === undefined ? "CALLED_DAYS" : "CALLER",
    absentDays: counts.absentDays,
    excusedAbsentDays: counts.excusedAbsentDays,
    unexcusedAbsentDays: unexcused,
    lateDays: counts.lateDays,
    presentDays: counts.presentDays,
    ruleInputs: { absences_journees: options.excludeExcused ? unexcused : counts.absentDays, jours_ouverts: openDays },
  };
}
