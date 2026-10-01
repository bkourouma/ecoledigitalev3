/**
 * Présence quotidienne et congés du personnel (PRD §33, absents du legacy).
 *
 *   congé : REQUESTED -> APPROVED | REJECTED | CANCELLED ; APPROVED -> CANCELLED.
 *   Deux congés APPROUVÉS d'un même membre ne se chevauchent pas (contrainte d'exclusion en base).
 *   `ON_LEAVE` exige un congé approuvé ; un jour de congé approuvé impose `ON_LEAVE` (correction explicite possible).
 *   Le statut du personnel (009) n'est JAMAIS modifié par un congé : l'approbation publie un événement.
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, conflict, validation } from "./errors";
import { overlapDays } from "./dates";
import { StatusCode, type IsoDate, type LeaveStatus, type Uuid } from "./types";

const LEAVE_TRANSITIONS: Readonly<Record<LeaveStatus, readonly LeaveStatus[]>> = Object.freeze({
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["CANCELLED"],
  REJECTED: [],
  CANCELLED: [],
});

export function assertLeaveTransition(from: LeaveStatus, to: LeaveStatus): Result<true, AppError> {
  if (LEAVE_TRANSITIONS[from].includes(to)) return ok(true);
  return err(conflict(AttendanceCode.INVALID_TRANSITION, `Transition de congé interdite : ${from} → ${to}.`, { from, to }));
}

export interface LeaveWindow {
  readonly startsOn: IsoDate;
  readonly endsOn: IsoDate;
}

export function validateLeaveWindow(w: LeaveWindow): Result<true, AppError> {
  if (w.endsOn < w.startsOn) return err(validation(AttendanceCode.INVALID_INPUT, "La fin du congé précède son début.", "endsOn"));
  return ok(true);
}

export interface ApprovedLeaveRef extends LeaveWindow {
  readonly id: Uuid;
}

/**
 * Statut de présence du personnel pour un jour donné :
 *  - `ON_LEAVE` demandé : un congé approuvé doit couvrir le jour (sinon refus) ; il est rattaché au pointage ;
 *  - un autre statut un jour de congé approuvé : refusé, sauf correction explicite (`overrideLeave`).
 */
export function resolveStaffStatus(input: {
  requested: string;
  workDate: IsoDate;
  approvedLeave: ApprovedLeaveRef | null;
  overrideLeave: boolean;
}): Result<{ statusCode: string; leaveId: Uuid | null }, AppError> {
  const { requested, approvedLeave, overrideLeave } = input;
  if (requested === StatusCode.ON_LEAVE) {
    if (!approvedLeave) {
      return err(validation(AttendanceCode.ON_LEAVE_REQUIRES_LEAVE, "Le statut « en congé » exige un congé approuvé couvrant ce jour.", "statusCode"));
    }
    return ok({ statusCode: requested, leaveId: approvedLeave.id });
  }
  if (approvedLeave && !overrideLeave) {
    return err(
      conflict(AttendanceCode.STAFF_ON_APPROVED_LEAVE, "Ce jour est couvert par un congé approuvé : le statut « en congé » s'applique (correction explicite requise).", {
        leaveId: approvedLeave.id,
      }),
    );
  }
  return ok({ statusCode: requested, leaveId: null });
}

/** Jours de congé (calendaires) d'une liste de congés approuvés compris dans `[from, to]`. */
export function approvedLeaveDaysWithin(leaves: readonly LeaveWindow[], from: IsoDate, to: IsoDate): number {
  return leaves.reduce((n, l) => n + overlapDays(l.startsOn, l.endsOn, from, to), 0);
}
