/**
 * Échéances EN RETARD, pour les relances d'impayés et les alertes du module `notifications` (spec v2/016) — lectures seules,
 * extension ADDITIVE publiée par `index.ts` (adaptateur de plateforme `finance-notifications`).
 *
 *  - `listOverdueInstallments` : échéances dont le reste dû est > 0, échues depuis au moins `minDaysOverdue` jours à la date
 *    `asOf`, sur une facture ÉMISE non annulée dont le PAYEUR est l'apprenant (les factures de financeurs ne relancent pas la
 *    famille). Triées par identifiant, paginées par curseur : aucune échéance ne manque ni ne se répète entre deux pages ;
 *  - `isInstallmentOverdue` : l'échéance est-elle toujours en retard ? Relue avant chaque envoi : arrêt dès paiement.
 * Aucun nom, aucune coordonnée : des identifiants, un numéro de facture, un reste dû (unités mineures + devise).
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { IsoDate, Uuid } from "../domain/types";
import { inTx, type FinanceDeps } from "./deps";

export interface OverdueInstallmentFact {
  readonly installmentId: Uuid;
  readonly invoiceId: Uuid;
  readonly invoiceNumber: string;
  readonly learnerId: Uuid;
  readonly dueDate: IsoDate;
  readonly daysOverdue: number;
  readonly remaining: { readonly amount: number; readonly currency: string };
}

export interface ListOverdueInstallmentsInput {
  readonly asOf: IsoDate;
  readonly minDaysOverdue: number;
  readonly limit: number;
  readonly afterInstallmentId?: Uuid | undefined;
}

export async function listOverdueInstallments(deps: FinanceDeps, ctx: RequestContext, input: ListOverdueInstallmentsInput): Promise<Result<OverdueInstallmentFact[], AppError>> {
  const limit = Math.min(Math.max(Math.trunc(input.limit), 1), 500);
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await tx.many<{ installmentId: string; invoiceId: string; invoiceNumber: string; learnerId: string; dueDate: string; daysOverdue: number; remaining: string; currency: string }>(
        `SELECT i.id AS "installmentId", v.id AS "invoiceId", v.number AS "invoiceNumber", v.learner_id AS "learnerId",
                to_char(i.due_date, 'YYYY-MM-DD') AS "dueDate", ($1::date - i.due_date)::int AS "daysOverdue",
                (i.amount - i.paid_amount - i.credited_amount)::text AS remaining, v.currency
           FROM finance.installments i
           JOIN finance.invoices v ON v.tenant_id = i.tenant_id AND v.id = i.invoice_id
          WHERE v.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND v.payer_kind = 'LEARNER' AND v.number IS NOT NULL
            AND i.paid_amount + i.credited_amount < i.amount
            AND ($1::date - i.due_date) >= $2::int
            AND ($3::uuid IS NULL OR i.id > $3::uuid)
          ORDER BY i.id
          LIMIT $4`,
        [input.asOf, Math.max(1, Math.trunc(input.minDaysOverdue)), input.afterInstallmentId ?? null, limit],
      );
      return ok(rows.map((r) => ({ installmentId: r.installmentId, invoiceId: r.invoiceId, invoiceNumber: r.invoiceNumber, learnerId: r.learnerId, dueDate: r.dueDate, daysOverdue: r.daysOverdue, remaining: { amount: Number(r.remaining), currency: r.currency } })));
    },
    { readOnly: true },
  );
}

export async function isInstallmentOverdue(deps: FinanceDeps, ctx: RequestContext, installmentId: Uuid, asOf: IsoDate): Promise<Result<boolean, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const r = await tx.queryOne<{ overdue: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM finance.installments i JOIN finance.invoices v ON v.tenant_id = i.tenant_id AND v.id = i.invoice_id
            WHERE i.id = $1 AND v.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE') AND i.paid_amount + i.credited_amount < i.amount AND i.due_date < $2::date
         ) AS overdue`,
        [installmentId, asOf],
      );
      return ok(r?.overdue === true);
    },
    { readOnly: true },
  );
}
