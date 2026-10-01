"use client";

/**
 * Hooks de la console plateforme (`/api/v1/platform/*`, `/api/v1/entitlements/admin/*`), via le client SANS tenant de
 * l'opérateur (`operatorHooks`). Toutes les routes exigent le jeton super-admin ; l'API reste la barrière réelle.
 */

import { z } from "zod";
import {
  CatalogResponseSchema,
  EffectiveEntitlementsSchema,
  FeatureOverrideSchema,
  PlanSchema,
  SubscriptionSchema,
  UsageCounterSchema,
  type EffectiveEntitlementsDto,
  type FeatureOverride,
  type Plan,
  type SetFeatureOverrideInput,
  type SetPlanFeaturesInput,
  type SetSubscriptionInput,
  type Subscription,
  type UpsertPlanInput,
  type UsageCounter,
} from "@ecoledigitale/contracts/v2/entitlements";
import { PlatformTenantListResponseSchema, type PlatformProvisionTenantBody, type PlatformSetTenantStatusBody, type PlatformTenantListResponse } from "@ecoledigitale/contracts/v2/platform";
import { InstitutionSchema, TenantProfileSchema, TenantStatusSchema } from "@ecoledigitale/contracts/v2/tenancy";
import { auditLogListResponseSchema, type AuditLogListResponseDto } from "@ecoledigitale/contracts/v2/audit";
import { operatorApi, operatorHooks } from "../operator";

export const PLATFORM = "/api/v1/platform";
export const ENTITLEMENTS_ADMIN = "/api/v1/entitlements/admin";

function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

// --------------------------------------------------------------------------- authentification de l'opérateur

const OperatorLoginSchema = z.object({ token: z.string().min(1), superAdmin: z.object({ email: z.string() }).passthrough() }).passthrough();

/** `POST /api/v1/super-admin/auth/login` (public) : jeton d'opérateur, distinct de toute session de tenant. */
export async function loginOperator(email: string, password: string): Promise<{ token: string; email: string }> {
  const data = await operatorApi.post("/api/v1/super-admin/auth/login", { email: email.trim().toLowerCase(), password }, { anonymous: true, schema: OperatorLoginSchema, retries: 0 });
  return { token: data.token, email: data.superAdmin.email };
}

// --------------------------------------------------------------------------- organisations

export interface TenantListFilter {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useTenants(filter: TenantListFilter) {
  return operatorHooks.useApiQuery<PlatformTenantListResponse>(["platform", "tenants"], `${PLATFORM}/tenants`, {
    query: {
      limit: filter.limit ?? 25,
      offset: filter.offset ?? 0,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search ? { search: filter.search } : {}),
    },
    schema: PlatformTenantListResponseSchema,
    retry: false,
  });
}

/** Résultat réel de `POST /platform/tenants` (voir `ProvisionedTenant` côté API) — champs utiles à l'écran seulement. */
export const ProvisionedTenantSchema = z
  .object({
    tenantId: z.string().uuid(),
    slug: z.string(),
    institutions: z.array(z.object({ id: z.string(), code: z.string(), pack: z.string(), defaultCampusId: z.string() }).passthrough()),
    owner: z.object({ email: z.string() }).passthrough().optional(),
    subscription: z.object({ planKey: z.string(), status: z.string(), endsAt: z.string().nullable() }).passthrough().optional(),
  })
  .passthrough();
export type ProvisionedTenant = z.infer<typeof ProvisionedTenantSchema>;

export function useProvisionTenant() {
  return operatorHooks.useApiMutation<ProvisionedTenant, PlatformProvisionTenantBody>({
    path: `${PLATFORM}/tenants`,
    schema: ProvisionedTenantSchema,
    invalidate: [["platform", "tenants"]],
  });
}

export const TenantOverviewSchema = z.object({
  tenant: z.object({ id: z.string().uuid(), slug: z.string(), name: z.string(), status: TenantStatusSchema, createdAt: z.string() }).passthrough(),
  profile: TenantProfileSchema.nullable(),
  institutions: z.array(InstitutionSchema),
  subscription: SubscriptionSchema.nullable(),
});
export type TenantOverview = z.infer<typeof TenantOverviewSchema>;

export function useTenantOverview(tenantId: string) {
  return operatorHooks.useApiQuery<TenantOverview>(["platform", "tenant", tenantId], `${PLATFORM}/tenants/${tenantId}`, {
    schema: TenantOverviewSchema,
    retry: false,
  });
}

export type SetStatusVars = { tenantId: string } & PlatformSetTenantStatusBody;

export function useSetTenantStatus() {
  return operatorHooks.useApiMutation<unknown, SetStatusVars>({
    method: "PATCH",
    path: (v) => `${PLATFORM}/tenants/${v.tenantId}/status`,
    body: (v) => without(v, "tenantId"),
    invalidate: [["platform", "tenant"], ["platform", "tenants"]],
  });
}

export const ReconcileReportSchema = z
  .object({ rolesCreated: z.number().optional(), rolesExisting: z.number().optional(), subscriptionCreated: z.boolean().optional() })
  .passthrough();
export type ReconcileReport = z.infer<typeof ReconcileReportSchema>;

export function useReconcileTenant() {
  return operatorHooks.useApiMutation<ReconcileReport, { tenantId: string }>({
    path: (v) => `${PLATFORM}/tenants/${v.tenantId}/reconcile`,
    body: () => undefined,
    schema: ReconcileReportSchema,
    invalidate: [["platform", "tenant"], ["platform", "subscription"], ["platform", "entitlements"]],
  });
}

// --------------------------------------------------------------------------- catalogue, plans

export function useCatalog() {
  return operatorHooks.useApiQuery<z.output<typeof CatalogResponseSchema>>(["platform", "catalog"], `${PLATFORM}/plans`, {
    schema: CatalogResponseSchema,
    staleTime: 60_000,
    retry: false,
  });
}

export type UpsertPlanVars = { key: string } & UpsertPlanInput;

export function useUpsertPlan() {
  return operatorHooks.useApiMutation<Plan, UpsertPlanVars>({
    method: "PUT",
    path: (v) => `${PLATFORM}/plans/${v.key}`,
    body: (v) => without(v, "key"),
    schema: PlanSchema,
    invalidate: [["platform", "catalog"]],
  });
}

export type SetPlanFeaturesVars = { key: string } & SetPlanFeaturesInput;

export function useSetPlanFeatures() {
  return operatorHooks.useApiMutation<Plan, SetPlanFeaturesVars>({
    method: "PUT",
    path: (v) => `${PLATFORM}/plans/${v.key}/features`,
    body: (v) => without(v, "key"),
    schema: PlanSchema,
    invalidate: [["platform", "catalog"], ["platform", "entitlements"]],
  });
}

// --------------------------------------------------------------------------- abonnement, surcharges, droits effectifs

export function useTenantSubscription(tenantId: string) {
  return operatorHooks.useApiQuery<Subscription | null>(["platform", "subscription", tenantId], `${PLATFORM}/tenants/${tenantId}/subscription`, {
    schema: z.object({ subscription: SubscriptionSchema.nullable() }).transform((v) => v.subscription),
    retry: false,
  });
}

export type SetSubscriptionVars = { tenantId: string } & SetSubscriptionInput;

export function useSetSubscription() {
  return operatorHooks.useApiMutation<Subscription, SetSubscriptionVars>({
    method: "PUT",
    path: (v) => `${PLATFORM}/tenants/${v.tenantId}/subscription`,
    body: (v) => without(v, "tenantId"),
    schema: SubscriptionSchema,
    invalidate: [["platform", "subscription"], ["platform", "tenant"], ["platform", "entitlements"]],
  });
}

export function useOverrides(tenantId: string) {
  return operatorHooks.useApiQuery<FeatureOverride[]>(["platform", "overrides", tenantId], `${PLATFORM}/tenants/${tenantId}/overrides`, {
    schema: z.object({ items: z.array(FeatureOverrideSchema) }).transform((v) => v.items),
    retry: false,
  });
}

export type SetOverrideVars = { tenantId: string; featureKey: string } & SetFeatureOverrideInput;

export function useSetOverride() {
  return operatorHooks.useApiMutation<FeatureOverride, SetOverrideVars>({
    method: "PUT",
    path: (v) => `${PLATFORM}/tenants/${v.tenantId}/overrides/${v.featureKey}`,
    body: (v) => ({ effect: v.effect, reason: v.reason, ...(v.expiresAt !== undefined ? { expiresAt: v.expiresAt } : {}) }),
    schema: FeatureOverrideSchema,
    invalidate: [["platform", "overrides"], ["platform", "entitlements"]],
  });
}

export function useRemoveOverride() {
  return operatorHooks.useApiMutation<void, { tenantId: string; featureKey: string }>({
    method: "DELETE",
    path: (v) => `${PLATFORM}/tenants/${v.tenantId}/overrides/${v.featureKey}`,
    body: () => undefined,
    invalidate: [["platform", "overrides"], ["platform", "entitlements"]],
  });
}

export function useTenantEntitlements(tenantId: string) {
  return operatorHooks.useApiQuery<EffectiveEntitlementsDto>(["platform", "entitlements", tenantId], `${ENTITLEMENTS_ADMIN}/tenants/${tenantId}/entitlements`, {
    schema: EffectiveEntitlementsSchema,
    retry: false,
  });
}

export function useTenantUsage(tenantId: string) {
  return operatorHooks.useApiQuery<UsageCounter[]>(["platform", "usage", tenantId], `${ENTITLEMENTS_ADMIN}/tenants/${tenantId}/usage`, {
    schema: z.object({ items: z.array(UsageCounterSchema) }).transform((v) => v.items),
    retry: false,
  });
}

// --------------------------------------------------------------------------- journal de plateforme

/**
 * Journal d'audit de plateforme. L'API ne publie PAS (encore) de route de lecture de `audit.platform_audit_log` :
 * l'écran attend `GET /api/v1/platform/audit/logs` (même enveloppe que l'audit des tenants) et affiche « pas encore
 * disponible » tant que l'appel répond 404/501.
 */
export const PLATFORM_AUDIT_ENDPOINT = `${PLATFORM}/audit/logs`;

export function usePlatformAudit() {
  return operatorHooks.useApiInfiniteQuery<AuditLogListResponseDto>(["platform", "audit"], PLATFORM_AUDIT_ENDPOINT, {
    query: { limit: 50 },
    schema: auditLogListResponseSchema,
    getNextCursor: (page) => page.nextCursor,
    retry: false,
  });
}
