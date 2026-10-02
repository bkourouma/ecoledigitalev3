/**
 * Traduction des refus de la BASE en erreurs métier stables : aucun `500` pour une violation de contrainte prévisible.
 *
 * Les gardes SQL (2301, 2303) lèvent `RAISE EXCEPTION 'stateassign.<code>: <message>'` ; les index uniques et contraintes de
 * table sont reconnus par leur nom. Une erreur inconnue n'est PAS avalée (`null` : l'appelant la relance).
 */
import type { AppError } from "@ecoledigitale/kernel";
import { StateassignCode, conflict, forbidden, validation, type StateassignCodeValue } from "../domain/errors";

interface PgError {
  code?: string;
  message?: string;
  constraint?: string;
}

const PREFIX = /^stateassign\.([a-z_]+):\s*(.*)$/s;

type Kind = "conflict" | "forbidden" | "validation";
const BY_DB_CODE: Readonly<Record<string, readonly [StateassignCodeValue, Kind]>> = Object.freeze({
  human_actor_required: [StateassignCode.HUMAN_ACTOR_REQUIRED, "forbidden"],
  four_eyes_required: [StateassignCode.FOUR_EYES_REQUIRED, "forbidden"],
  receiver_mismatch: [StateassignCode.HUMAN_ACTOR_REQUIRED, "forbidden"],
  adder_mismatch: [StateassignCode.HUMAN_ACTOR_REQUIRED, "forbidden"],
  content_frozen: [StateassignCode.CONTENT_FROZEN, "conflict"],
  identity_immutable: [StateassignCode.IMMUTABLE, "conflict"],
  control_identity_immutable: [StateassignCode.IMMUTABLE, "conflict"],
  document_immutable: [StateassignCode.IMMUTABLE, "conflict"],
  receivable_identity_immutable: [StateassignCode.IMMUTABLE, "conflict"],
  immutable: [StateassignCode.IMMUTABLE, "conflict"],
  final: [StateassignCode.TRANSITION_INVALID, "conflict"],
  transition: [StateassignCode.TRANSITION_INVALID, "conflict"],
  initial_status: [StateassignCode.TRANSITION_INVALID, "conflict"],
  amendment_invalid: [StateassignCode.TRANSITION_INVALID, "conflict"],
  control_state: [StateassignCode.CONTROL_STATE, "conflict"],
  control_transition: [StateassignCode.CONTROL_TRANSITION, "conflict"],
  control_final: [StateassignCode.CONTROL_TRANSITION, "conflict"],
  resolution_required: [StateassignCode.RESOLUTION_REQUIRED, "validation"],
  document_withdrawn: [StateassignCode.TRANSITION_INVALID, "conflict"],
  reconciliation_incomplete: [StateassignCode.INVALID_INPUT, "validation"],
  receivable_state: [StateassignCode.RECEIVABLE_STATE, "conflict"],
  receivable_mismatch: [StateassignCode.INVALID_INPUT, "validation"],
  receivable_currency: [StateassignCode.INVALID_INPUT, "validation"],
  receivable_final: [StateassignCode.TRANSITION_INVALID, "conflict"],
  declared_amount_required: [StateassignCode.DECLARED_AMOUNT_REQUIRED, "conflict"],
  receivable_exceeds_declared: [StateassignCode.RECEIVABLE_EXCEEDS_DECLARED, "conflict"],
  receivable_cancel_received: [StateassignCode.RECEIVABLE_CANCEL_RECEIVED, "conflict"],
  amendment_below_schedule: [StateassignCode.AMENDMENT_BELOW_SCHEDULE, "conflict"],
});

const BY_CONSTRAINT: ReadonlyArray<readonly [RegExp, StateassignCodeValue, string]> = [
  [/assignments_one_live_per_enrollment/, StateassignCode.DUPLICATE_LIVE_ASSIGNMENT, "Cette inscription a déjà un dossier d'affectation en cours : le corriger, le remplacer par un avenant ou le terminer."],
  [/assignments_reference_uq/, StateassignCode.DUPLICATE_REFERENCE, "Cette référence d'affectation est déjà portée par un autre dossier de l'établissement pour cette année."],
  [/controls_one_per_period/, StateassignCode.DUPLICATE_CONTROL, "Ce contrôle existe déjà pour cette nature et cette période."],
  [/documents_tenant_id_assignment_id_document_ref_key/, StateassignCode.DUPLICATE_DOCUMENT, "Ce document est déjà rattaché au dossier."],
  [/export_formats_tenant_id_institution_id_code_key/, StateassignCode.DUPLICATE_EXPORT_FORMAT, "Un format d'export porte déjà ce code dans l'établissement."],
];

export function translateDbError(e: unknown): AppError | null {
  if (typeof e !== "object" || e === null) return null;
  const pg = e as PgError;
  const message = pg.message ?? "";
  const m = PREFIX.exec(message);
  if (m) {
    const entry = BY_DB_CODE[m[1]!];
    if (entry) {
      const [code, kind] = entry;
      const text = m[2]!.trim() || "Opération refusée.";
      return kind === "forbidden" ? forbidden(code, text) : kind === "validation" ? validation(code, text) : conflict(code, text);
    }
  }
  if (pg.code === "23505") {
    const target = `${pg.constraint ?? ""} ${message}`;
    for (const [re, code, text] of BY_CONSTRAINT) if (re.test(target)) return conflict(code, text);
    return conflict(StateassignCode.INVALID_INPUT, "Cette donnée existe déjà.");
  }
  if (pg.code === "23514") return validation(StateassignCode.INVALID_INPUT, "Donnée refusée par une règle de la base (valeur hors limites ou incohérente).");
  if (pg.code === "23503") return validation(StateassignCode.INVALID_INPUT, "Référence inconnue.");
  return null;
}

/** Exécute `fn` en traduisant les refus de la base ; toute autre erreur est relancée telle quelle. */
export async function translating<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const translated = translateDbError(e);
    if (translated) throw translated;
    throw e;
  }
}
