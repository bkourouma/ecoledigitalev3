import { createSystemContext } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import type { ScopedTenantDb } from "./sdk";

/**
 * `TenantDb` lié à UN tenant (contexte système). Le tenant est figé à la création :
 * un handler ne peut pas, par construction, agir sur le tenant d'un autre événement.
 * La RLS (rôle app_user) reste le verrou de dernier recours.
 */
export function scopeDb(tenantDb: TenantDb, tenantId: string, requestId: string): ScopedTenantDb {
  const ctx = createSystemContext(tenantId, requestId.slice(0, 200));
  return {
    ctx,
    run: (fn, options) => tenantDb.run(ctx, fn, options),
  };
}
