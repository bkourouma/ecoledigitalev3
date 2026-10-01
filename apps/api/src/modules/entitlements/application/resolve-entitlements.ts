/**
 * `resolveEntitlements(tx, tenantId)` : charge l'état du tenant (statut, abonnement,
 * plan, catalogue, surcharges) puis délègue le calcul à la fonction PURE
 * `computeEntitlements`. Le statut du tenant est lu via l'API publique de `tenancy`.
 */
import { InternalError, NotFoundError, systemClock, type Clock } from "@ecoledigitale/kernel";
import type { Tx } from "@ecoledigitale/database";
import { getTenantStatus } from "../../tenancy";
import {
  computeEntitlements,
  hasFeature as hasFeatureIn,
  type EffectiveEntitlements,
} from "../domain/resolve";
import { listFeatures, listPlanFeatureKeys } from "../infrastructure/catalog-repository";
import { listOverrides } from "../infrastructure/overrides-repository";
import { getCurrentSubscription } from "../infrastructure/subscriptions-repository";

/**
 * @param tx transaction OUVERTE SOUS L'IDENTITÉ de `tenantId` (la RLS filtre abonnement et surcharges)
 */
export async function resolveEntitlements(
  tx: Tx,
  tenantId: string,
  clock: Clock = systemClock,
): Promise<EffectiveEntitlements> {
  // Garde-fou : la transaction doit appartenir au tenant demandé, sinon on calculerait
  // les droits d'un tenant avec les lignes (RLS) d'un autre.
  const current = await tx.queryOne<{ id: string | null }>("SELECT kernel.current_tenant_id() AS id");
  if (current?.id !== tenantId) {
    throw new InternalError("resolveEntitlements : transaction ouverte pour un autre tenant.", {
      code: "entitlements.tenant_mismatch",
    });
  }

  const status = await getTenantStatus(tx, tenantId);
  if (!status) throw NotFoundError.of("Organisation", tenantId, { code: "entitlements.tenant_not_found" });

  const [catalog, subscription, overrides] = await Promise.all([
    listFeatures(tx),
    getCurrentSubscription(tx, tenantId),
    listOverrides(tx, tenantId),
  ]);
  const planFeatureKeys = subscription ? await listPlanFeatureKeys(tx, subscription.planKey) : [];

  return computeEntitlements(
    {
      tenantId,
      tenantStatus: status,
      catalog: catalog.map((f) => ({ key: f.key, packs: f.packs, retired: f.retired })),
      subscription: subscription
        ? {
            planKey: subscription.planKey,
            packs: subscription.packs,
            status: subscription.status,
            startsAt: subscription.startsAt,
            endsAt: subscription.endsAt,
            learnerTierMax: subscription.learnerTierMax,
          }
        : null,
      planFeatureKeys,
      overrides: overrides.map((o) => ({ featureKey: o.featureKey, effect: o.effect, expiresAt: o.expiresAt })),
    },
    clock.now(),
  );
}

/** Vrai si la feature est accordée au tenant (un seul calcul de droits). */
export async function hasFeature(
  tx: Tx,
  tenantId: string,
  featureKey: string,
  clock: Clock = systemClock,
): Promise<boolean> {
  return hasFeatureIn(await resolveEntitlements(tx, tenantId, clock), featureKey);
}
