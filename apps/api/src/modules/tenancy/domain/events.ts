/**
 * Événements publiés par `tenancy` (outbox transactionnelle, ADR-004).
 * Noms `<module>.<entité>.<verbe-passé>` ; payload versionné `{ v: 1, ... }` dont
 * le schéma Zod vit dans `packages/contracts/src/v2/tenancy.ts`.
 */
import {
  createDomainEvent,
  type Clock,
  type DomainEvent,
  type RequestContext,
} from "@ecoledigitale/kernel";
import type {
  TenancyInstitutionCreatedPayload,
  TenancyTenantProvisionedPayload,
  TenancyTenantStatusChangedPayload,
} from "@ecoledigitale/contracts/src/v2/tenancy";

export const TENANCY_EVENTS = {
  institutionCreated: "tenancy.institution.created",
  tenantProvisioned: "tenancy.tenant.provisioned",
  tenantStatusChanged: "tenancy.tenant.status_changed",
} as const;

type Base = { ctx: RequestContext; clock: Clock };

export function institutionCreatedEvent(
  b: Base,
  payload: Omit<TenancyInstitutionCreatedPayload, "v">,
): DomainEvent<typeof TENANCY_EVENTS.institutionCreated, TenancyInstitutionCreatedPayload> {
  return createDomainEvent({
    type: TENANCY_EVENTS.institutionCreated,
    payload: { v: 1, ...payload },
    ctx: b.ctx,
    clock: b.clock,
    aggregateType: "institution",
    aggregateId: payload.institutionId,
  });
}

export function tenantProvisionedEvent(
  b: Base,
  payload: Omit<TenancyTenantProvisionedPayload, "v">,
): DomainEvent<typeof TENANCY_EVENTS.tenantProvisioned, TenancyTenantProvisionedPayload> {
  return createDomainEvent({
    type: TENANCY_EVENTS.tenantProvisioned,
    payload: { v: 1, ...payload },
    ctx: b.ctx,
    clock: b.clock,
    aggregateType: "tenant",
    aggregateId: payload.tenantId,
  });
}

export function tenantStatusChangedEvent(
  b: Base,
  payload: Omit<TenancyTenantStatusChangedPayload, "v">,
): DomainEvent<typeof TENANCY_EVENTS.tenantStatusChanged, TenancyTenantStatusChangedPayload> {
  return createDomainEvent({
    type: TENANCY_EVENTS.tenantStatusChanged,
    payload: { v: 1, ...payload },
    ctx: b.ctx,
    clock: b.clock,
    aggregateType: "tenant",
    aggregateId: payload.tenantId,
  });
}
