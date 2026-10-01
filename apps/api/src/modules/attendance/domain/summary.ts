/**
 * Récapitulatif par inscription et période : DÉRIVÉ des pointages (cache recalculé), avec SURCHARGE tracée.
 *
 * `absent*` = absences TOTALES (justifiées comprises) ; `excused*` = sous-ensemble justifié. Le texte
 * « N heure(s) d'absence dont M justifiée(s) » du bulletin s'obtient donc sans calcul supplémentaire.
 *
 * `computeSummary` est le MIROIR EXACT de la fonction SQL `attendance.summarize_enrollment` (0903) : un test de
 * conformité compare les deux sur les mêmes données. Aucun seuil ici.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, validation } from "./errors";
import { EMPTY_SUMMARY, StatusCode, type IsoDate, type SessionStatus, type StatusIndex, type SummaryCounts, type SummaryOverride } from "./types";

export interface SummaryRecordInput {
  readonly sessionStatus: SessionStatus;
  readonly sessionDate: IsoDate;
  readonly statusCode: string;
  readonly excused: boolean;
  readonly minutesLate: number | null;
  readonly countedMinutes: number | null;
}

/** Comptage brut par famille de statut sur `[window.from, window.to]`. Seules les séances SUBMITTED / VALIDATED comptent (R8). */
export function computeSummary(records: readonly SummaryRecordInput[], defs: StatusIndex, window: { from: IsoDate; to: IsoDate }): SummaryCounts {
  let sessionsTotal = 0;
  let present = 0;
  let absent = 0;
  let excused = 0;
  let late = 0;
  let excusedLate = 0;
  let earlyLeave = 0;
  let absentMinutes = 0;
  let excusedMinutes = 0;
  let lateMinutes = 0;

  for (const r of records) {
    if (r.sessionStatus !== "SUBMITTED" && r.sessionStatus !== "VALIDATED") continue;
    if (r.sessionDate < window.from || r.sessionDate > window.to) continue;
    const def = defs.get(r.statusCode);
    if (!def) continue; // la jointure SQL est interne : un statut sans définition ne compte pas
    sessionsTotal += 1;
    if (def.countsAsPresent) present += 1;
    if (def.countsAsAbsence) {
      absent += 1;
      absentMinutes += r.countedMinutes ?? 0;
      if (r.excused) {
        excused += 1;
        excusedMinutes += r.countedMinutes ?? 0;
      }
    }
    if (def.countsAsLate) {
      late += 1;
      lateMinutes += r.minutesLate ?? r.countedMinutes ?? 0;
      if (r.excused) excusedLate += 1;
    }
    if (r.statusCode === StatusCode.EARLY_LEAVE) earlyLeave += 1;
  }
  return {
    sessionsTotal,
    presentCount: present,
    absentCount: absent,
    excusedCount: excused,
    lateCount: late,
    excusedLateCount: excusedLate,
    earlyLeaveCount: earlyLeave,
    // Réservé : l'appel soumis couvre tout le roster (les non marqués reçoivent le statut par défaut), un élève
    // inscrit après la séance n'est pas « non pointé » (R2).
    unmarkedCount: 0,
    absentMinutes,
    excusedMinutes,
    lateMinutes,
  };
}

/** Valeur EFFECTIVE : la surcharge remplace les minutes d'absence ; sinon le dérivé. */
export function effectiveSummary(derived: SummaryCounts | null, override: Pick<SummaryOverride, "absentMinutes" | "excusedMinutes"> | null): SummaryCounts {
  const base = derived ?? EMPTY_SUMMARY;
  if (!override) return base;
  return { ...base, absentMinutes: override.absentMinutes, excusedMinutes: override.excusedMinutes };
}

export interface OverrideInput {
  readonly absentMinutes: number;
  readonly excusedMinutes: number;
  readonly reason: string;
}

/** Surcharge : motif >= 5 caractères, entiers >= 0, `excused <= absent` (CHECK de la table). */
export function validateOverride(input: OverrideInput): Result<OverrideInput, AppError> {
  const reason = input.reason.trim();
  if (reason.length < 5) return err(validation(AttendanceCode.OVERRIDE_INVALID, "Le motif de la surcharge doit faire au moins 5 caractères.", "reason"));
  if (!Number.isInteger(input.absentMinutes) || input.absentMinutes < 0) {
    return err(validation(AttendanceCode.OVERRIDE_INVALID, "Les minutes d'absence sont un entier positif ou nul.", "absentMinutes"));
  }
  if (!Number.isInteger(input.excusedMinutes) || input.excusedMinutes < 0) {
    return err(validation(AttendanceCode.OVERRIDE_INVALID, "Les minutes justifiées sont un entier positif ou nul.", "excusedMinutes"));
  }
  if (input.excusedMinutes > input.absentMinutes) {
    return err(validation(AttendanceCode.OVERRIDE_INVALID, "Les minutes justifiées ne peuvent pas dépasser les minutes d'absence.", "excusedMinutes"));
  }
  return ok({ absentMinutes: input.absentMinutes, excusedMinutes: input.excusedMinutes, reason });
}

/** Taux d'absence en points de base (10 000 = 100 %), arrondi au plus proche ; 0 si aucune séance. */
export function absenceRateBps(sessionsTotal: number, absentCount: number): number {
  if (sessionsTotal <= 0) return 0;
  return Math.floor((absentCount * 20_000 + sessionsTotal) / (2 * sessionsTotal));
}

export function sameCounts(a: SummaryCounts, b: SummaryCounts): boolean {
  return (Object.keys(a) as Array<keyof SummaryCounts>).every((k) => a[k] === b[k]);
}
