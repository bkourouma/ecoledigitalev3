/**
 * Erreurs normalisées du client API.
 *
 * Format cible (kernel, `ErrorBody`) : `{ code, message, details }`. Le client accepte aussi l'enveloppe
 * `{ error: { code, message, details } }` et les anciens formats de l'API legacy (`{ message }`,
 * `{ error: "texte" }`, texte brut) pour que la migration par tranches reste possible.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** Codes produits côté client (jamais renvoyés par le serveur). */
export const ClientErrorCode = {
  NETWORK: "NETWORK_ERROR",
  ABORTED: "ABORTED",
  TIMEOUT: "TIMEOUT",
  TENANT_UNKNOWN: "TENANT_UNKNOWN",
  RESPONSE_INVALID: "RESPONSE_INVALID",
} as const;

export class ApiError extends Error {
  readonly code: string;
  /** Statut HTTP ; 0 pour une erreur sans réponse (réseau, annulation, délai). */
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(init: { code: string; message: string; status?: number; details?: unknown; requestId?: string; cause?: unknown }) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status ?? 0;
    this.details = init.details;
    this.requestId = init.requestId;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isAborted(): boolean {
    return this.code === ClientErrorCode.ABORTED;
  }

  toJSON(): ApiErrorBody & { status: number } {
    return { code: this.code, message: this.message, details: this.details, status: this.status };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

const DEFAULT_CODE_BY_STATUS: Record<number, string> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
};

const DEFAULT_MESSAGE_BY_STATUS: Record<number, string> = {
  400: "Données invalides.",
  401: "Authentification requise.",
  403: "Action non autorisée.",
  404: "Ressource introuvable.",
  409: "Conflit avec l'état actuel de la ressource.",
  422: "Données invalides.",
  429: "Trop de requêtes, réessayez dans un instant.",
};

export function defaultCodeForStatus(status: number): string {
  return DEFAULT_CODE_BY_STATUS[status] ?? (status >= 500 ? "INTERNAL" : "HTTP_ERROR");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** Construit une `ApiError` depuis le statut HTTP et le corps (déjà décodé si JSON, sinon texte) d'une réponse. */
export function normalizeErrorResponse(status: number, body: unknown, requestIdHeader?: string | null): ApiError {
  const root = asRecord(body);
  // Enveloppe `{ error: { ... } }` (objet) ou format plat.
  const envelope = root && asRecord(root.error) ? asRecord(root.error) : null;
  const source = envelope ?? root;

  const code = str(source?.code) ?? defaultCodeForStatus(status);
  const message =
    str(source?.message) ??
    // Ancien format `{ error: "texte" }`
    (root ? str(root.error) : undefined) ??
    (typeof body === "string" ? str(body.slice(0, 300)) : undefined) ??
    DEFAULT_MESSAGE_BY_STATUS[status] ??
    (status >= 500 ? "Erreur interne du serveur." : `Erreur ${status}.`);

  let details: unknown = source?.details;
  const issues = source?.issues;
  if (issues !== undefined) {
    details = asRecord(details) ? { ...asRecord(details), issues } : { issues, ...(details !== undefined ? { details } : {}) };
  }

  const requestId = str(source?.requestId) ?? str(requestIdHeader);
  return new ApiError({ code, message, status, details, requestId });
}
