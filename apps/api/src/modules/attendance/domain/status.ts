/**
 * Statuts de présence = DONNÉES (`status_definitions`). Les drapeaux de chaque statut pilotent tous les comptages
 * (séance, élève, classe, période) : aucun statut n'est plus « oublié » d'un compteur (parité R-01). Le retard est
 * une PRÉSENCE (il ne compte pas comme absence) ; l'absence justifiée EST une absence (justifiée).
 */
import { err, ok, type AppError, type Result } from "@ecoledigitale/kernel";
import { AttendanceCode, conflict, validation } from "./errors";
import { StatusCode, SYSTEM_STAFF_CODES, SYSTEM_STUDENT_CODES, type StatusDefinition, type StatusIndex, type SubjectKind } from "./types";

const CODE_RE = /^[A-Z][A-Z0-9_]{0,39}$/;

export function indexStatuses(defs: readonly StatusDefinition[], kind: SubjectKind): StatusIndex {
  return new Map(defs.filter((d) => d.subjectKind === kind).map((d) => [d.code, d]));
}

export const isSystemCode = (kind: SubjectKind, code: string): boolean =>
  (kind === "STUDENT" ? SYSTEM_STUDENT_CODES : SYSTEM_STAFF_CODES).includes(code);

export interface StatusUpsertInput {
  readonly subjectKind: SubjectKind;
  readonly code: string;
  readonly label: string;
  readonly countsAsPresent?: boolean;
  readonly countsAsAbsence?: boolean;
  readonly countsAsLate?: boolean;
  readonly isJustified?: boolean;
  readonly requiresJustification?: boolean;
  readonly sortOrder?: number;
  readonly active?: boolean;
}

/**
 * Valide la création / modification d'un statut. Un tenant peut AJOUTER des statuts mais pas modifier la sémantique
 * (drapeaux) ni désactiver un statut système. Reproduit les CHECK de la table (erreur claire avant la base).
 */
export function resolveStatusUpsert(existing: StatusDefinition | undefined, input: StatusUpsertInput): Result<StatusDefinition, AppError> {
  if (!CODE_RE.test(input.code)) {
    return err(validation(AttendanceCode.INVALID_INPUT, "Code de statut invalide (majuscules, chiffres et _).", "code"));
  }
  if (input.label.trim().length === 0) return err(validation(AttendanceCode.INVALID_INPUT, "Le libellé est obligatoire.", "label"));

  if (existing?.isSystem) {
    const same =
      (input.countsAsPresent ?? existing.countsAsPresent) === existing.countsAsPresent &&
      (input.countsAsAbsence ?? existing.countsAsAbsence) === existing.countsAsAbsence &&
      (input.countsAsLate ?? existing.countsAsLate) === existing.countsAsLate &&
      (input.isJustified ?? existing.isJustified) === existing.isJustified &&
      (input.requiresJustification ?? existing.requiresJustification) === existing.requiresJustification;
    if (!same) {
      return err(conflict(AttendanceCode.SYSTEM_STATUS_IMMUTABLE, `La sémantique du statut système ${existing.code} ne peut pas être modifiée.`, { code: existing.code }));
    }
    if (input.active === false) {
      return err(conflict(AttendanceCode.SYSTEM_STATUS_IMMUTABLE, `Le statut système ${existing.code} ne peut pas être désactivé.`, { code: existing.code }));
    }
    return ok({ ...existing, label: input.label.trim(), sortOrder: input.sortOrder ?? existing.sortOrder });
  }

  // Un code réservé ne peut pas être créé comme statut « ordinaire » avec une autre sémantique.
  if (!existing && isSystemCode(input.subjectKind, input.code)) {
    return err(conflict(AttendanceCode.SYSTEM_STATUS_IMMUTABLE, `Le code ${input.code} est réservé à un statut système.`, { code: input.code }));
  }

  const next: StatusDefinition = {
    subjectKind: input.subjectKind,
    code: input.code,
    label: input.label.trim(),
    countsAsPresent: input.countsAsPresent ?? existing?.countsAsPresent ?? false,
    countsAsAbsence: input.countsAsAbsence ?? existing?.countsAsAbsence ?? false,
    countsAsLate: input.countsAsLate ?? existing?.countsAsLate ?? false,
    isJustified: input.isJustified ?? existing?.isJustified ?? false,
    requiresJustification: input.requiresJustification ?? existing?.requiresJustification ?? false,
    sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
    isSystem: false,
    active: input.active ?? existing?.active ?? true,
  };
  if (next.countsAsPresent && next.countsAsAbsence) {
    return err(validation(AttendanceCode.INVALID_INPUT, "Un statut ne peut pas compter à la fois comme présence et comme absence.", "countsAsAbsence"));
  }
  if (next.isJustified && !next.countsAsAbsence && !next.countsAsLate) {
    return err(validation(AttendanceCode.INVALID_INPUT, "Un statut « justifié » doit compter comme absence ou comme retard.", "isJustified"));
  }
  return ok(next);
}

/** Un pointage peut-il être excusé (statut d'absence, de retard ou départ anticipé, pas déjà justifié) ? */
export function isExcusable(def: StatusDefinition | undefined): boolean {
  if (!def || def.isJustified) return false;
  return def.countsAsAbsence || def.countsAsLate || def.code === StatusCode.EARLY_LEAVE;
}
