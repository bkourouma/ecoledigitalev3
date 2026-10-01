/**
 * Tâches planifiées du module academic pour `apps/worker` : un tenant à la fois, chacun dans SA transaction, acteur
 * `system`. Un tenant en échec n'arrête pas les autres (rapporté, jamais avalé).
 */
import { createSystemContext, unwrap } from "@ecoledigitale/kernel";
import type { ForEachTenantReport, SystemDb } from "@ecoledigitale/database";
import type { AcademicDeps } from "./deps";
import { finalizeEndedOfferings } from "./classrooms";
import { expirePendingHolds } from "./courses";

export interface HoldsJobResult {
  expired: number;
}
export interface FinalizeJobResult {
  finalized: number;
}

/** `academic.expire-holds` : les réservations `PENDING` échues passent en `CANCELLED` (`hold_expired`), places libérées. */
export async function expireHoldsForAllTenants(deps: AcademicDeps, systemDb: SystemDb, options: { limitPerTenant?: number } = {}): Promise<ForEachTenantReport<HoldsJobResult>> {
  return systemDb.forEachTenant("academic-expire-holds", async (_tx, tenant) => {
    const r = unwrap(await expirePendingHolds(deps, createSystemContext(tenant.id), options.limitPerTenant ? { limit: options.limitPerTenant } : {}));
    return { expired: r.expired.length };
  });
}

/** `academic.finalize-offerings` : jamais dans un `GET` (bug legacy D3) ; `DRAFT` et `CANCELLED` exclues. */
export async function finalizeOfferingsForAllTenants(deps: AcademicDeps, systemDb: SystemDb): Promise<ForEachTenantReport<FinalizeJobResult>> {
  return systemDb.forEachTenant("academic-finalize-offerings", async (_tx, tenant) => {
    const r = unwrap(await finalizeEndedOfferings(deps, createSystemContext(tenant.id)));
    return { finalized: r.finalized.length };
  });
}
