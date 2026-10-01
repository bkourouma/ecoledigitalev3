/**
 * Événements publiés par `entitlements` (outbox transactionnelle, ADR-004).
 * Payload versionné `{ v: 1, ... }` ; schémas Zod dans `packages/contracts/src/v2/entitlements.ts`.
 */
import {
  createDomainEvent,
  type Clock,
  type DomainEvent,
  type RequestContext,
} from "@ecoledigitale/kernel";
import type {
  EntitlementsOverrideChangedPayload,
  EntitlementsSubscriptionChangedPayload,
} from "@ecoledigitale/contracts/src/v2/entitlements";

export const ENTITLEMENTS_EVENTS = {
  subscriptionChanged: "entitlements.subscription.changed",
  overrideChanged: "entitlements.override.changed",
} as const;

/** Événements d'AUTRES modules qui invalident les droits mis en cache d'un tenant. */
export const INVALIDATING_EVENT_TYPES: ReadonlySet<string> = new Set([
  ENTITLEMENTS_EVENTS.subscriptionChanged,
  ENTITLEMENTS_EVENTS.overrideChanged,
  "tenancy.tenant.status_changed",
  "tenancy.tenant.provisioned",
]);

type Base = { ctx: RequestContext; clock: Clock };

export function subscriptionChangedEvent(
  b: Base,
  payload: Omit<EntitlementsSubscriptionChangedPayload, "v">,
): DomainEvent<typeof ENTITLEMENTS_EVENTS.subscriptionChanged, EntitlementsSubscriptionChangedPayload> {
  return createDomainEvent({
    type: ENTITLEMENTS_EVENTS.subscriptionChanged,
    payload: { v: 1, ...payload },
    ctx: b.ctx,
    clock: b.clock,
    aggregateType: "subscription",
    aggregateId: payload.subscriptionId,
  });
}

export function overrideChangedEvent(
  b: Base,
  payload: Omit<EntitlementsOverrideChangedPayload, "v">,
): DomainEvent<typeof ENTITLEMENTS_EVENTS.overrideChanged, EntitlementsOverrideChangedPayload> {
  return createDomainEvent({
    type: ENTITLEMENTS_EVENTS.overrideChanged,
    payload: { v: 1, ...payload },
    ctx: b.ctx,
    clock: b.clock,
    aggregateType: "feature_override",
    aggregateId: payload.featureKey,
  });
}
