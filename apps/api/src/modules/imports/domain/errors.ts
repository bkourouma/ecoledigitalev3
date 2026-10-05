/**
 * Erreurs métier du module imports : types du kernel + codes stables `imports.*`
 * (ils font partie du contrat d'API, voir `IMPORT_ERROR_CODES` des contrats ; ne jamais en renommer un).
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";
import type { ImportErrorCode } from "@ecoledigitale/contracts/src/v2/imports";

export const validation = (
  code: ImportErrorCode,
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: ImportErrorCode, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: ImportErrorCode, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const forbidden = (code: ImportErrorCode, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** Port non branché : le module échoue FERMÉ (aucune écriture sans la porte d'entrée du module cible). */
export const portUnavailable = (port: string): InternalError =>
  new InternalError(`Le service « ${port} » n'est pas disponible : import refusé.`, {
    code: "imports.port_unavailable",
    details: { port },
  });

/** Convertisseur .xls / .ods indisponible (démarrage impossible) : erreur de service, pas un défaut du fichier. */
export const conversionUnavailable = (message: string): InternalError => new InternalError(message, { code: "imports.conversion_unavailable" });

/** Fichier refusé (type, taille, structure) : 400 avec un code précis et un message actionnable. */
export class FileRejectedError extends ValidationError {
  constructor(code: ImportErrorCode, message: string, details?: Record<string, unknown>) {
    super(message, [{ path: ["file"], message, code }], { code, ...(details ? { details } : {}) });
  }
}

/** 429 : sous-classe de `ForbiddenError` (le kernel n'a pas de catégorie dédiée) ; la couche HTTP mappe sur 429 + Retry-After. */
export class RateLimitedError extends ForbiddenError {
  readonly retryAfterSec: number;
  constructor(message: string, retryAfterSec: number, details?: Record<string, unknown>) {
    super(message, { code: "imports.rate_limited", details: { retryAfterSec, ...details } });
    this.retryAfterSec = retryAfterSec;
  }
}

/** Signal interne : annule la transaction d'un lot (annulation demandée, ou mode tout-ou-rien en échec). Jamais exposé. */
export class RollbackSignal extends Error {
  constructor(
    readonly reason: "cancelled" | "failed",
    readonly detail?: unknown,
  ) {
    super(`rollback:${reason}`);
    this.name = "RollbackSignal";
  }
}
