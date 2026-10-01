/**
 * Erreurs métier du module scheduling. Chaque code est STABLE (contrat d'API) et préfixé `scheduling.`.
 * Les messages sont en français et destinés à l'utilisateur ; les `details` sont structurés.
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";
import type { ConflictView } from "./conflicts";

export const SchedulingCodes = {
  conflictDetected: "scheduling.conflict_detected",
  equipmentConflict: "scheduling.equipment_conflict",
  roomUnavailable: "scheduling.room_unavailable",
  equipmentUnavailable: "scheduling.equipment_unavailable",
  occurrenceValidated: "scheduling.occurrence_validated",
  occurrenceLocked: "scheduling.occurrence_locked",
  occurrenceCancelled: "scheduling.occurrence_cancelled",
  hoursLocked: "scheduling.hours_locked",
  hoursAlreadyLocked: "scheduling.hours_already_locked",
  hoursNotPayable: "scheduling.hours_not_payable",
  invalidTransition: "scheduling.invalid_transition",
  notValidatable: "scheduling.not_validatable",
  selfValidationForbidden: "scheduling.self_validation_forbidden",
  timetableNotEditable: "scheduling.timetable_not_editable",
  timetableNotPublished: "scheduling.timetable_not_published",
  timetableAlreadyPublished: "scheduling.timetable_already_published",
  timetableHasConflicts: "scheduling.timetable_has_conflicts",
  invalidEntry: "scheduling.invalid_entry",
  invalidWindow: "scheduling.invalid_window",
  staffNotEligible: "scheduling.staff_not_eligible",
  offeringNotSchedulable: "scheduling.offering_not_schedulable",
  academicUnavailable: "scheduling.academic_unavailable",
  peopleUnavailable: "scheduling.people_unavailable",
  concurrentUpdate: "scheduling.concurrent_update",
  duplicate: "scheduling.duplicate",
  notFound: "scheduling.not_found",
  referenceMissing: "scheduling.reference_missing",
  notAssigned: "scheduling.not_assigned",
  tokenInvalid: "scheduling.token_invalid",
  overrideReasonRequired: "scheduling.override_reason_required",
  reasonRequired: "scheduling.reason_required",
} as const;

export function conflictDetected(conflicts: readonly ConflictView[], extra?: Record<string, unknown>): ConflictError {
  const blocking = conflicts.filter((c) => c.severity === "BLOCKING");
  const first = blocking[0];
  const message =
    blocking.length === 0
      ? "Conflit de planification détecté."
      : blocking.length === 1
        ? (first as ConflictView).message
        : `${blocking.length} conflits de planification : ${blocking.map((c) => c.message).join(" ; ")}`;
  return new ConflictError(message, {
    code: SchedulingCodes.conflictDetected,
    details: { conflicts: blocking.map(toDetail), ...extra },
  });
}

function toDetail(c: ConflictView): Record<string, unknown> {
  return {
    code: c.code,
    severity: c.severity,
    resourceKind: c.resourceKind,
    resourceId: c.resourceId,
    message: c.message,
    ...(c.with ? { with: c.with } : {}),
  };
}

export const hoursLocked = (lockRef: string | null, details?: Record<string, unknown>): ConflictError =>
  new ConflictError("Des heures de cette séance sont verrouillées par la paie : elle ne peut plus être modifiée.", {
    code: SchedulingCodes.hoursLocked,
    details: { ...(lockRef ? { lockRef } : {}), ...details },
  });

export const occurrenceValidated = (): ConflictError =>
  new ConflictError("La séance est validée pour la paie : dévalidez-la avant de la modifier.", { code: SchedulingCodes.occurrenceValidated });

export const occurrenceCancelled = (): ConflictError =>
  new ConflictError("La séance est annulée : restaurez-la avant de la modifier.", { code: SchedulingCodes.occurrenceCancelled });

export const invalidTransition = (from: string, to: string): ConflictError =>
  new ConflictError(`Passage de l'état ${from} à l'état ${to} interdit.`, { code: SchedulingCodes.invalidTransition, details: { from, to } });

export const notFound = (resource: string, id?: string): NotFoundError =>
  NotFoundError.of(resource, id, { code: SchedulingCodes.notFound });

export const reasonRequired = (what: string): ValidationError =>
  new ValidationError("Un motif est requis.", [{ path: ["reason"], message: `Un motif est requis pour ${what}.`, code: "reason_required" }], {
    code: SchedulingCodes.reasonRequired,
  });

export const academicUnavailable = (): InternalError =>
  new InternalError("Le référentiel des classes n'est pas disponible : aucune séance liée à une classe ne peut être écrite.", {
    code: SchedulingCodes.academicUnavailable,
  });

export const selfValidationForbidden = (): ForbiddenError =>
  new ForbiddenError("Validation « à quatre yeux » : celui qui a saisi une séance comptable ne peut pas la valider.", {
    code: SchedulingCodes.selfValidationForbidden,
  });

export const invalidWindow = (message: string, details?: Record<string, unknown>): ValidationError =>
  new ValidationError(message, [{ path: ["window"], message, code: "invalid_window" }], {
    code: SchedulingCodes.invalidWindow,
    ...(details ? { details } : {}),
  });
