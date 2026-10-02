/**
 * Erreurs métier du module documents : types du kernel + codes stables `documents.*`
 * (ils font partie du contrat d'API, voir `DOCUMENTS_ERROR_CODES` des contrats ; ne jamais en renommer un).
 * La couche HTTP convertit certains codes en statuts précis (413, 415, 422, 410, 503) : voir `http/plugin.ts`.
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";

export const DocumentsCode = {
  INVALID_INPUT: "documents.invalid_input",
  FORBIDDEN: "documents.forbidden",
  PORT_UNAVAILABLE: "documents.port_unavailable",
  DOCUMENT_NOT_FOUND: "documents.document_not_found",
  VERSION_NOT_FOUND: "documents.version_not_found",
  CATEGORY_NOT_FOUND: "documents.category_not_found",
  CATEGORY_CODE_TAKEN: "documents.category_code_taken",
  CATEGORY_ARCHIVED: "documents.category_archived",
  CATEGORY_IN_USE: "documents.category_in_use",
  SHARE_NOT_FOUND: "documents.share_not_found",
  GRANT_NOT_FOUND: "documents.grant_not_found",
  QUARANTINE_NOT_FOUND: "documents.quarantine_not_found",
  OWNER_NOT_FOUND: "documents.owner_not_found",
  OWNER_REQUIRED: "documents.owner_required",
  OWNER_NOT_ALLOWED: "documents.owner_not_allowed",
  KIND_MISMATCH: "documents.kind_mismatch",
  FILE_MISSING: "documents.file_missing",
  FILE_EMPTY: "documents.file_empty",
  FILE_TOO_LARGE: "documents.file_too_large",
  TYPE_UNDETECTED: "documents.type_undetected",
  TYPE_MISMATCH: "documents.type_mismatch",
  TYPE_NOT_ALLOWED: "documents.type_not_allowed",
  FILE_NAME_REJECTED: "documents.file_name_rejected",
  MACRO_CONTENT: "documents.macro_content",
  MALWARE_DETECTED: "documents.malware_detected",
  SCAN_UNAVAILABLE: "documents.scan_unavailable",
  QUOTA_EXCEEDED: "documents.quota_exceeded",
  DUPLICATE: "documents.duplicate",
  VERSION_IDENTICAL: "documents.version_identical",
  VERSION_CONFLICT: "documents.version_conflict",
  TOO_MANY_VERSIONS: "documents.too_many_versions",
  EXPIRY_REQUIRED: "documents.expiry_required",
  ARCHIVED: "documents.archived",
  NOT_ARCHIVED: "documents.not_archived",
  PREVIEW_UNAVAILABLE: "documents.preview_unavailable",
  OBJECT_MISSING: "documents.object_missing",
  INTEGRITY_FAILED: "documents.integrity_failed",
  SHARE_INVALID: "documents.share_invalid",
  RATE_LIMITED: "documents.rate_limited",
} as const;

export type DocumentsCodeValue = (typeof DocumentsCode)[keyof typeof DocumentsCode];

export const validation = (
  code: DocumentsCodeValue,
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: DocumentsCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: DocumentsCodeValue, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const forbidden = (code: DocumentsCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** Port non branché : le module échoue FERMÉ (aucun dépôt sans stockage, aucune décision de lien sans annuaire). */
export const portUnavailable = (port: string): InternalError =>
  new InternalError(`Le service « ${port} » n'est pas disponible : opération refusée.`, {
    code: DocumentsCode.PORT_UNAVAILABLE,
    details: { port },
  });

/** Statut HTTP précis par code (les catégories du kernel n'ont que 400/403/404/409/500). */
export const HTTP_STATUS_BY_DOCUMENTS_CODE: Readonly<Record<string, number>> = Object.freeze({
  [DocumentsCode.FILE_TOO_LARGE]: 413,
  [DocumentsCode.QUOTA_EXCEEDED]: 413,
  [DocumentsCode.TYPE_UNDETECTED]: 415,
  [DocumentsCode.TYPE_MISMATCH]: 415,
  [DocumentsCode.TYPE_NOT_ALLOWED]: 415,
  [DocumentsCode.PREVIEW_UNAVAILABLE]: 415,
  [DocumentsCode.MACRO_CONTENT]: 422,
  [DocumentsCode.MALWARE_DETECTED]: 422,
  [DocumentsCode.SCAN_UNAVAILABLE]: 503,
  [DocumentsCode.PORT_UNAVAILABLE]: 503,
  [DocumentsCode.OBJECT_MISSING]: 410,
  [DocumentsCode.RATE_LIMITED]: 429,
});
