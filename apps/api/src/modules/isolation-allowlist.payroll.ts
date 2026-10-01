/**
 * Tables GLOBALES du module `payroll` (hors RLS « tenant »), jointes à la liste blanche du test d'isolation
 * (`pnpm test:isolation`) avec la justification de chacune (ADR-002 §5).
 *
 * AUCUNE : les 13 tables du schéma `payroll` portent `tenant_id uuid NOT NULL` et la policy `tenant_isolation`.
 * Même les réglages (`settings`, une ligne par tenant) et le journal (`payslip_events`) sont par tenant. La vue
 * `payroll.v_payslip_breakdown` est ignorée par le test (elle s'exécute sous la RLS forcée des tables).
 *
 * `fixtures` : valeurs imposées pour que le test fabrique une ligne dans les tables dont les contraintes (CHECK de
 * format, bornes de dates, formule d'une ligne) empêchent la génération automatique. Les tables à clé étrangère
 * composite vers un parent (bulletins, lignes, réclamations, ajustements, cibles, comptes rendus) restent
 * contrôlées en structure (RLS forcée, policy unique, index) et sont couvertes en comportement par
 * `payroll/test/integration/isolation.integration.test.ts` (lignes réelles A/B).
 */
export interface IsolationAllowlistEntry {
  readonly table: string;
  readonly reason: string;
}

const entries: readonly IsolationAllowlistEntry[] = Object.freeze([]);
export default entries;

/** Tables du schéma `payroll` attendues (le test du module vérifie qu'aucune n'est oubliée). */
export const payrollTenantTables: readonly string[] = Object.freeze([
  "payroll.settings",
  "payroll.pay_periods",
  "payroll.pay_period_targets",
  "payroll.pay_configs",
  "payroll.hourly_rates",
  "payroll.payslips",
  "payroll.payslip_lines",
  "payroll.hour_claims",
  "payroll.salary_day_claims",
  "payroll.payslip_adjustments",
  "payroll.payslip_events",
  "payroll.calculation_runs",
  "payroll.calculation_run_items",
]);

export const fixtures: Record<string, Record<string, unknown>> = {
  "payroll.settings": { currency: "XOF" },
  "payroll.pay_periods": { name: "Période de test", start_date: "2026-01-05", end_date: "2026-01-31", status: "DRAFT" },
  "payroll.pay_configs": { config_type: "HOURLY", overtime_threshold_minutes: 2400, overtime_multiplier_permille: 1500, effective_from: "2026-01-01" },
  "payroll.hourly_rates": { rate: 9000, valid_from: "2026-01-01" },
  "payroll.payslip_events": { action: "CALCULATED", actor_name: "Test" },
};
