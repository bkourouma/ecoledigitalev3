/**
 * Statut d'un tenant (`kernel.tenants.status`), lu par les autres modules via
 * l'API publique de `tenancy` (les entitlements en dérivent « suspendu ⇒ CORE seulement »).
 */
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  err,
  type AppError,
  type RequestContext,
  type Result,
} from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { TenantStatusSchema, type TenantStatus } from "@ecoledigitale/contracts/src/v2/tenancy";
import { tenantStatusChangedEvent } from "../domain/events";
import { publishEvents } from "../infrastructure/events";
import { findTenant, updateTenantStatus } from "../infrastructure/tenants-repository";
import { resolveDeps, runResult, type TenancyDeps } from "./support";

/** Statut du tenant, ou `null` s'il n'existe pas. Utilisable dans la transaction d'un autre module. */
export async function getTenantStatus(tx: Tx, tenantId: string): Promise<TenantStatus | null> {
  return (await findTenant(tx, tenantId))?.status ?? null;
}

export interface SetTenantStatusInput {
  status: TenantStatus;
  reason?: string;
}

/**
 * Suspend, réactive ou archive un tenant. Réservé aux acteurs `superAdmin` et
 * `system` : un utilisateur du tenant ne peut pas changer son propre statut.
 * (L'autorisation fine — qui est super-admin — appartient à l'appelant : console
 * plateforme.) `ctx.tenantId` est le tenant visé.
 */
export async function setTenantStatus(
  deps: TenancyDeps,
  ctx: RequestContext,
  input: SetTenantStatusInput,
): Promise<Result<{ tenantId: string; previous: TenantStatus; current: TenantStatus }, AppError>> {
  const d = resolveDeps(deps);
  if (ctx.actor === "user") {
    return err(
      new ForbiddenError("Seul un opérateur de la plateforme peut changer le statut d'une organisation.", {
        code: "tenancy.tenant_status_forbidden",
      }),
    );
  }
  const status = TenantStatusSchema.safeParse(input.status);
  if (!status.success) {
    return err(ValidationError.field("status", "Statut inconnu.", "tenancy.tenant_status_invalid"));
  }

  return runResult(d.db, ctx, async (tx) => {
    const tenant = await findTenant(tx, ctx.tenantId);
    if (!tenant) throw NotFoundError.of("Organisation", ctx.tenantId, { code: "tenancy.tenant_not_found" });
    if (tenant.status === status.data) {
      throw new ConflictError(`L'organisation est déjà au statut « ${tenant.status} ».`, {
        code: "tenancy.tenant_status_unchanged",
      });
    }
    if (tenant.status === "archived") {
      throw new ConflictError("Une organisation archivée ne peut pas être réactivée.", {
        code: "tenancy.tenant_archived",
      });
    }

    await updateTenantStatus(tx, ctx.tenantId, status.data, d.clock.now());
    await publishEvents(tx, [
      tenantStatusChangedEvent(
        { ctx, clock: d.clock },
        {
          tenantId: ctx.tenantId,
          status: status.data,
          previousStatus: tenant.status,
          reason: input.reason?.trim() || null,
        },
      ),
    ]);
    await d.audit?.record(tx, {
      action: "tenancy.tenant.status",
      entity: "tenant",
      entityId: ctx.tenantId,
      before: { status: tenant.status },
      after: { status: status.data, reason: input.reason ?? null },
    });
    return { tenantId: ctx.tenantId, previous: tenant.status, current: status.data };
  });
}
