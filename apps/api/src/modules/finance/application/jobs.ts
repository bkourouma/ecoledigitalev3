/**
 * Tâches planifiées du module finance, destinées à `apps/worker` (jobs répétables BullMQ,
 * ADR-004) : un tenant à la fois, chacun dans SA transaction, acteur `system`.
 *
 *   const report = await markOverdueForAllTenants(deps, systemDb);
 *   // report.failed : tenants en échec, à journaliser / relancer — jamais avalés en silence.
 */
import { createSystemContext, unwrap } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import type { Uuid } from "../domain/types";
import type { FinanceDeps } from "./deps";
import { markOverdueInvoices } from "./invoices";

export interface OverdueJobResult {
  processed: number;
  invoiceIds: Uuid[];
}

/**
 * Passe en OVERDUE les factures échues de TOUS les tenants actifs et publie
 * `finance.invoice.overdue` (une fois par transition). Idempotent : sans changement de
 * situation, un second passage ne produit aucun événement.
 */
export async function markOverdueForAllTenants(
  deps: FinanceDeps,
  systemDb: SystemDb,
  options: { limitPerTenant?: number } = {},
): Promise<ForEachTenantReport<OverdueJobResult>> {
  return systemDb.forEachTenant("finance-overdue-invoices", async (_tx, tenant) => {
    const ctx = createSystemContext(tenant.id);
    return unwrap(await markOverdueInvoices(deps, ctx, options.limitPerTenant ? { limit: options.limitPerTenant } : {}));
  });
}
