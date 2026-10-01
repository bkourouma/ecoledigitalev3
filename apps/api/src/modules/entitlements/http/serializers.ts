/** Entités du domaine -> DTO des contrats (`packages/contracts/src/v2/entitlements.ts`). */
import type {
  EffectiveEntitlementsDto,
  Feature,
  FeatureOverride,
  Pack,
  Plan,
  Subscription,
  UsageCounter,
} from "@ecoledigitale/contracts/src/v2/entitlements";
import type {
  FeatureRecord,
  OverrideRecord,
  PackRecord,
  PlanRecord,
  SubscriptionRecord,
  UsageCounterRecord,
} from "../domain/entities";
import type { EffectiveEntitlements } from "../domain/resolve";

export const toEntitlementsDto = (e: EffectiveEntitlements): EffectiveEntitlementsDto => ({
  tenantId: e.tenantId,
  reason: e.reason,
  planKey: e.planKey,
  packs: e.packs as EffectiveEntitlementsDto["packs"],
  subscriptionStatus: e.subscriptionStatus,
  features: e.features,
  sources: e.sources,
  limits: e.limits,
  validUntil: e.validUntil ? e.validUntil.toISOString() : null,
  computedAt: e.computedAt.toISOString(),
});

export const toPlanDto = (p: PlanRecord): Plan => ({ ...p });
export const toPackDto = (p: PackRecord): Pack => ({ ...p });
export const toFeatureDto = (f: FeatureRecord): Feature => ({ ...f });

export const toSubscriptionDto = (s: SubscriptionRecord): Subscription => ({
  id: s.id,
  tenantId: s.tenantId,
  planKey: s.planKey,
  packs: s.packs as Subscription["packs"],
  status: s.status,
  startsAt: s.startsAt.toISOString(),
  endsAt: s.endsAt ? s.endsAt.toISOString() : null,
  learnerTierMax: s.learnerTierMax,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

export const toOverrideDto = (o: OverrideRecord): FeatureOverride => ({
  id: o.id,
  tenantId: o.tenantId,
  featureKey: o.featureKey,
  effect: o.effect,
  reason: o.reason,
  expiresAt: o.expiresAt ? o.expiresAt.toISOString() : null,
  createdBy: o.createdBy,
  createdAt: o.createdAt.toISOString(),
  updatedAt: o.updatedAt.toISOString(),
});

export const toUsageDto = (u: UsageCounterRecord): UsageCounter => ({
  metric: u.metric,
  period: u.period,
  value: u.value,
  updatedAt: u.updatedAt.toISOString(),
});
