/**
 * Justificatifs d'absence : une demande couvre une FENÊTRE de dates (maladie de trois jours), pas un pointage isolé.
 *
 *   PENDING -> ACCEPTED | REJECTED | WITHDRAWN (retrait par le déposant) ; ACCEPTED -> REVOKED (révocation motivée).
 *
 * L'acceptation applique l'excuse à tous les pointages ABSENT / LATE / EARLY_LEAVE de l'élève dans la fenêtre ;
 * la révocation restaure les statuts d'origine. Une décision ne s'efface pas : auteur, date et note sont conservés.
 * Fenêtre légale de dépôt (délai maximal) : décision de politique, hors module (R-07).
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, conflict, validation } from "./errors";
import { within } from "./dates";
import { StatusCode, type IsoDate, type JustificationStatus, type SubmitterKind, type Uuid } from "./types";

const TRANSITIONS: Readonly<Record<JustificationStatus, readonly JustificationStatus[]>> = Object.freeze({
  PENDING: ["ACCEPTED", "REJECTED", "WITHDRAWN"],
  ACCEPTED: ["REVOKED"],
  REJECTED: [],
  WITHDRAWN: [],
  REVOKED: [],
});

export function canTransitionJustification(from: JustificationStatus, to: JustificationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertJustificationTransition(from: JustificationStatus, to: JustificationStatus): Result<true, AppError> {
  if (canTransitionJustification(from, to)) return ok(true);
  const code = from === "PENDING" ? AttendanceCode.INVALID_TRANSITION : to === "REVOKED" ? AttendanceCode.JUSTIFICATION_NOT_ACCEPTED : AttendanceCode.JUSTIFICATION_NOT_PENDING;
  return err(conflict(code, `Transition de justificatif interdite : ${from} → ${to}.`, { from, to }));
}

export interface WindowCheckInput {
  readonly fromDate: IsoDate;
  readonly toDate: IsoDate;
  /** Jour courant de l'établissement. */
  readonly today: IsoDate;
  /** Bornes de l'année de l'inscription (si connues). */
  readonly yearStart: IsoDate | null;
  readonly yearEnd: IsoDate | null;
  /** Politique : un justificatif peut couvrir des dates futures (absence prévue), pour le personnel habilité. */
  readonly allowFuture: boolean;
  readonly kind: SubmitterKind;
}

/**
 * La fenêtre ne dépasse ni l'année de l'inscription ni le futur au-delà de la date du jour (sauf politique
 * `allowFuture` et déposant du personnel habilité).
 */
export function validateWindow(input: WindowCheckInput): Result<true, AppError> {
  if (input.toDate < input.fromDate) {
    return err(validation(AttendanceCode.JUSTIFICATION_WINDOW_INVALID, "La fin de la fenêtre précède son début.", "toDate"));
  }
  if (input.yearStart && input.fromDate < input.yearStart) {
    return err(validation(AttendanceCode.JUSTIFICATION_WINDOW_INVALID, "La fenêtre commence avant l'année scolaire de l'inscription.", "fromDate"));
  }
  if (input.yearEnd && input.toDate > input.yearEnd) {
    return err(validation(AttendanceCode.JUSTIFICATION_WINDOW_INVALID, "La fenêtre dépasse l'année scolaire de l'inscription.", "toDate"));
  }
  if (input.toDate > input.today && !(input.allowFuture && input.kind === "STAFF")) {
    return err(
      validation(AttendanceCode.JUSTIFICATION_FUTURE_NOT_ALLOWED, "Un justificatif ne peut pas couvrir des dates futures.", "toDate"),
    );
  }
  return ok(true);
}

export const windowCovers = (j: { fromDate: IsoDate; toDate: IsoDate }, date: IsoDate): boolean => within(date, j.fromDate, j.toDate);

export interface ExcuseFields {
  readonly statusCode: string;
  readonly originalStatusCode: string | null;
  readonly excused: boolean;
  readonly justificationId: Uuid | null;
}

/** Effet de la RÉVOCATION sur un pointage excusé : `EXCUSED` redevient son statut d'origine, le drapeau tombe. */
export function revokedFields(rec: { statusCode: string; originalStatusCode: string | null }): ExcuseFields {
  return {
    statusCode: rec.statusCode === StatusCode.EXCUSED ? (rec.originalStatusCode ?? StatusCode.ABSENT) : rec.statusCode,
    originalStatusCode: null,
    excused: false,
    justificationId: null,
  };
}

/** Effet de l'ACCEPTATION sur un pointage excusable. */
export function excusedFields(rec: { statusCode: string }, justificationId: Uuid): ExcuseFields {
  if (rec.statusCode === StatusCode.ABSENT) {
    return { statusCode: StatusCode.EXCUSED, originalStatusCode: StatusCode.ABSENT, excused: true, justificationId };
  }
  return { statusCode: rec.statusCode, originalStatusCode: null, excused: true, justificationId };
}
