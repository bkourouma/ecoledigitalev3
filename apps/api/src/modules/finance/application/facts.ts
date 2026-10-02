/**
 * Faits publiés pour les adaptateurs de la plateforme (`academic`, `reportcards`) — lectures seules, sans montant :
 *
 *  - `getInvoiceFacts`        : apprenant, inscription visée et lignes (catégorie, objet source) d'une facture — repli de
 *                               lecture du consommateur `finance.invoice.paid` d'academic quand la charge n'est pas enrichie ;
 *  - `getRegistrationFeeStatus` : « frais d'inscription soldés » d'une inscription (DÉCISION MÉTIER 2026-10-01 : la
 *                               confirmation d'une inscription suit le paiement des frais d'inscription) ;
 *  - `isRegistrationFeeDue`   : des frais d'inscription sont-ils dus pour ce périmètre ? (`false` = aucun barème, confirmation
 *                               immédiate ; `null` = inconnu) ;
 *  - `hasOverdueBalance`      : l'apprenant a-t-il une facture en retard ? (option « bloquer si impayé » des bulletins, sans détail).
 *
 * Extension ADDITIVE du module (spec 014 : requête « frais d'inscription soldés »). Limite assumée : les imputations de
 * paiement visent des ÉCHÉANCES ; une facture qui mêle frais d'inscription et scolarité n'est « soldée » qu'une fois
 * entièrement payée — les frais d'inscription se facturent à part (usage du legacy).
 */
import { ok, type AppError, type RequestContext, type Result } from "@ecoledigitale/kernel";
import { resolveFeeSchedule } from "../domain/fee-schedule";
import { FinanceCode } from "../domain/errors";
import type { IsoDate, Uuid } from "../domain/types";
import { getInvoice, getInvoiceLines } from "../infrastructure/billing-repository";
import { listFeeSchedules, listFees } from "../infrastructure/catalog-repository";
import { inTx, type FinanceDeps } from "./deps";

export interface InvoiceFacts {
  readonly invoiceId: Uuid;
  readonly learnerId: Uuid;
  readonly enrollmentId: Uuid | null;
  readonly status: string;
  readonly lines: ReadonlyArray<{ readonly category: string; readonly sourceRef: Uuid | null }>;
}

export async function getInvoiceFacts(deps: FinanceDeps, ctx: RequestContext, invoiceId: Uuid): Promise<Result<InvoiceFacts | null, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const invoice = await getInvoice(tx, invoiceId);
      if (!invoice) return ok(null);
      const lines = await getInvoiceLines(tx, invoiceId);
      return ok({ invoiceId, learnerId: invoice.learnerId, enrollmentId: invoice.enrollmentId, status: invoice.status, lines: lines.map((l) => ({ category: l.category, sourceRef: l.sourceRef })) });
    },
    { readOnly: true },
  );
}

export interface RegistrationFeeStatus {
  /** Au moins une facture ÉMISE de l'inscription contient des frais d'inscription. */
  readonly invoiced: boolean;
  /** Toutes les factures émises (non annulées) portant des frais d'inscription sont soldées. `false` si aucune. */
  readonly paid: boolean;
  readonly invoiceIds: readonly Uuid[];
}

export async function getRegistrationFeeStatus(deps: FinanceDeps, ctx: RequestContext, input: { enrollmentId: Uuid }): Promise<Result<RegistrationFeeStatus, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const rows = await tx.many<{ id: string; status: string }>(
        `SELECT DISTINCT i.id, i.status
           FROM finance.invoices i
           JOIN finance.invoice_lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
          WHERE i.enrollment_id = $1 AND l.category = 'REGISTRATION' AND i.status NOT IN ('DRAFT', 'CANCELLED')
          ORDER BY i.id`,
        [input.enrollmentId],
      );
      return ok({ invoiced: rows.length > 0, paid: rows.length > 0 && rows.every((r) => r.status === "PAID"), invoiceIds: rows.map((r) => r.id) });
    },
    { readOnly: true },
  );
}

export interface RegistrationFeeQuery {
  readonly academicYear: string;
  readonly institutionId?: Uuid | null | undefined;
  readonly campusId?: Uuid | null | undefined;
  readonly levelKey?: string | null | undefined;
  readonly trackKey?: string | null | undefined;
  readonly learnerType?: string | null | undefined;
  readonly onDate: IsoDate;
}

export async function isRegistrationFeeDue(deps: FinanceDeps, ctx: RequestContext, query: RegistrationFeeQuery): Promise<Result<boolean | null, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const fees = await listFees(tx, { activeOnly: true, category: "REGISTRATION" });
      if (fees.length === 0) return ok(false);
      const schedules = await listFeeSchedules(tx, { academicYear: query.academicYear, activeOnly: true });
      let unknown = false;
      for (const fee of fees) {
        const resolved = resolveFeeSchedule(schedules.filter((s) => s.feeId === fee.id), {
          feeId: fee.id,
          academicYear: query.academicYear,
          onDate: query.onDate,
          institutionId: query.institutionId ?? null,
          campusId: query.campusId ?? null,
          levelKey: query.levelKey ?? null,
          trackKey: query.trackKey ?? null,
          learnerType: query.learnerType ?? null,
        });
        if (resolved.ok) return ok(true);
        if (resolved.error.code !== FinanceCode.SCHEDULE_NOT_FOUND) unknown = true;
      }
      return ok(unknown ? null : false);
    },
    { readOnly: true },
  );
}

export async function hasOverdueBalance(deps: FinanceDeps, ctx: RequestContext, learnerId: Uuid): Promise<Result<boolean, AppError>> {
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const r = await tx.queryOne<{ overdue: boolean }>("SELECT EXISTS (SELECT 1 FROM finance.invoices WHERE learner_id = $1 AND status = 'OVERDUE') AS overdue", [learnerId]);
      return ok(r?.overdue === true);
    },
    { readOnly: true },
  );
}
