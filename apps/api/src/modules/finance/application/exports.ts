/**
 * Exports CSV SERVEUR de la finance : factures, paiements, créances par apprenant.
 *
 * Un export lit TOUTES les lignes du filtre (pas la page affichée), dans UNE requête par jeu de données (instantané
 * cohérent), jusqu'à un PLAFOND (`FinanceConfig.exportMaxRows`, défaut 50 000 lignes). Au-delà, le fichier contient les
 * `maxRows` premières lignes et la troncature est SIGNALÉE : `truncated = true`, `totalCount` (lignes correspondant au
 * filtre) et `maxRows`, portés par les en-têtes HTTP `X-Export-*` et par la route `…/meta` (JSON typé) : un export tronqué
 * n'est jamais présenté comme complet. Chaque export est AUDITÉ (qui, quel jeu, quel filtre, combien de lignes).
 *
 * Colonne `apprenant` : « NOM Prénom » lu par LOT dans `people` (port `learners.getLearnerNames`) ; vide si indisponible.
 * Montants : entiers en unités mineures de la devise (XOF/XAF : le franc), colonne `devise` à côté ; dates `AAAA-MM-JJ`,
 * instants ISO UTC. Aucune donnée interne (clé d'idempotence, référence fournisseur) n'est exportée.
 */
import { newId, ok, type AppError, type CurrencyCode, type RequestContext, type Result } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { toCsv } from "../domain/csv";
import { invoiceBalance } from "../domain/invoice";
import { unallocatedAmount } from "../domain/payment";
import type { InvoiceStatus, PayerKind, PaymentMethod, PaymentStatus, Uuid } from "../domain/types";
import { listInvoices } from "../infrastructure/billing-repository";
import { listPayments } from "../infrastructure/payments-repository";
import { receivablesByLearner } from "../infrastructure/reports-repository";
import { EventBuffer, inTx, type FinanceDeps } from "./deps";
import { learnerNames } from "./learner-names";
import { scopeOf, type ReportFilter } from "./reports";

export const EXPORT_DATASETS = ["invoices", "payments", "receivables"] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

/** Plafond par défaut d'un export (lignes). */
export const DEFAULT_EXPORT_MAX_ROWS = 50_000;

export const EXPORT_COLUMNS: Readonly<Record<ExportDataset, readonly string[]>> = Object.freeze({
  invoices: ["numero", "statut", "apprenant_id", "apprenant", "annee", "classe", "payeur", "sous_total", "remise", "bourse", "total", "paye", "credite", "reste_du", "devise", "echeance", "emission"],
  payments: ["date", "statut", "apprenant_id", "apprenant", "payeur", "nom_payeur", "mode", "fournisseur", "reference", "montant", "impute", "non_impute", "rembourse", "devise", "confirme_le"],
  receivables: ["apprenant_id", "apprenant", "classe", "factures", "facture", "credite", "encaisse", "reste_du", "en_retard", "plus_ancien_retard", "taux_recouvrement_pct", "devise"],
});

export interface ExportInvoicesFilter {
  learnerId?: Uuid;
  academicYear?: string;
  status?: InvoiceStatus;
  groupKey?: string;
  payerKind?: PayerKind;
}
export interface ExportPaymentsFilter {
  learnerId?: Uuid;
  status?: PaymentStatus;
  method?: PaymentMethod;
  from?: string;
  to?: string;
}
export interface ExportReceivablesFilter extends ReportFilter {
  onlyOutstanding?: boolean;
}

export interface ExportMeta {
  dataset: ExportDataset;
  /** Lignes correspondant au filtre. */
  totalCount: number;
  /** Lignes présentes dans le fichier (`min(totalCount, maxRows)`). */
  rowCount: number;
  maxRows: number;
  truncated: boolean;
}
export interface CsvExport extends ExportMeta {
  csv: string;
}

export interface ExportOptions {
  /** Ne lit que les compteurs (route `…/meta`) : aucun fichier, aucune trace d'audit. */
  metaOnly?: boolean;
}

const maxRowsOf = (deps: FinanceDeps): number => Math.max(1, Math.floor(deps.config.exportMaxRows));
const metaOf = (dataset: ExportDataset, total: number, maxRows: number): ExportMeta => ({ dataset, totalCount: total, rowCount: Math.min(total, maxRows), maxRows, truncated: total > maxRows });
const iso = (d: Date | null): string => (d ? d.toISOString() : "");
const payerLabel = (k: PayerKind): string => (k === "FUNDER" ? "FINANCEUR" : "FAMILLE");

async function trace(deps: FinanceDeps, ctx: RequestContext, tx: Tx, out: ExportMeta, filter: unknown): Promise<void> {
  const events = new EventBuffer(deps, ctx);
  events.audit({
    action: "finance.export.generated",
    resourceType: "export",
    resourceId: newId(),
    after: { dataset: out.dataset, filter, rowCount: out.rowCount, totalCount: out.totalCount, truncated: out.truncated, maxRows: out.maxRows },
  });
  await events.flush(tx);
}

/**
 * Squelette commun : lecture (UNE requête, plafonnée, avec audit) puis noms d'apprenants (UNE lecture par lot, hors transaction),
 * puis mise en forme. `metaOnly` : compteurs seulement (ni fichier, ni noms, ni audit).
 */
async function runExport<T extends { learnerId: string }>(
  deps: FinanceDeps,
  ctx: RequestContext,
  dataset: ExportDataset,
  filter: unknown,
  options: ExportOptions,
  read: (tx: Tx, limit: number) => Promise<{ items: T[]; total: number }>,
  toRow: (item: T, name: string) => unknown[],
): Promise<Result<CsvExport, AppError>> {
  const maxRows = maxRowsOf(deps);
  const page = await inTx(
    deps,
    ctx,
    async (tx) => {
      const p = await read(tx, options.metaOnly ? 1 : maxRows);
      if (!options.metaOnly) await trace(deps, ctx, tx, metaOf(dataset, p.total, maxRows), filter);
      return ok(p);
    },
    { readOnly: options.metaOnly === true },
  );
  if (!page.ok) return page;
  const meta = metaOf(dataset, page.value.total, maxRows);
  if (options.metaOnly) return ok({ ...meta, csv: toCsv(EXPORT_COLUMNS[dataset], []) });
  const names = await learnerNames(deps, ctx, page.value.items.map((i) => i.learnerId));
  return ok({ ...meta, csv: toCsv(EXPORT_COLUMNS[dataset], page.value.items.map((i) => toRow(i, names.get(i.learnerId) ?? ""))) });
}

export function exportInvoicesCsv(deps: FinanceDeps, ctx: RequestContext, filter: ExportInvoicesFilter = {}, options: ExportOptions = {}): Promise<Result<CsvExport, AppError>> {
  return runExport(deps, ctx, "invoices", filter, options, (tx, limit) => listInvoices(tx, { ...filter, limit, offset: 0 }), (i, name) => [
    i.number,
    i.status,
    i.learnerId,
    name,
    i.academicYear,
    i.groupLabel ?? i.groupKey,
    payerLabel(i.payerKind),
    i.subtotal.amount,
    i.discount.amount,
    i.scholarship.amount,
    i.total.amount,
    i.paid.amount,
    i.credited.amount,
    invoiceBalance({ total: i.total, paid: i.paid, credited: i.credited }).amount,
    i.currency,
    i.dueDate,
    iso(i.issuedAt),
  ]);
}

export function exportPaymentsCsv(deps: FinanceDeps, ctx: RequestContext, filter: ExportPaymentsFilter = {}, options: ExportOptions = {}): Promise<Result<CsvExport, AppError>> {
  return runExport(deps, ctx, "payments", filter, options, (tx, limit) => listPayments(tx, { ...filter, limit, offset: 0 }), (p, name) => [
    iso(p.receivedAt),
    p.status,
    p.learnerId,
    name,
    payerLabel(p.payerKind),
    p.payerName,
    p.method,
    p.provider,
    p.reference,
    p.amount.amount,
    p.allocated.amount,
    p.status === "CONFIRMED" ? unallocatedAmount(p).amount : 0,
    p.refunded.amount,
    p.amount.currency,
    iso(p.confirmedAt),
  ]);
}

export async function exportReceivablesCsv(deps: FinanceDeps, ctx: RequestContext, filter: ExportReceivablesFilter = {}, options: ExportOptions = {}): Promise<Result<CsvExport, AppError>> {
  const scope = scopeOf(deps, filter);
  if (!scope.ok) return scope;
  const currency: CurrencyCode = scope.value.currency;
  return runExport(
    deps,
    ctx,
    "receivables",
    { ...filter },
    options,
    (tx, limit) => receivablesByLearner(tx, scope.value, { limit, offset: 0, onlyOutstanding: filter.onlyOutstanding ?? true }),
    (r, name) => [
      r.learnerId,
      name,
      r.label ?? r.key,
      r.invoiceCount,
      r.billed.amount,
      r.credited.amount,
      r.collected.amount,
      r.outstanding.amount,
      r.overdue.amount,
      r.oldestOverdueDate,
      r.collectionRateBps === null ? "" : (r.collectionRateBps / 100).toFixed(2),
      currency,
    ],
  );
}
