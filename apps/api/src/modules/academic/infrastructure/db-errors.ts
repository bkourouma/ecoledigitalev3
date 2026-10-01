/**
 * Traduction des erreurs Postgres prévisibles en erreurs métier `academic.*` (jamais un 500 sur une violation
 * d'unicité, de CHECK ou de déclencheur — bug legacy). Les déclencheurs SQL commencent leur message par le code
 * stable (`academic.classroom_full: …`) ; les contraintes sont reconnues par table / nom d'index.
 */
import { pgErrorCode } from "@ecoledigitale/database";
import { ConflictError, ValidationError, type AppError } from "@ecoledigitale/kernel";
import { AcademicCode, CONFLICT_SQL_CODES, conflict, validation } from "../domain/errors";

interface PgErrorShape {
  code?: string;
  message?: string;
  constraint?: string;
  table?: string;
  detail?: string;
}

const CODE_PREFIX = /^(academic\.[a-z0-9_]+)/;

const UNIQUE_BY_CONSTRAINT: ReadonlyArray<[RegExp, string, string]> = [
  [/enrollments_one_live_per_class/, AcademicCode.ALREADY_ENROLLED, "L'apprenant a déjà une inscription vivante dans cette classe."],
  [/enrollments_one_class_mode_per_year/, AcademicCode.CLASS_ENROLLMENT_EXISTS, "L'apprenant a déjà une inscription de classe cette année dans cet établissement."],
  [/enrollment_courses_one_live/, AcademicCode.DUPLICATE_ENROLLMENT, "L'apprenant a déjà une sélection vivante pour ce nœud."],
  [/enrollments_one_rollover_per_previous/, AcademicCode.ALREADY_ENROLLED, "Cette inscription a déjà été reconduite."],
  [/registration_numbers/, AcademicCode.REGISTRATION_NUMBER_CONFLICT, "Ce numéro d'inscription est déjà attribué dans l'établissement."],
  [/academic_years_one_current/, AcademicCode.YEAR_TRANSITION, "Une autre année est déjà l'année courante de l'établissement."],
  [/enrollment_placements_one_open/, AcademicCode.PLACEMENT_OVERLAP, "Un placement ouvert existe déjà pour cette inscription."],
];

const UNIQUE_BY_TABLE: Readonly<Record<string, [string, string]>> = {
  academic_years: [AcademicCode.YEAR_CODE_TAKEN, "Ce code d'année existe déjà dans l'établissement."],
  academic_periods: [AcademicCode.PERIOD_CODE_TAKEN, "Ce code ou ce numéro de période existe déjà dans l'année."],
  programs: [AcademicCode.PROGRAM_CODE_TAKEN, "Ce code de programme existe déjà dans l'établissement."],
  subjects: [AcademicCode.SUBJECT_CODE_TAKEN, "Ce code de matière existe déjà."],
  curriculum_versions: [AcademicCode.CURRICULUM_EXISTS, "Un curriculum existe déjà pour ce programme et cette année."],
  curriculum_nodes: [AcademicCode.NODE_CODE_TAKEN, "Ce code existe déjà parmi les nœuds frères."],
  classroom_offerings: [AcademicCode.OFFERING_EXISTS, "Une offre existe déjà pour ce nœud dans cette classe."],
};

const FK_BY_CONSTRAINT: ReadonlyArray<[RegExp, string, string]> = [
  [/period_type/, AcademicCode.PERIOD_TYPE_UNKNOWN, "Type de période inconnu."],
  [/node_type/, AcademicCode.NODE_TYPE_UNKNOWN, "Type de nœud inconnu."],
  [/funding_type/, AcademicCode.FUNDING_TYPE_UNKNOWN, "Type de financement inconnu."],
  [/outcome/, AcademicCode.OUTCOME_UNKNOWN, "Issue d'inscription inconnue."],
  [/subject/, AcademicCode.SUBJECT_NOT_FOUND, "Matière introuvable."],
  [/grade_level/, AcademicCode.GRADE_LEVEL_NOT_FOUND, "Niveau introuvable."],
  [/education_level/, AcademicCode.EDUCATION_LEVEL_NOT_FOUND, "Cycle introuvable."],
  [/program/, AcademicCode.PROGRAM_NOT_FOUND, "Programme introuvable."],
];

export function mapDbError(e: unknown): AppError | null {
  const pg = e as PgErrorShape | null;
  const sqlstate = pgErrorCode(e);
  if (!pg || !sqlstate) return null;
  const message = typeof pg.message === "string" ? pg.message : "";
  const prefixed = CODE_PREFIX.exec(message)?.[1];

  if (prefixed) {
    const human = message.slice(prefixed.length).replace(/^:\s*/, "").trim() || prefixed;
    // Les déclencheurs lèvent `check_violation` (incohérence d'entrée), `restrict_violation` (écriture interdite
    // par l'état), `unique_violation` ou `foreign_key_violation`.
    if (sqlstate === "23514") {
      return CONFLICT_SQL_CODES.has(prefixed) ? conflict(prefixed, human) : validation(prefixed, human);
    }
    if (sqlstate === "23001" || sqlstate === "23505") return conflict(prefixed, human);
    if (sqlstate === "23503") return validation(prefixed, human);
  }

  switch (sqlstate) {
    case "23P01": {
      if (pg.table === "academic_years") return conflict(AcademicCode.YEAR_OVERLAP, "L'année chevauche une autre année de l'établissement.");
      if (pg.table === "academic_periods") return conflict(AcademicCode.PERIOD_OVERLAP, "La période chevauche une période sœur de même type.");
      if (pg.table === "enrollment_placements") return conflict(AcademicCode.PLACEMENT_OVERLAP, "Les placements d'une inscription ne se chevauchent pas.");
      return conflict("academic.conflict", "Conflit avec une contrainte d'exclusion.");
    }
    case "23505": {
      const constraint = pg.constraint ?? "";
      for (const [re, code, text] of UNIQUE_BY_CONSTRAINT) if (re.test(constraint)) return conflict(code, text);
      if (pg.table === "classrooms") {
        return /name/.test(constraint)
          ? conflict(AcademicCode.CLASSROOM_NAME_TAKEN, "Ce nom de classe existe déjà pour ce programme et ce niveau.")
          : conflict(AcademicCode.CLASSROOM_CODE_TAKEN, "Ce code de classe existe déjà pour ce programme et ce niveau.");
      }
      const byTable = pg.table ? UNIQUE_BY_TABLE[pg.table] : undefined;
      if (byTable) return conflict(byTable[0], byTable[1]);
      return new ConflictError("Doublon : cet enregistrement existe déjà.", { code: "academic.conflict", details: { constraint } });
    }
    case "23503": {
      const constraint = pg.constraint ?? "";
      // Suppression d'une ligne encore référencée.
      if (/is still referenced|update or delete on table/.test(`${message} ${pg.detail ?? ""}`)) {
        if (pg.table === "subjects" || /table "subjects"/.test(message)) return conflict(AcademicCode.SUBJECT_IN_USE, "La matière est encore référencée par un nœud de curriculum.");
        return conflict("academic.in_use", "L'élément est encore référencé.");
      }
      for (const [re, code, text] of FK_BY_CONSTRAINT) if (re.test(constraint)) return validation(code, text);
      return validation(AcademicCode.INVALID_INPUT, "Référence inconnue.", "input", { constraint });
    }
    case "23514":
      return new ValidationError("Valeur refusée par une contrainte.", [{ path: ["input"], message: "Valeur refusée par une contrainte.", code: AcademicCode.INVALID_INPUT }], {
        code: AcademicCode.INVALID_INPUT,
        details: { constraint: pg.constraint ?? null },
      });
    case "23001":
      return conflict(AcademicCode.IMMUTABLE, message || "Écriture interdite par l'état de la ressource.");
    case "40001":
    case "40P01":
      return conflict("academic.concurrent_update", "Mise à jour concurrente : réessayez.");
    default:
      return null;
  }
}
