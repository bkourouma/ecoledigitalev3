/**
 * Tables GLOBALES du module `finance` (hors RLS « tenant »), à joindre à la liste blanche
 * du test d'isolation (`assertTenantIsolation({ allowlist })`) avec la justification de
 * chaque entrée (ADR-002 §5).
 *
 * AUCUNE : toutes les tables du schéma `finance` portent `tenant_id uuid NOT NULL` et la
 * policy `tenant_isolation` (fees, fee_schedules, installment_plans, discounts,
 * learner_accounts, scholarships, invoices, invoice_lines, invoice_discounts, installments,
 * cash_registers, cash_sessions, payments, payment_allocations, allocation_reversals,
 * receipts, refunds, credit_notes, webhook_events, number_sequences). Même les compteurs de
 * numérotation et le journal des webhooks sont par tenant.
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly justification: string;
}

export const financeIsolationAllowlist: readonly IsolationAllowlistEntry[] = Object.freeze([]);

/** Noms qualifiés (`schema.table`), au format attendu par `assertTenantIsolation`. */
export const financeIsolationAllowlistTables: readonly string[] = Object.freeze(financeIsolationAllowlist.map((e) => e.table));

/** Tables du schéma `finance` attendues (le test d'isolation vérifie qu'aucune n'est oubliée). */
export const financeTenantTables: readonly string[] = Object.freeze([
  "finance.number_sequences",
  "finance.fees",
  "finance.installment_plans",
  "finance.fee_schedules",
  "finance.discounts",
  "finance.learner_accounts",
  "finance.scholarships",
  "finance.invoices",
  "finance.invoice_lines",
  "finance.invoice_discounts",
  "finance.installments",
  "finance.cash_registers",
  "finance.cash_sessions",
  "finance.payments",
  "finance.payment_allocations",
  "finance.receipts",
  "finance.refunds",
  "finance.allocation_reversals",
  "finance.credit_notes",
  "finance.webhook_events",
]);

export default financeIsolationAllowlist;
