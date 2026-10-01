/**
 * Erreurs applicatives typées.
 *
 * Chaque erreur porte :
 *  - `kind`   : catégorie stable (détermine le statut HTTP) ;
 *  - `code`   : code machine STABLE, destiné aux clients et aux tests. Il vaut
 *               par défaut le code de la catégorie, et peut être précisé par un
 *               module (`finance.invoice_already_paid`). Un code publié ne change
 *               jamais ;
 *  - `message`: texte lisible (français), jamais utilisé comme clé de logique ;
 *  - `details`: données structurées sérialisables (jamais de secret).
 */

export type ErrorKind =
  | "not_found"
  | "forbidden"
  | "conflict"
  | "validation"
  | "unauthorized"
  | "internal";

/** Codes par défaut des catégories. Ils sont partie intégrante du contrat d'API. */
export const ErrorCode = {
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHORIZED: "UNAUTHORIZED",
  INTERNAL: "INTERNAL",
} as const;

export type DefaultErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Statut HTTP par catégorie.
 * Validation = 400 : aligné sur les clients historiques de l'API (qui traitent
 * 400 comme « requête invalide »). 401 = pas (ou plus) authentifié ; 403 =
 * authentifié mais non autorisé.
 */
export const HTTP_STATUS_BY_KIND: Readonly<Record<ErrorKind, number>> = Object.freeze({
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  validation: 400,
  unauthorized: 401,
  internal: 500,
});

const DEFAULT_CODE_BY_KIND: Readonly<Record<ErrorKind, string>> = Object.freeze({
  not_found: ErrorCode.NOT_FOUND,
  forbidden: ErrorCode.FORBIDDEN,
  conflict: ErrorCode.CONFLICT,
  validation: ErrorCode.VALIDATION_FAILED,
  unauthorized: ErrorCode.UNAUTHORIZED,
  internal: ErrorCode.INTERNAL,
});

export interface AppErrorOptions {
  /** Code machine stable spécifique ; défaut = code de la catégorie. */
  code?: string;
  details?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

export abstract class AppError extends Error {
  abstract readonly kind: ErrorKind;
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  protected constructor(kind: ErrorKind, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    const code = options.code ?? DEFAULT_CODE_BY_KIND[kind];
    if (!CODE_PATTERN.test(code)) {
      throw new TypeError(`Code d'erreur invalide : "${code}"`);
    }
    this.code = code;
    this.details = options.details;
  }

  get httpStatus(): number {
    return HTTP_STATUS_BY_KIND[this.kind];
  }
}

export class NotFoundError extends AppError {
  readonly kind = "not_found" as const;
  constructor(message = "Ressource introuvable.", options?: AppErrorOptions) {
    super("not_found", message, options);
  }

  /** `NotFoundError.of("Élève", id)` — message homogène. */
  static of(resource: string, id?: string, options?: AppErrorOptions): NotFoundError {
    const message = id ? `${resource} introuvable (${id}).` : `${resource} introuvable.`;
    return new NotFoundError(message, {
      ...options,
      details: { resource, ...(id ? { id } : {}), ...options?.details },
    });
  }
}

export class ForbiddenError extends AppError {
  readonly kind = "forbidden" as const;
  constructor(message = "Action non autorisée.", options?: AppErrorOptions) {
    super("forbidden", message, options);
  }
}

export class ConflictError extends AppError {
  readonly kind = "conflict" as const;
  constructor(message = "Conflit avec l'état actuel de la ressource.", options?: AppErrorOptions) {
    super("conflict", message, options);
  }
}

export class UnauthorizedError extends AppError {
  readonly kind = "unauthorized" as const;
  constructor(message = "Authentification requise.", options?: AppErrorOptions) {
    super("unauthorized", message, options);
  }
}

export interface ValidationIssue {
  /** Chemin du champ fautif, ex. `["lines", 0, "amount"]`. */
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
  /** Code machine optionnel de la violation (ex. `too_small`). */
  readonly code?: string;
}

export class ValidationError extends AppError {
  readonly kind = "validation" as const;
  readonly issues: ReadonlyArray<ValidationIssue>;

  constructor(
    message = "Données invalides.",
    issues: ReadonlyArray<ValidationIssue> = [],
    options?: AppErrorOptions,
  ) {
    super("validation", message, options);
    this.issues = Object.freeze([...issues]);
  }

  /** Raccourci pour une violation unique. */
  static field(path: string | ReadonlyArray<string | number>, message: string, code?: string): ValidationError {
    const p = typeof path === "string" ? [path] : path;
    return new ValidationError(message, [{ path: p, message, ...(code ? { code } : {}) }]);
  }
}

export class InternalError extends AppError {
  readonly kind = "internal" as const;
  constructor(message = "Erreur interne.", options?: AppErrorOptions) {
    super("internal", message, options);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Normalise n'importe quelle valeur levée en `AppError`. Une erreur inconnue
 * devient `InternalError` SANS reprendre son message (qui pourrait contenir du
 * SQL, un chemin ou un secret) ; la cause originale est conservée pour les logs.
 */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  return new InternalError("Erreur interne.", { cause: value });
}

/** Corps d'erreur HTTP sérialisable (jamais de stack ni de cause). */
export interface ErrorBody {
  readonly status: number;
  readonly code: string;
  readonly kind: ErrorKind;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly issues?: ReadonlyArray<ValidationIssue>;
  readonly requestId?: string;
}

export function httpStatusFor(error: unknown): number {
  return toAppError(error).httpStatus;
}

export function toErrorBody(error: unknown, requestId?: string): ErrorBody {
  const e = toAppError(error);
  return {
    status: e.httpStatus,
    code: e.code,
    kind: e.kind,
    message: e.message,
    ...(e.details ? { details: e.details } : {}),
    ...(e instanceof ValidationError && e.issues.length > 0 ? { issues: e.issues } : {}),
    ...(requestId ? { requestId } : {}),
  };
}
