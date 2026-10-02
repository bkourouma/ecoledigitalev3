/**
 * Erreurs métier du module messaging : types du kernel + codes stables `messaging.*`
 * (ils font partie du contrat d'API, voir `MESSAGING_ERROR_CODES` des contrats ; ne jamais en renommer un).
 */
import { ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from "@ecoledigitale/kernel";

export const MessagingCode = {
  INVALID_INPUT: "messaging.invalid_input",
  FORBIDDEN: "messaging.forbidden",
  PORT_UNAVAILABLE: "messaging.port_unavailable",
  RECIPIENT_NOT_ALLOWED: "messaging.recipient_not_allowed",
  RECIPIENT_NOT_FOUND: "messaging.recipient_not_found",
  TOO_MANY_RECIPIENTS: "messaging.too_many_recipients",
  CONVERSATION_NOT_FOUND: "messaging.conversation_not_found",
  CONVERSATION_CLOSED: "messaging.conversation_closed",
  REPLIES_DISABLED: "messaging.replies_disabled",
  NOT_A_PARTICIPANT: "messaging.not_a_participant",
  MESSAGE_NOT_FOUND: "messaging.message_not_found",
  MESSAGE_TOO_LONG: "messaging.message_too_long",
  STUDENT_MESSAGING_DISABLED: "messaging.student_messaging_disabled",
  SENDER_RESTRICTED: "messaging.sender_restricted",
  RATE_LIMITED: "messaging.rate_limited",
  ATTACHMENTS_DISABLED: "messaging.attachments_disabled",
  ATTACHMENT_TOO_LARGE: "messaging.attachment_too_large",
  ATTACHMENT_TYPE_REJECTED: "messaging.attachment_type_rejected",
  ATTACHMENT_NOT_FOUND: "messaging.attachment_not_found",
  TOO_MANY_ATTACHMENTS: "messaging.too_many_attachments",
  ANNOUNCEMENT_NOT_FOUND: "messaging.announcement_not_found",
  ANNOUNCEMENT_NOT_EDITABLE: "messaging.announcement_not_editable",
  ANNOUNCEMENT_INVALID_STATE: "messaging.announcement_invalid_state",
  AUDIENCE_EMPTY: "messaging.audience_empty",
  TARGET_NOT_ALLOWED: "messaging.target_not_allowed",
  TARGET_NOT_FOUND: "messaging.target_not_found",
  REPORT_NOT_FOUND: "messaging.report_not_found",
  REPORT_ALREADY_DECIDED: "messaging.report_already_decided",
  ALREADY_REPORTED: "messaging.already_reported",
  TEMPLATE_NOT_FOUND: "messaging.template_not_found",
  NOTIFICATION_NOT_FOUND: "messaging.notification_not_found",
  RESTRICTION_NOT_FOUND: "messaging.restriction_not_found",
} as const;

export type MessagingCodeValue = (typeof MessagingCode)[keyof typeof MessagingCode];

export const validation = (
  code: MessagingCodeValue,
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], { code, ...(details ? { details } : {}) });
};

export const conflict = (code: MessagingCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: MessagingCodeValue, resource: string, id?: string): NotFoundError => NotFoundError.of(resource, id, { code });

export const forbidden = (code: MessagingCodeValue, message: string, details?: Record<string, unknown>): ForbiddenError =>
  new ForbiddenError(message, { code, ...(details ? { details } : {}) });

/** 429 : sous-classe de `ForbiddenError` (le kernel n'a pas de catégorie dédiée) ; la couche HTTP mappe sur 429 + Retry-After. */
export class RateLimitedError extends ForbiddenError {
  readonly retryAfterSec: number;
  constructor(message: string, retryAfterSec: number, details?: Record<string, unknown>) {
    super(message, { code: MessagingCode.RATE_LIMITED, details: { retryAfterSec, ...details } });
    this.retryAfterSec = retryAfterSec;
  }
}

/** Port non branché : le module échoue FERMÉ (aucun envoi sans la source de vérité des liens de tutelle). */
export const portUnavailable = (port: string): InternalError =>
  new InternalError(`Le service « ${port} » n'est pas disponible : opération refusée.`, {
    code: MessagingCode.PORT_UNAVAILABLE,
    details: { port },
  });
