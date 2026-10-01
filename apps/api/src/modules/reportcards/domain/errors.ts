/**
 * Codes d'erreur STABLES du module reportcards (contrat d'API : un code publié ne change jamais) et fabriques d'erreurs
 * typées (`@ecoledigitale/kernel`). Messages en français, jamais de détail interne (SQL, chemin, secret).
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError, type AppError } from "@ecoledigitale/kernel";

export const ReportcardsCode = {
  PORT_UNAVAILABLE: "reportcards.port_unavailable",
  NOT_FOUND: "reportcards.not_found",
  BATCH_NOT_FOUND: "reportcards.batch_not_found",
  SIGNATORY_NOT_FOUND: "reportcards.signatory_not_found",
  TEMPLATE_NOT_FOUND: "reportcards.template_not_found",
  PREFLIGHT_FAILED: "reportcards.preflight_failed",
  PERIOD_NOT_CLOSED: "reportcards.period_not_closed",
  BRANDING_MISSING: "reportcards.branding_missing",
  TEMPLATE_CONFIG_MISSING: "reportcards.template_config_missing",
  SIGNATORY_MISSING: "reportcards.signatory_missing",
  DELIBERATION_REQUIRED: "reportcards.deliberation_required",
  NO_FINAL_RESULT: "reportcards.no_final_result",
  SIGNING_KEY_MISSING: "reportcards.signing_key_missing",
  SIGNING_KEY_CONFLICT: "reportcards.signing_key_conflict",
  ALREADY_ISSUED: "reportcards.already_issued",
  NEEDS_REISSUE: "reportcards.needs_reissue",
  CONCURRENT_ISSUE: "reportcards.concurrent_issue",
  INVALID_STATE: "reportcards.invalid_state",
  PROVISIONAL: "reportcards.provisional",
  NOT_PUBLISHED: "reportcards.not_published",
  NOT_RENDERED: "reportcards.not_rendered",
  ACCESS_DENIED: "reportcards.access_denied",
  PAYMENT_REQUIRED: "reportcards.contact_accounting",
  INVALID_TEMPLATE: "reportcards.invalid_template",
  INVALID_OPTIONS: "reportcards.invalid_options",
  INVALID_SNAPSHOT: "reportcards.invalid_snapshot",
  RENDER_FAILED: "reportcards.render_failed",
  ASSET_MISSING: "reportcards.asset_missing",
  STORAGE_FAILED: "reportcards.storage_failed",
  RATE_LIMITED: "reportcards.rate_limited",
  FILE_TOO_LARGE: "reportcards.file_too_large",
  UNKNOWN_DOCUMENT_KIND: "reportcards.unknown_document_kind",
  TRANSCRIPT_EMPTY: "reportcards.transcript_empty",
} as const;
export type ReportcardsCodeValue = (typeof ReportcardsCode)[keyof typeof ReportcardsCode];

type Details = Readonly<Record<string, unknown>>;

export const portUnavailable = (port: string): AppError =>
  new InternalError(`Service indisponible : ${port} n'est pas branché.`, { code: ReportcardsCode.PORT_UNAVAILABLE, details: { port } });
export const notFound = (what = "Document", id?: string): AppError => NotFoundError.of(what, id, { code: ReportcardsCode.NOT_FOUND });
export const conflict = (message: string, code: ReportcardsCodeValue, details?: Details): AppError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });
export const invalid = (message: string, code: ReportcardsCodeValue, details?: Details): AppError =>
  new ValidationError(message, [], { code, ...(details ? { details } : {}) });
export const forbidden = (message: string, code: ReportcardsCodeValue = ReportcardsCode.ACCESS_DENIED, details?: Details): AppError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });
export const internal = (message: string, code: ReportcardsCodeValue, details?: Details): AppError =>
  new InternalError(message, { code, ...(details ? { details } : {}) });
