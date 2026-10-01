/**
 * Requêtes de reporting : facturé, encaissé, restant dû, retard, taux de recouvrement,
 * créances par classe et par apprenant, évolution des encaissements, balance âgée.
 *
 * Définitions (alignées sur `domain/reporting.ts`, qui sert de référence aux tests) :
 *   - FACTURÉ        = Σ totaux des factures émises (DRAFT et CANCELLED exclues) ;
 *   - CRÉDITÉ        = Σ avoirs ; FACTURÉ NET = facturé − crédité ;
 *   - ENCAISSÉ       = Σ imputations nettes des remboursements sur ces factures ;
 *   - RESTANT DÛ     = facturé net − encaissé ;
 *   - EN RETARD      = Σ reste dû des échéances échues (date < `asOf`) des factures actives ;
 *   - TAUX           = encaissé / facturé net, en points de base (HALF_UP) ; `null` si rien à recouvrer.
 *
 * Toute l'agrégation se fait en SQL (entiers bigint) ; les sommes reviennent en chaîne
 * et sont reconstruites en `Money`. La RLS isole le tenant, sans `WHERE tenant_id`.
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { AGING_BUCKETS, collectionRateBps, type AgingBucket } from "../domain/reporting";
import type { IsoDate } from "../domain/types";
import { money } from "./rows";

export interface ReportScope {
  currency: CurrencyCode;
  academicYear?: string;
  campusId?: string;
  groupKey?: string;
  asOf: IsoDate;
}

const BILLED = "('ISSUED','PARTIALLY_PAID','PAID','OVERDUE','CREDITED')";
const ACTIVE = "('ISSUED','PARTIALLY_PAID','OVERDUE')";

const scopeParams = (s: ReportScope): unknown[] => [s.currency, s.academicYear ?? null, s.campusId ?? null, s.groupKey ?? null, s.asOf];
const SCOPE_WHERE = `inv.currency = $1 AND ($2::text IS NULL OR inv.academic_year = $2)
  AND ($3::uuid IS NULL OR inv.campus_id = $3) AND ($4::text IS NULL OR inv.group_key = $4)`;

export interface FinanceSummary {
  currency: CurrencyCode;
  asOf: IsoDate;
  invoiceCount: number;
  billed: Money;
  credited: Money;
  netBilled: Money;
  collected: Money;
  outstanding: Money;
  overdue: Money;
  overdueInvoiceCount: number;
  /** Paiements confirmés non encore imputés (avance / trop-perçu). */
  unallocatedPayments: Money;
  collectionRateBps: number | null;
}

export async function financeSummary(tx: Tx, scope: ReportScope): Promise<FinanceSummary> {
  const p = scopeParams(scope);
  const row = await tx.queryOne<Record<string, string>>(
    `SELECT count(*)::text AS invoices,
            COALESCE(sum(inv.total_amount), 0)::text AS billed,
            COALESCE(sum(inv.credited_amount), 0)::text AS credited,
            COALESCE(sum(inv.paid_amount), 0)::text AS collected
       FROM finance.invoices inv WHERE inv.status IN ${BILLED} AND ${SCOPE_WHERE}`,
    p.slice(0, 4),
  );
  const od = await tx.queryOne<Record<string, string>>(
    `SELECT COALESCE(sum(i.amount - i.paid_amount - i.credited_amount), 0)::text AS overdue,
            count(DISTINCT inv.id)::text AS invoices
       FROM finance.installments i JOIN finance.invoices inv ON inv.id = i.invoice_id
      WHERE inv.status IN ${ACTIVE} AND i.due_date < $5::date AND i.paid_amount + i.credited_amount < i.amount AND ${SCOPE_WHERE}`,
    p,
  );
  const un = await tx.queryOne<Record<string, string>>(
    `SELECT COALESCE(sum(amount - allocated_amount - refunded_amount), 0)::text AS s
       FROM finance.payments WHERE status = 'CONFIRMED' AND currency = $1`,
    [scope.currency],
  );
  const billed = money(row!.billed, scope.currency);
  const credited = money(row!.credited, scope.currency);
  const collected = money(row!.collected, scope.currency);
  const netBilled = billed.subtract(credited);
  return {
    currency: scope.currency,
    asOf: scope.asOf,
    invoiceCount: Number(row!.invoices),
    billed,
    credited,
    netBilled,
    collected,
    outstanding: netBilled.subtract(collected),
    overdue: money(od!.overdue, scope.currency),
    overdueInvoiceCount: Number(od!.invoices),
    unallocatedPayments: money(un!.s, scope.currency),
    collectionRateBps: collectionRateBps(collected, netBilled),
  };
}

export interface ReceivableRow {
  key: string | null;
  label: string | null;
  invoiceCount: number;
  learnerCount: number;
  billed: Money;
  credited: Money;
  collected: Money;
  outstanding: Money;
  overdue: Money;
  collectionRateBps: number | null;
}

function receivableOf(r: Record<string, any>, currency: CurrencyCode): ReceivableRow {
  const billed = money(r.billed, currency);
  const credited = money(r.credited, currency);
  const collected = money(r.collected, currency);
  const netBilled = billed.subtract(credited);
  return {
    key: r.key,
    label: r.label ?? null,
    invoiceCount: Number(r.invoices),
    learnerCount: Number(r.learners),
    billed,
    credited,
    collected,
    outstanding: netBilled.subtract(collected),
    overdue: money(r.overdue, currency),
    collectionRateBps: collectionRateBps(collected, netBilled),
  };
}

const RECEIVABLE_CTE = `
WITH inv AS (
  SELECT inv.* FROM finance.invoices inv WHERE inv.status IN ${BILLED} AND ${SCOPE_WHERE}
), od AS (
  SELECT i.invoice_id, sum(i.amount - i.paid_amount - i.credited_amount) AS overdue
    FROM finance.installments i JOIN inv ON inv.id = i.invoice_id
   WHERE inv.status IN ${ACTIVE} AND i.due_date < $5::date AND i.paid_amount + i.credited_amount < i.amount
   GROUP BY i.invoice_id
)`;

/** Créances par classe : `group_key` libre fourni par `EnrollmentRef` (instantané sur la facture). */
export async function receivablesByGroup(tx: Tx, scope: ReportScope): Promise<ReceivableRow[]> {
  const rows = await tx.many(
    `${RECEIVABLE_CTE}
     SELECT inv.group_key AS key, max(inv.group_label) AS label, count(*)::text AS invoices,
            count(DISTINCT inv.learner_id)::text AS learners,
            COALESCE(sum(inv.total_amount), 0)::text AS billed, COALESCE(sum(inv.credited_amount), 0)::text AS credited,
            COALESCE(sum(inv.paid_amount), 0)::text AS collected, COALESCE(sum(od.overdue), 0)::text AS overdue
       FROM inv LEFT JOIN od ON od.invoice_id = inv.id
      GROUP BY inv.group_key
      ORDER BY (COALESCE(sum(inv.total_amount - inv.credited_amount - inv.paid_amount), 0)) DESC, inv.group_key NULLS LAST`,
    scopeParams(scope),
  );
  return rows.map((r) => receivableOf(r, scope.currency));
}

export interface LearnerReceivableRow extends ReceivableRow {
  learnerId: string;
  oldestOverdueDate: IsoDate | null;
}

export async function receivablesByLearner(
  tx: Tx,
  scope: ReportScope,
  options: { limit: number; offset: number; onlyOutstanding: boolean },
): Promise<{ items: LearnerReceivableRow[]; total: number }> {
  const sql = `${RECEIVABLE_CTE},
   agg AS (
     SELECT inv.learner_id, max(inv.group_key) AS key, max(inv.group_label) AS label, count(*) AS invoices,
            COALESCE(sum(inv.total_amount), 0) AS billed, COALESCE(sum(inv.credited_amount), 0) AS credited,
            COALESCE(sum(inv.paid_amount), 0) AS collected, COALESCE(sum(od.overdue), 0) AS overdue,
            COALESCE(sum(inv.total_amount - inv.credited_amount - inv.paid_amount), 0) AS outstanding
       FROM inv LEFT JOIN od ON od.invoice_id = inv.id GROUP BY inv.learner_id
   )`;
  const params = [...scopeParams(scope), options.onlyOutstanding];
  const rows = await tx.many(
    `${sql}
     SELECT agg.learner_id, agg.key, agg.label, agg.invoices::text AS invoices, '1' AS learners,
            agg.billed::text AS billed, agg.credited::text AS credited, agg.collected::text AS collected, agg.overdue::text AS overdue,
            (SELECT min(i.due_date)::text FROM finance.installments i JOIN inv ON inv.id = i.invoice_id
              WHERE inv.learner_id = agg.learner_id AND inv.status IN ${ACTIVE} AND i.due_date < $5::date
                AND i.paid_amount + i.credited_amount < i.amount) AS oldest_overdue
       FROM agg WHERE ($6::boolean IS NOT TRUE OR agg.outstanding > 0)
      ORDER BY agg.outstanding DESC, agg.learner_id LIMIT $7 OFFSET $8`,
    [...params, options.limit, options.offset],
  );
  const count = await tx.queryOne<{ n: string }>(
    `${sql} SELECT count(*)::text AS n FROM agg WHERE ($6::boolean IS NOT TRUE OR agg.outstanding > 0)`,
    params,
  );
  return {
    items: rows.map((r) => ({ ...receivableOf(r, scope.currency), learnerId: r.learner_id, oldestOverdueDate: r.oldest_overdue })),
    total: Number(count?.n ?? 0),
  };
}

export type TrendGranularity = "day" | "week" | "month";

export interface TrendPoint {
  /** Premier jour du seau (`YYYY-MM-DD`, fuseau Africa/Abidjan). */
  bucket: IsoDate;
  collected: Money;
  refunded: Money;
  net: Money;
  paymentCount: number;
}

/** Évolution des encaissements (paiements confirmés) et des remboursements, seaux sans trou. */
export async function collectionsTrend(
  tx: Tx,
  options: { currency: CurrencyCode; from: IsoDate; to: IsoDate; granularity: TrendGranularity },
): Promise<TrendPoint[]> {
  if (!["day", "week", "month"].includes(options.granularity)) throw new Error("Granularité invalide.");
  const rows = await tx.many(
    `WITH buckets AS (
       SELECT generate_series(date_trunc($4, $2::date::timestamp), $3::date::timestamp, ('1 ' || $4)::interval)::date AS bucket
     ), flow_in AS (
       SELECT date_trunc($4, p.confirmed_at AT TIME ZONE 'Africa/Abidjan')::date AS bucket, sum(p.amount) AS s, count(*) AS n
         FROM finance.payments p
        WHERE p.status IN ('CONFIRMED','REFUNDED') AND p.currency = $1
          AND (p.confirmed_at AT TIME ZONE 'Africa/Abidjan')::date BETWEEN $2::date AND $3::date
        GROUP BY 1
     ), flow_out AS (
       SELECT date_trunc($4, r.completed_at AT TIME ZONE 'Africa/Abidjan')::date AS bucket, sum(r.amount) AS s
         FROM finance.refunds r
        WHERE r.status = 'COMPLETED' AND r.currency = $1
          AND (r.completed_at AT TIME ZONE 'Africa/Abidjan')::date BETWEEN $2::date AND $3::date
        GROUP BY 1
     )
     SELECT b.bucket::text AS bucket, COALESCE(i.s, 0)::text AS collected, COALESCE(o.s, 0)::text AS refunded,
            (COALESCE(i.s, 0) - COALESCE(o.s, 0))::text AS net, COALESCE(i.n, 0)::text AS n
       FROM buckets b LEFT JOIN flow_in i USING (bucket) LEFT JOIN flow_out o USING (bucket)
      ORDER BY b.bucket`,
    [options.currency, options.from, options.to, options.granularity],
  );
  return rows.map((r) => ({
    bucket: r.bucket,
    collected: money(r.collected, options.currency),
    refunded: money(r.refunded, options.currency),
    net: money(r.net, options.currency),
    paymentCount: Number(r.n),
  }));
}

export interface AgedBalanceReport {
  asOf: IsoDate;
  currency: CurrencyCode;
  buckets: Record<AgingBucket, { amount: Money; invoiceCount: number }>;
  total: Money;
}

const AGE_CASE = `CASE WHEN $5::date - i.due_date <= 0 THEN 'NOT_DUE'
                       WHEN $5::date - i.due_date <= 30 THEN 'D1_30'
                       WHEN $5::date - i.due_date <= 60 THEN 'D31_60'
                       WHEN $5::date - i.due_date <= 90 THEN 'D61_90'
                       ELSE 'D91_PLUS' END`;

/** Balance âgée : reste dû de chaque échéance des factures actives, par ancienneté à `asOf`. */
export async function agedBalance(tx: Tx, scope: ReportScope): Promise<AgedBalanceReport> {
  const rows = await tx.many<{ bucket: AgingBucket; s: string; n: string }>(
    `SELECT ${AGE_CASE} AS bucket, sum(i.amount - i.paid_amount - i.credited_amount)::text AS s, count(DISTINCT inv.id)::text AS n
       FROM finance.installments i JOIN finance.invoices inv ON inv.id = i.invoice_id
      WHERE inv.status IN ${ACTIVE} AND i.paid_amount + i.credited_amount < i.amount AND ${SCOPE_WHERE}
      GROUP BY 1`,
    scopeParams(scope),
  );
  const buckets = Object.fromEntries(
    AGING_BUCKETS.map((b) => [b, { amount: Money.zero(scope.currency), invoiceCount: 0 }]),
  ) as AgedBalanceReport["buckets"];
  for (const r of rows) buckets[r.bucket] = { amount: money(r.s, scope.currency), invoiceCount: Number(r.n) };
  const total = AGING_BUCKETS.reduce((acc, b) => acc.add(buckets[b].amount), Money.zero(scope.currency));
  return { asOf: scope.asOf, currency: scope.currency, buckets, total };
}

export interface AgedLearnerRow {
  learnerId: string;
  buckets: Record<AgingBucket, Money>;
  total: Money;
}

export async function agedBalanceByLearner(tx: Tx, scope: ReportScope, limit: number): Promise<AgedLearnerRow[]> {
  const rows = await tx.many(
    `SELECT inv.learner_id,
            COALESCE(sum(rem) FILTER (WHERE b = 'NOT_DUE'), 0)::text AS not_due,
            COALESCE(sum(rem) FILTER (WHERE b = 'D1_30'), 0)::text AS d1_30,
            COALESCE(sum(rem) FILTER (WHERE b = 'D31_60'), 0)::text AS d31_60,
            COALESCE(sum(rem) FILTER (WHERE b = 'D61_90'), 0)::text AS d61_90,
            COALESCE(sum(rem) FILTER (WHERE b = 'D91_PLUS'), 0)::text AS d91_plus,
            sum(rem)::text AS total
       FROM (SELECT inv.id, inv.learner_id, i.amount - i.paid_amount - i.credited_amount AS rem, ${AGE_CASE} AS b
               FROM finance.installments i JOIN finance.invoices inv ON inv.id = i.invoice_id
              WHERE inv.status IN ${ACTIVE} AND i.paid_amount + i.credited_amount < i.amount AND ${SCOPE_WHERE}) inv
      GROUP BY inv.learner_id ORDER BY sum(rem) DESC, inv.learner_id LIMIT $6`,
    [...scopeParams(scope), limit],
  );
  const c = scope.currency;
  return rows.map((r) => ({
    learnerId: r.learner_id,
    buckets: {
      NOT_DUE: money(r.not_due, c),
      D1_30: money(r.d1_30, c),
      D31_60: money(r.d31_60, c),
      D61_90: money(r.d61_90, c),
      D91_PLUS: money(r.d91_plus, c),
    },
    total: money(r.total, c),
  }));
}
