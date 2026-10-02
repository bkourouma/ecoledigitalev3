/**
 * Audit INDÉPENDANT du grand livre d'un tenant : recalcule, en SQL brut (superutilisateur, sans
 * passer par le code du module), les invariants comptables. Sert aux tests de propriétés : quelles
 * que soient les opérations enchaînées (y compris concurrentes), ces égalités doivent tenir.
 */
import type { FinanceTestDb } from "./db";

/** Local (et non importé de ./db) : ce module doit rester chargeable hors vitest (exercice de restauration, infra/scripts/restore-drill). */
async function adminRows<R = Record<string, any>>(db: Pick<FinanceTestDb, "admin">, sql: string, params: unknown[] = []): Promise<R[]> {
  return (await db.admin.query(sql, params)).rows as R[];
}

export interface LedgerReport {
  payments: number;
  invoices: number;
  receipts: number;
  billed: number;
  collected: number;
  unallocated: number;
  refunded: number;
}

async function violations(db: Pick<FinanceTestDb, "admin">, label: string, sql: string, params: unknown[]): Promise<string[]> {
  const rows = await adminRows<Record<string, unknown>>(db, sql, params);
  return rows.map((r) => `${label}: ${JSON.stringify(r)}`);
}

export async function ledgerViolations(db: Pick<FinanceTestDb, "admin">, tenantId: string): Promise<string[]> {
  const t = [tenantId];
  const out: string[] = [];

  out.push(
    ...(await violations(
      db,
      "paiement: imputé + remboursé > montant ou négatif",
      `SELECT id FROM finance.payments WHERE tenant_id = $1 AND (allocated_amount < 0 OR refunded_amount < 0 OR allocated_amount + refunded_amount > amount)`,
      t,
    )),
    ...(await violations(
      db,
      "paiement: imputé ≠ imputations nettes",
      `SELECT p.id FROM finance.payments p WHERE p.tenant_id = $1 AND p.allocated_amount <>
         COALESCE((SELECT sum(a.amount) FROM finance.payment_allocations a WHERE a.payment_id = p.id), 0)
       - COALESCE((SELECT sum(r.amount) FROM finance.allocation_reversals r WHERE r.payment_id = p.id), 0)`,
      t,
    )),
    ...(await violations(
      db,
      "paiement: remboursé ≠ remboursements terminés",
      `SELECT p.id FROM finance.payments p WHERE p.tenant_id = $1 AND p.refunded_amount <>
         COALESCE((SELECT sum(r.amount) FROM finance.refunds r WHERE r.payment_id = p.id AND r.status = 'COMPLETED'), 0)`,
      t,
    )),
    ...(await violations(
      db,
      "paiement: REFUNDED ⇔ tout remboursé",
      `SELECT id FROM finance.payments WHERE tenant_id = $1 AND ((status = 'REFUNDED') <> (refunded_amount = amount))`,
      t,
    )),
    ...(await violations(
      db,
      "paiement confirmé sans reçu (ou reçu sur paiement non confirmé)",
      `SELECT p.id, p.status FROM finance.payments p WHERE p.tenant_id = $1
         AND ((p.status IN ('CONFIRMED','REFUNDED')) <> EXISTS (SELECT 1 FROM finance.receipts r WHERE r.payment_id = p.id))`,
      t,
    )),
    ...(await violations(
      db,
      "facture: payé ≠ imputations nettes",
      `SELECT i.id FROM finance.invoices i WHERE i.tenant_id = $1 AND i.paid_amount <>
         COALESCE((SELECT sum(a.amount) FROM finance.payment_allocations a WHERE a.invoice_id = i.id), 0)
       - COALESCE((SELECT sum(r.amount) FROM finance.allocation_reversals r JOIN finance.payment_allocations a ON a.id = r.allocation_id WHERE a.invoice_id = i.id), 0)`,
      t,
    )),
    ...(await violations(
      db,
      "facture: crédité ≠ avoirs",
      `SELECT i.id FROM finance.invoices i WHERE i.tenant_id = $1 AND i.credited_amount <>
         COALESCE((SELECT sum(c.amount) FROM finance.credit_notes c WHERE c.invoice_id = i.id), 0)`,
      t,
    )),
    ...(await violations(
      db,
      "facture: total ≠ somme des lignes",
      `SELECT i.id FROM finance.invoices i WHERE i.tenant_id = $1 AND i.total_amount <>
         COALESCE((SELECT sum(l.total_amount) FROM finance.invoice_lines l WHERE l.invoice_id = i.id), 0)`,
      t,
    )),
    ...(await violations(
      db,
      "facture émise: Σ échéances ≠ total, ou payé/crédité ≠ Σ échéances",
      `SELECT i.id FROM finance.invoices i WHERE i.tenant_id = $1 AND i.status <> 'DRAFT' AND i.status <> 'CANCELLED' AND (
         i.total_amount <> COALESCE((SELECT sum(n.amount) FROM finance.installments n WHERE n.invoice_id = i.id), -1)
         OR i.paid_amount <> COALESCE((SELECT sum(n.paid_amount) FROM finance.installments n WHERE n.invoice_id = i.id), 0)
         OR i.credited_amount <> COALESCE((SELECT sum(n.credited_amount) FROM finance.installments n WHERE n.invoice_id = i.id), 0))`,
      t,
    )),
    ...(await violations(
      db,
      "échéance: payé + crédité > montant",
      `SELECT id FROM finance.installments WHERE tenant_id = $1 AND (paid_amount < 0 OR credited_amount < 0 OR paid_amount + credited_amount > amount)`,
      t,
    )),
    ...(await violations(
      db,
      "facture: statut incohérent avec les montants",
      `SELECT id, status, total_amount, paid_amount, credited_amount FROM finance.invoices WHERE tenant_id = $1 AND (
         (status = 'PAID' AND NOT (paid_amount + credited_amount = total_amount AND paid_amount > 0))
         OR (status = 'CREDITED' AND NOT (credited_amount = total_amount))
         OR (status = 'CANCELLED' AND (paid_amount <> 0 OR credited_amount <> 0))
         OR (status = 'DRAFT' AND (paid_amount <> 0 OR credited_amount <> 0))
         OR (status IN ('ISSUED') AND paid_amount <> 0)
         OR (status IN ('PARTIALLY_PAID') AND (paid_amount = 0 OR paid_amount + credited_amount = total_amount))
         OR (status IN ('ISSUED','PARTIALLY_PAID','OVERDUE') AND paid_amount + credited_amount = total_amount))`,
      t,
    )),
    ...(await violations(
      db,
      "numérotation: trous ou doublons",
      `SELECT kind, year, n, mx FROM (
         SELECT 'INVOICE' AS kind, number_year AS year, count(*) AS n, max(number_seq) AS mx FROM finance.invoices WHERE tenant_id = $1 AND number IS NOT NULL GROUP BY number_year
         UNION ALL SELECT 'RECEIPT', number_year, count(*), max(number_seq) FROM finance.receipts WHERE tenant_id = $1 GROUP BY number_year
         UNION ALL SELECT 'CREDIT_NOTE', number_year, count(*), max(number_seq) FROM finance.credit_notes WHERE tenant_id = $1 GROUP BY number_year
       ) x WHERE n <> mx`,
      t,
    )),
    ...(await violations(
      db,
      "compteur ≠ dernier numéro émis",
      `SELECT s.kind, s.year, s.last_value FROM finance.number_sequences s WHERE s.tenant_id = $1 AND s.last_value <>
         CASE s.kind
           WHEN 'INVOICE' THEN COALESCE((SELECT max(number_seq) FROM finance.invoices WHERE tenant_id = $1 AND number_year = s.year), 0)
           WHEN 'RECEIPT' THEN COALESCE((SELECT max(number_seq) FROM finance.receipts WHERE tenant_id = $1 AND number_year = s.year), 0)
           ELSE COALESCE((SELECT max(number_seq) FROM finance.credit_notes WHERE tenant_id = $1 AND number_year = s.year), 0) END`,
      t,
    )),
    ...(await violations(
      db,
      "CONSERVATION de l'argent: Σ confirmé ≠ Σ imputé net + non imputé + remboursé",
      `SELECT sum(amount)::text AS confirmed, sum(allocated_amount)::text AS allocated, sum(refunded_amount)::text AS refunded,
              sum(amount - allocated_amount - refunded_amount)::text AS unallocated
         FROM finance.payments WHERE tenant_id = $1 AND status IN ('CONFIRMED','REFUNDED')
       HAVING sum(amount) <> sum(allocated_amount) + sum(refunded_amount) + sum(amount - allocated_amount - refunded_amount)`,
      t,
    )),
    ...(await violations(
      db,
      "facturé − crédité − encaissé ≠ Σ reste dû des échéances",
      `SELECT 1 FROM (
         SELECT COALESCE(sum(total_amount - credited_amount - paid_amount), 0) AS outstanding
           FROM finance.invoices WHERE tenant_id = $1 AND status NOT IN ('DRAFT','CANCELLED')) a,
         (SELECT COALESCE(sum(n.amount - n.paid_amount - n.credited_amount), 0) AS remaining
           FROM finance.installments n JOIN finance.invoices i ON i.id = n.invoice_id
          WHERE n.tenant_id = $1 AND i.status NOT IN ('DRAFT','CANCELLED')) b
       WHERE a.outstanding <> b.remaining`,
      t,
    )),
    ...(await violations(
      db,
      "session de caisse close: attendu ≠ fonds + espèces − remboursements, ou écart ≠ compté − attendu",
      `SELECT s.id FROM finance.cash_sessions s WHERE s.tenant_id = $1 AND s.status = 'CLOSED' AND (
         s.expected_amount <> s.opening_float
           + COALESCE((SELECT sum(p.amount) FROM finance.payments p WHERE p.cash_session_id = s.id AND p.method = 'CASH' AND p.status IN ('CONFIRMED','REFUNDED')), 0)
           - COALESCE((SELECT sum(r.amount) FROM finance.refunds r WHERE r.cash_session_id = s.id AND r.status = 'COMPLETED'), 0)
         OR s.variance_amount <> s.counted_amount - s.expected_amount)`,
      t,
    )),
  );
  return out;
}

export async function ledgerReport(db: Pick<FinanceTestDb, "admin">, tenantId: string): Promise<LedgerReport> {
  const [r] = await adminRows<Record<string, string>>(
    db,
    `SELECT
       (SELECT count(*) FROM finance.payments WHERE tenant_id = $1)::text AS payments,
       (SELECT count(*) FROM finance.invoices WHERE tenant_id = $1)::text AS invoices,
       (SELECT count(*) FROM finance.receipts WHERE tenant_id = $1)::text AS receipts,
       (SELECT COALESCE(sum(total_amount), 0) FROM finance.invoices WHERE tenant_id = $1 AND status NOT IN ('DRAFT','CANCELLED'))::text AS billed,
       (SELECT COALESCE(sum(paid_amount), 0) FROM finance.invoices WHERE tenant_id = $1)::text AS collected,
       (SELECT COALESCE(sum(amount - allocated_amount - refunded_amount), 0) FROM finance.payments WHERE tenant_id = $1 AND status = 'CONFIRMED')::text AS unallocated,
       (SELECT COALESCE(sum(refunded_amount), 0) FROM finance.payments WHERE tenant_id = $1)::text AS refunded`,
    [tenantId],
  );
  return {
    payments: Number(r!.payments),
    invoices: Number(r!.invoices),
    receipts: Number(r!.receipts),
    billed: Number(r!.billed),
    collected: Number(r!.collected),
    unallocated: Number(r!.unallocated),
    refunded: Number(r!.refunded),
  };
}
