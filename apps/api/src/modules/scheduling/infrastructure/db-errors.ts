/**
 * Traduction des erreurs Postgres du module scheduling en erreurs métier (`AppError`).
 *
 * Les déclencheurs de 0953 lèvent des exceptions dont le message commence par un code stable
 * `scheduling.<code>:` ; la contrainte d'exclusion de `resource_claims` lève `23P01` avec le nom de
 * contrainte `resource_claims_no_overlap`. Rien d'autre que ces messages « métier » n'est jamais
 * renvoyé tel quel au client (un message SQL inconnu devient une erreur interne générique).
 */
import { ConflictError, ValidationError, type AppError } from "@ecoledigitale/kernel";
import { pgErrorCode } from "@ecoledigitale/database";
import { SchedulingCodes, conflictDetected, hoursLocked, occurrenceValidated } from "../domain/errors";

interface PgErrorLike {
  code?: string;
  message?: string;
  constraint?: string;
  detail?: string;
}

const CODE_IN_MESSAGE = /^scheduling\.([a-z_]+):\s*(.*)$/s;
const OVERLAP_DETAIL = /\(tenant_id, resource_kind, resource_id, during\)=\([^,]+, (\w+), ([0-9a-f-]{36}),/i;

/** Retourne l'erreur métier correspondante, ou `null` si l'erreur n'est pas du ressort du module. */
export function mapDbError(e: unknown): AppError | null {
  const code = pgErrorCode(e);
  if (!code) return null;
  const err = e as PgErrorLike;
  const message = typeof err.message === "string" ? err.message : "";

  const tagged = CODE_IN_MESSAGE.exec(message);
  if (tagged) {
    const key = tagged[1] as string;
    const text = (tagged[2] as string).trim();
    switch (key) {
      case "equipment_conflict":
        return new ConflictError(`Stock d'équipement dépassé : ${text}.`, { code: SchedulingCodes.equipmentConflict });
      case "equipment_unavailable":
        return new ConflictError(`Équipement indisponible : ${text}.`, { code: SchedulingCodes.equipmentUnavailable });
      case "room_unavailable":
        return new ConflictError(`Salle indisponible : ${text}.`, { code: SchedulingCodes.roomUnavailable });
      case "occurrence_validated":
        return occurrenceValidated();
      case "occurrence_locked":
      case "hours_locked": {
        const ref = /\(([0-9a-f-]{36})\)/i.exec(text)?.[1] ?? null;
        return hoursLocked(ref);
      }
      case "hours_not_payable":
        return new ConflictError("Seules les heures rémunérées d'une séance réalisée et validée peuvent être verrouillées.", {
          code: SchedulingCodes.hoursNotPayable,
        });
      case "occurrence_transition":
        return new ConflictError(`Transition de statut interdite : ${text}.`, { code: SchedulingCodes.invalidTransition });
      case "occurrence_identity_immutable":
      case "immutable":
        return new ConflictError("Cette donnée est immuable.", { code: `scheduling.${key}` });
      default:
        return null;
    }
  }

  if (code === "23P01" && err.constraint === "resource_claims_no_overlap") {
    const m = OVERLAP_DETAIL.exec(err.detail ?? "");
    const resourceKind = (m?.[1] as "STAFF" | "CLASSROOM" | "ROOM" | undefined) ?? "STAFF";
    const resourceId = m?.[2] ?? null;
    const what = resourceKind === "STAFF" ? "L'intervenant" : resourceKind === "ROOM" ? "La salle" : "La classe (ou l'offre)";
    return conflictDetected(
      [
        {
          code: resourceKind === "STAFF" ? "STAFF_BUSY" : resourceKind === "ROOM" ? "ROOM_BUSY" : "CLASSROOM_BUSY",
          severity: "BLOCKING",
          resourceKind,
          resourceId,
          message: `${what} est déjà réservé(e) sur ce créneau (refus imposé par la base de données).`,
        },
      ],
      { source: "database" },
    );
  }

  if (code === "40P01" || code === "40001") {
    return new ConflictError("Une autre modification concurrente a eu lieu : réessayez.", { code: SchedulingCodes.concurrentUpdate });
  }

  if (code === "23505") {
    switch (err.constraint) {
      case "timetables_one_published":
        return new ConflictError("Un emploi du temps est déjà publié pour cet établissement, cette année et cette période.", {
          code: SchedulingCodes.timetableAlreadyPublished,
        });
      case "occurrences_entry_generated_for":
        return new ConflictError("Une séance existe déjà pour ce patron à cette date.", { code: SchedulingCodes.duplicate });
      default:
        return new ConflictError("Cet enregistrement existe déjà.", { code: SchedulingCodes.duplicate, details: err.constraint ? { constraint: err.constraint } : {} });
    }
  }

  if (code === "23503") {
    return new ValidationError("Une référence est inconnue (salle, équipement, patron, type…).", [], {
      code: SchedulingCodes.referenceMissing,
      details: err.constraint ? { constraint: err.constraint } : {},
    });
  }

  return null;
}
