/**
 * Traduction des erreurs Postgres prévisibles en erreurs métier `admissions.*` (jamais un 500 sur une violation d'unicité, de
 * CHECK ou de déclencheur). Les déclencheurs SQL commencent leur message par le code stable (`admissions.capacity_full: …`) ;
 * les contraintes sont reconnues par nom d'index / de contrainte.
 */
import { pgErrorCode } from "@ecoledigitale/database";
import type { AppError } from "@ecoledigitale/kernel";
import { AdmissionsCode, CONFLICT_SQL_CODES, conflict, validation } from "../domain/errors";

interface PgErrorShape {
  code?: string;
  message?: string;
  constraint?: string;
  table?: string;
}

const CODE_PREFIX = /^(admissions\.[a-z0-9_]+)/;

const UNIQUE_BY_CONSTRAINT: ReadonlyArray<[RegExp, string, string]> = [
  [/applications_one_live_per_child/, AdmissionsCode.DUPLICATE_APPLICATION, "Une candidature vivante existe déjà pour cet enfant dans cette campagne."],
  [/offers_one_pending/, AdmissionsCode.OFFER_EXISTS, "Une offre est déjà en attente pour cette candidature."],
  [/workflows_one_published/, AdmissionsCode.WORKFLOW_CONFLICT, "Un autre workflow est déjà publié pour cet établissement et ce cycle."],
  [/workflows_tenant_id_institution_id_code_version_key/, AdmissionsCode.REFERENCE_CODE_TAKEN, "Ce code et cette version de workflow existent déjà."],
  [/campaigns_tenant_id_institution_id_code_key/, AdmissionsCode.REFERENCE_CODE_TAKEN, "Ce code de campagne existe déjà dans l'établissement."],
  [/prospects_one_active_email/, AdmissionsCode.REFERENCE_CODE_TAKEN, "Un prospect actif existe déjà avec cette adresse e-mail."],
  [/priority_classes_tenant_id_institution_id_code_key/, AdmissionsCode.REFERENCE_CODE_TAKEN, "Ce code de classe de priorité existe déjà."],
  [/decision_reasons_tenant_id_institution_id_code_key/, AdmissionsCode.REFERENCE_CODE_TAKEN, "Ce code de motif existe déjà."],
  [/consent_texts_tenant_id_institution_id_kind_version_key/, AdmissionsCode.REFERENCE_CODE_TAKEN, "Cette version de texte de consentement existe déjà."],
  [/document_requirements_tenant_id_institution_id_code_key/, AdmissionsCode.REFERENCE_CODE_TAKEN, "Ce code de pièce exigée existe déjà."],
  [/public_form_index_pkey|public_form_index_tenant_id_institution_id_key/, AdmissionsCode.REFERENCE_CODE_TAKEN, "Ce lien public existe déjà."],
];

export function mapDbError(e: unknown): AppError | null {
  const pg = e as PgErrorShape | null;
  const sqlstate = pgErrorCode(e);
  if (!pg || !sqlstate) return null;
  const message = typeof pg.message === "string" ? pg.message : "";
  const prefixed = CODE_PREFIX.exec(message)?.[1];

  if (prefixed) {
    const human = message.slice(prefixed.length).replace(/^:\s*/, "").trim() || prefixed;
    if (sqlstate === "23514" || sqlstate === "23001") {
      return CONFLICT_SQL_CODES.has(prefixed) ? conflict(prefixed, human) : validation(prefixed, human);
    }
    if (sqlstate === "23505") return conflict(prefixed, human);
    if (sqlstate === "23503") return validation(prefixed, human);
    if (sqlstate === "P0002") return conflict(prefixed, human);
  }

  switch (sqlstate) {
    case "23505": {
      const constraint = pg.constraint ?? "";
      for (const [re, code, text] of UNIQUE_BY_CONSTRAINT) if (re.test(constraint)) return conflict(code, text);
      return conflict("admissions.conflict", "Cette valeur existe déjà.");
    }
    case "23503":
      return validation(AdmissionsCode.INVALID_INPUT, "Référence inconnue.", pg.constraint ?? "input");
    case "23514":
      return validation(AdmissionsCode.INVALID_INPUT, "Une valeur ne respecte pas une règle de cohérence.", pg.constraint ?? "input");
    case "23502":
      return validation(AdmissionsCode.INVALID_INPUT, "Une valeur obligatoire est absente.");
    case "22P02":
    case "22007":
    case "22008":
      return validation(AdmissionsCode.INVALID_INPUT, "Valeur illisible.");
    default:
      return null;
  }
}
