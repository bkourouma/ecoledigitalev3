/**
 * Exécuteurs des jobs planifiés, tous établissements : un établissement en échec n'arrête pas les autres.
 *
 *  - ENVOI : liste les établissements actifs puis traite chacun HORS de toute transaction englobante (un envoi réseau ne doit
 *    jamais tenir une transaction ouverte) ;
 *  - RELANCES, ALERTES, ENTRETIEN : un établissement par transaction (`forEachTenant`), lectures de ports séquentielles.
 */
import { createSystemContext } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import { evaluateAlerts, type AlertsReport } from "./alerts";
import type { NotificationsDeps } from "./deps";
import { dispatchTenant, type DispatchReport } from "./dispatch";
import { runDunning, type DunningReport } from "./dunning";
import { housekeepingTenant } from "./housekeeping";
import { unwrap } from "@ecoledigitale/kernel";

export interface DispatchAllReport {
  readonly tenants: number;
  readonly totals: DispatchReport;
  readonly failed: ReadonlyArray<{ tenantId: string; error: string }>;
}

const sum = (a: DispatchReport, b: DispatchReport): DispatchReport => ({
  claimed: a.claimed + b.claimed,
  sent: a.sent + b.sent,
  simulated: a.simulated + b.simulated,
  retried: a.retried + b.retried,
  failed: a.failed + b.failed,
  bounced: a.bounced + b.bounced,
  skipped: a.skipped + b.skipped,
  cancelled: a.cancelled + b.cancelled,
  deferred: a.deferred + b.deferred,
});

export async function dispatchAllTenants(deps: NotificationsDeps, systemDb: SystemDb): Promise<DispatchAllReport> {
  const tenants = await systemDb.run("notifications-dispatch :: list-tenants", (tx) => tx.many<{ id: string }>("SELECT id FROM kernel.tenants WHERE status = 'active' ORDER BY created_at, id"), { readOnly: true });
  let totals: DispatchReport = { claimed: 0, sent: 0, simulated: 0, retried: 0, failed: 0, bounced: 0, skipped: 0, cancelled: 0, deferred: 0 };
  const failed: Array<{ tenantId: string; error: string }> = [];
  for (const t of tenants) {
    try {
      totals = sum(totals, await dispatchTenant(deps, t.id));
    } catch (e) {
      failed.push({ tenantId: t.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { tenants: tenants.length, totals, failed };
}

export function dunningAllTenants(deps: NotificationsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<DunningReport>> {
  return systemDb.forEachTenant("notifications-dunning", async (_tx, tenant) => unwrap(await runDunning(deps, createSystemContext(tenant.id))));
}

export function alertsAllTenants(deps: NotificationsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<AlertsReport>> {
  return systemDb.forEachTenant("notifications-alerts", async (_tx, tenant) => unwrap(await evaluateAlerts(deps, createSystemContext(tenant.id))));
}

export function housekeepingAllTenants(deps: NotificationsDeps, systemDb: SystemDb): Promise<ForEachTenantReport<{ deliveries: number; pushSubscriptions: number }>> {
  return systemDb.forEachTenant("notifications-housekeeping", async (_tx, tenant) => housekeepingTenant(deps, createSystemContext(tenant.id)));
}
