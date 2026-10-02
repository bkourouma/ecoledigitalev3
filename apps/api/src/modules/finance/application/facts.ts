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

/**
 * État explicite des frais d'inscription d'une inscription :
 *  - `NOT_BILLED` : aucune facture ÉMISE (non annulée) ne porte de frais d'inscription — état normal AVANT la facturation
 *                   (inscription inconnue de finance comprise) : jamais une erreur et JAMAIS « payé » ;
 *  - `PENDING`    : facturés, au moins une facture n'est pas soldée ;
 *  - `PAID`       : toutes les factures émises portant des frais d'inscription sont soldées.
 */
export type RegistrationFeeState = "NOT_BILLED" | "PENDING" | "PAID";

export interface RegistrationFeeStatus {
  /** Au moins une facture ÉMISE de l'inscription contient des frais d'inscription. */
  readonly invoiced: boolean;
  /** Toutes les factures émises (non annulées) portant des frais d'inscription sont soldées. `false` si aucune. */
  readonly paid: boolean;
  readonly invoiceIds: readonly Uuid[];
  /** État explicite (voir `RegistrationFeeState`) : `NOT_BILLED` quand `invoiced` est faux. */
  readonly status: RegistrationFeeState;
}

/** État des frais d'inscription d'après les statuts des factures émises qui en portent (fonction pure). */
export function registrationFeeStateOf(invoiceStatuses: readonly string[]): RegistrationFeeState {
  if (invoiceStatuses.length === 0) return "NOT_BILLED";
  return invoiceStatuses.every((s) => s === "PAID") ? "PAID" : "PENDING";
}

/**
 * « Frais d'inscription soldés » d'une inscription. Utilisable AVANT toute facturation : sans facture émise, l'état est
 * `NOT_BILLED` (`invoiced: false`, `paid: false`), jamais une erreur ni « payé ». Une facture annulée n'est plus comptée.
 */
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
      const status = registrationFeeStateOf(rows.map((r) => r.status));
      return ok({ invoiced: rows.length > 0, paid: status === "PAID", invoiceIds: rows.map((r) => r.id), status });
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

// ---------------------------------------------------------------------------
// Lectures « solde » pour stateassign (spec 014 AC5.5, spec 006) — montants ENTIERS en unité mineure, lectures seules
// ---------------------------------------------------------------------------

/** Totaux d'un ensemble de factures ÉMISES (ni brouillon, ni annulées) dans une devise ; `outstanding = billed - credited - paid`. */
export interface InvoiceTotals {
  readonly currency: string;
  readonly invoiceCount: number;
  readonly billed: number;
  readonly credited: number;
  readonly paid: number;
  readonly outstanding: number;
}

export interface LearnerStanding extends InvoiceTotals {
  readonly learnerId: Uuid;
  readonly academicYear: string | null;
  /** Au moins une facture est en retard (`OVERDUE`) : aucun montant exposé séparément. */
  readonly hasOverdue: boolean;
}

export interface BilledAmounts extends InvoiceTotals {
  readonly enrollmentId: Uuid;
  /** Part facturée à la FAMILLE (payeur `LEARNER`) et part des FINANCEURS (`FUNDER`) ; leur somme est `billed`. */
  readonly byPayer: { readonly LEARNER: number; readonly FUNDER: number };
}

interface TotalsRow {
  invoice_count: string;
  billed: string | null;
  credited: string | null;
  paid: string | null;
  overdue_count?: string;
  learner_part?: string | null;
  funder_part?: string | null;
}

function totalsOf(row: TotalsRow | null, currency: string): InvoiceTotals {
  const billed = Number(row?.billed ?? 0);
  const credited = Number(row?.credited ?? 0);
  const paid = Number(row?.paid ?? 0);
  return { currency, invoiceCount: Number(row?.invoice_count ?? 0), billed, credited, paid, outstanding: Math.max(0, billed - credited - paid) };
}

/** Solde d'un apprenant (toutes factures émises, éventuellement d'une année) : facturé, avoirs, encaissé, reste dû, retard. */
export async function getLearnerStanding(deps: FinanceDeps, ctx: RequestContext, input: { learnerId: Uuid; academicYear?: string | undefined }): Promise<Result<LearnerStanding, AppError>> {
  const currency = deps.config.defaultCurrency;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await tx.queryOne<TotalsRow>(
        `SELECT count(*)::text AS invoice_count, sum(i.total_amount)::text AS billed, sum(i.credited_amount)::text AS credited, sum(i.paid_amount)::text AS paid,
                (count(*) FILTER (WHERE i.status = 'OVERDUE'))::text AS overdue_count
           FROM finance.invoices i
          WHERE i.learner_id = $1 AND ($2::text IS NULL OR i.academic_year = $2) AND i.status NOT IN ('DRAFT', 'CANCELLED') AND i.currency = $3`,
        [input.learnerId, input.academicYear ?? null, currency],
      );
      return ok({ learnerId: input.learnerId, academicYear: input.academicYear ?? null, ...totalsOf(row, currency), hasOverdue: Number(row?.overdue_count ?? 0) > 0 });
    },
    { readOnly: true },
  );
}

/** Totaux des factures dont le payeur est le financeur désigné (`payerKind = FUNDER`, `payerRef` = identifiant de la bourse). */
export async function getLinkedInvoicesTotals(deps: FinanceDeps, ctx: RequestContext, scholarshipId: Uuid): Promise<Result<InvoiceTotals, AppError>> {
  const currency = deps.config.defaultCurrency;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await tx.queryOne<TotalsRow>(
        `SELECT count(*)::text AS invoice_count, sum(i.total_amount)::text AS billed, sum(i.credited_amount)::text AS credited, sum(i.paid_amount)::text AS paid
           FROM finance.invoices i
          WHERE i.payer_kind = 'FUNDER' AND i.payer_ref = $1 AND i.status NOT IN ('DRAFT', 'CANCELLED') AND i.currency = $2`,
        [scholarshipId, currency],
      );
      return ok(totalsOf(row, currency));
    },
    { readOnly: true },
  );
}

/** Montants facturés d'une inscription, séparés entre la part de la famille et celle des financeurs. */
export async function getBilledAmounts(deps: FinanceDeps, ctx: RequestContext, input: { enrollmentId: Uuid }): Promise<Result<BilledAmounts, AppError>> {
  const currency = deps.config.defaultCurrency;
  return inTx(
    deps,
    ctx,
    async (tx) => {
      const row = await tx.queryOne<TotalsRow>(
        `SELECT count(*)::text AS invoice_count, sum(i.total_amount)::text AS billed, sum(i.credited_amount)::text AS credited, sum(i.paid_amount)::text AS paid,
                (sum(i.total_amount) FILTER (WHERE i.payer_kind = 'LEARNER'))::text AS learner_part,
                (sum(i.total_amount) FILTER (WHERE i.payer_kind = 'FUNDER'))::text AS funder_part
           FROM finance.invoices i
          WHERE i.enrollment_id = $1 AND i.status NOT IN ('DRAFT', 'CANCELLED') AND i.currency = $2`,
        [input.enrollmentId, currency],
      );
      return ok({ enrollmentId: input.enrollmentId, ...totalsOf(row, currency), byPayer: { LEARNER: Number(row?.learner_part ?? 0), FUNDER: Number(row?.funder_part ?? 0) } });
    },
    { readOnly: true },
  );
}
