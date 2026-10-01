/**
 * Erreurs métier du module finance : types du kernel + codes stables
 * `finance.*` (ils font partie du contrat d'API ; ne jamais en renommer un).
 */
import { ConflictError, NotFoundError, ValidationError, type Result, err } from "@ecoledigitale/kernel";

export const FinanceCode = {
  INVALID_AMOUNT: "finance.invalid_amount",
  INVALID_INPUT: "finance.invalid_input",
  CURRENCY_MISMATCH: "finance.currency_mismatch",
  INVALID_TRANSITION: "finance.invalid_transition",
  SCHEDULE_NOT_FOUND: "finance.fee_schedule_not_found",
  SCHEDULE_AMBIGUOUS: "finance.fee_schedule_ambiguous",
  SCHEDULE_OVERLAP: "finance.fee_schedule_overlap",
  PLAN_INVALID: "finance.installment_plan_invalid",
  INSTALLMENTS_LOCKED: "finance.installments_locked",
  INSTALLMENTS_MISMATCH: "finance.installments_sum_mismatch",
  INVOICE_NOT_FOUND: "finance.invoice_not_found",
  INVOICE_NOT_PAYABLE: "finance.invoice_not_payable",
  INVOICE_HAS_PAYMENTS: "finance.invoice_has_payments",
  INVOICE_NOT_DRAFT: "finance.invoice_not_draft",
  PAYMENT_NOT_FOUND: "finance.payment_not_found",
  PAYMENT_NOT_CONFIRMED: "finance.payment_not_confirmed",
  ALLOCATION_EXCEEDS_PAYMENT: "finance.allocation_exceeds_payment",
  ALLOCATION_EXCEEDS_REMAINING: "finance.allocation_exceeds_remaining",
  ALLOCATION_INVALID_TARGET: "finance.allocation_invalid_target",
  IDEMPOTENCY_KEY_REUSED: "finance.idempotency_key_reused",
  REFUND_EXCEEDS_REFUNDABLE: "finance.refund_exceeds_refundable",
  REFUND_NOT_FOUND: "finance.refund_not_found",
  REFUND_SELF_APPROVAL: "finance.refund_self_approval",
  CREDIT_EXCEEDS_BALANCE: "finance.credit_exceeds_balance",
  CASH_SESSION_REQUIRED: "finance.cash_session_required",
  CASH_SESSION_NOT_FOUND: "finance.cash_session_not_found",
  CASH_SESSION_ALREADY_OPEN: "finance.cash_session_already_open",
  CASH_SESSION_CLOSED: "finance.cash_session_closed",
  CASH_REGISTER_NOT_FOUND: "finance.cash_register_not_found",
  FUNDING_ASSIGNMENT_MISSING: "finance.funding_assignment_missing",
  PROVIDER_UNKNOWN: "finance.provider_unknown",
  PROVIDER_NOT_CONFIGURED: "finance.provider_not_configured",
  PROVIDER_SANDBOX_FORBIDDEN: "finance.provider_sandbox_forbidden",
  PROVIDER_FAILED: "finance.provider_failed",
  PROVIDER_AMOUNT_MISMATCH: "finance.provider_amount_mismatch",
  WEBHOOK_SIGNATURE_INVALID: "finance.webhook_signature_invalid",
  WEBHOOK_PAYLOAD_INVALID: "finance.webhook_payload_invalid",
  SIMULATED_IN_PRODUCTION: "finance.simulated_payment_in_production",
  LEARNER_NOT_FOUND: "finance.learner_not_found",
  ENROLLMENT_NOT_FOUND: "finance.enrollment_not_found",
  NOT_FOUND: "finance.not_found",
} as const;

export type FinanceCodeValue = (typeof FinanceCode)[keyof typeof FinanceCode];

export const validation = (
  code: FinanceCodeValue,
  message: string,
  path: string | ReadonlyArray<string | number> = "input",
  details?: Record<string, unknown>,
): ValidationError => {
  const p = typeof path === "string" ? [path] : path;
  return new ValidationError(message, [{ path: p, message, code }], {
    code,
    ...(details ? { details } : {}),
  });
};

export const conflict = (code: FinanceCodeValue, message: string, details?: Record<string, unknown>): ConflictError =>
  new ConflictError(message, { code, ...(details ? { details } : {}) });

export const notFound = (code: FinanceCodeValue, resource: string, id?: string): NotFoundError =>
  NotFoundError.of(resource, id, { code });

export const invalidTransition = (entity: string, from: string, to: string): ConflictError =>
  conflict(FinanceCode.INVALID_TRANSITION, `Transition interdite pour ${entity} : ${from} → ${to}.`, {
    entity,
    from,
    to,
  });

/** Raccourci : `fail(validation(...))` → `Err`. */
export const fail = <E>(error: E): Result<never, E> => err(error);
