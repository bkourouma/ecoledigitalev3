/**
 * Erreurs métier du module notifications : types du kernel + codes stables `notifications.*`
 * (partie du contrat d'API : voir `NOTIF_ERROR_CODES` des contrats ; ne jamais en renommer un).
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";

export const NotifCode = {
  INVALID_INPUT: "notifications.invalid_input",
  FORBIDDEN: "notifications.forbidden",
  PORT_UNAVAILABLE: "notifications.port_unavailable",
  TEMPLATE_NOT_FOUND: "notifications.template_not_found",
  TEMPLATE_INVALID: "notifications.template_invalid",
  TEMPLATE_VARIABLE_UNKNOWN: "notifications.template_variable_unknown",
  TEMPLATE_VARIABLE_INVALID: "notifications.template_variable_invalid",
  VERSION_NOT_FOUND: "notifications.version_not_found",
  RULE_NOT_FOUND: "notifications.rule_not_found",
  RULE_INVALID: "notifications.rule_invalid",
  CHANNEL_NOT_CONFIGURED: "notifications.channel_not_configured",
  CHANNEL_DISABLED: "notifications.channel_disabled",
  DELIVERY_NOT_FOUND: "notifications.delivery_not_found",
  RECIPIENT_NOT_FOUND: "notifications.recipient_not_found",
  TOO_MANY_RECIPIENTS: "notifications.too_many_recipients",
  QUOTA_EXCEEDED: "notifications.quota_exceeded",
  SIGNATURE_INVALID: "notifications.signature_invalid",
  TOKEN_INVALID: "notifications.token_invalid",
  PUSH_NOT_CONFIGURED: "notifications.push_not_configured",
  RATE_LIMITED: "notifications.rate_limited",
} as const;

export type NotifCodeValue = (typeof NotifCode)[keyof typeof NotifCode];

export const validation = (
  code: NotifCodeValue,
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: NotifCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: NotifCodeValue, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const forbidden = (code: NotifCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** 429 : sous-classe de `ForbiddenError` (le kernel n'a pas de catégorie dédiée) ; la couche HTTP mappe sur 429 + Retry-After. */
export class RateLimitedError extends ForbiddenError {
  readonly retryAfterSec: number;
  constructor(message: string, retryAfterSec: number, details?: Record<string, unknown>) {
    super(message, { code: NotifCode.RATE_LIMITED, details: { retryAfterSec, ...details } });
    this.retryAfterSec = retryAfterSec;
  }
}

/** Port non branché : le module échoue FERMÉ (jamais d'envoi sans la source de vérité des destinataires). */
export const portUnavailable = (port: string): InternalError =>
  new InternalError(`Le service « ${port} » n'est pas disponible : opération refusée.`, {
    code: NotifCode.PORT_UNAVAILABLE,
    details: { port },
  });
