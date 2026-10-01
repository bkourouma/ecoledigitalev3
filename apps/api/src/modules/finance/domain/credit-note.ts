/**
 * CreditNote (avoir) : annule une partie (ou la totalité) du RESTE DÛ d'une facture
 * émise. Un avoir ne rembourse pas : pour un montant déjà encaissé on rembourse le
 * paiement d'abord (reprise d'imputation), puis on émet l'avoir.
 * Invariant : `payé + crédité ≤ total` reste vrai après l'avoir.
 */
import { err, ok, type AppError, type Money, type Result } from "@ecoledigitale/kernel";
import { FinanceCode, conflict, validation } from "./errors";
import { invoiceBalance, PAYABLE_INVOICE_STATUSES, type InvoiceAmounts } from "./invoice";
import { validateReason } from "./refund";
import type { InvoiceStatus } from "./types";

export interface CreditNoteCheck {
  invoice: { status: InvoiceStatus; amounts: InvoiceAmounts };
  amount: Money;
  reason: unknown;
}

export function validateCreditNote(check: CreditNoteCheck): Result<{ reason: string; balanceAfter: Money }, AppError> {
  if (!(PAYABLE_INVOICE_STATUSES as readonly string[]).includes(check.invoice.status)) {
    return err(
      conflict(FinanceCode.INVOICE_NOT_PAYABLE, "Un avoir s'émet sur une facture émise ayant un reste dû.", {
        status: check.invoice.status,
      }),
    );
  }
  if (!check.amount.isPositive()) {
    return err(validation(FinanceCode.INVALID_AMOUNT, "Le montant d'un avoir est strictement positif.", "amount"));
  }
  if (check.amount.currency !== check.invoice.amounts.total.currency) {
    return err(validation(FinanceCode.CURRENCY_MISMATCH, "Devise de l'avoir différente de celle de la facture.", "amount"));
  }
  const reason = validateReason(check.reason);
  if (!reason.ok) return reason;
  const balance = invoiceBalance(check.invoice.amounts);
  if (check.amount.gt(balance)) {
    return err(
      conflict(FinanceCode.CREDIT_EXCEEDS_BALANCE, "L'avoir dépasse le reste dû de la facture.", {
        balance: balance.amount,
        requested: check.amount.amount,
      }),
    );
  }
  return ok({ reason: reason.value, balanceAfter: balance.subtract(check.amount) });
}
