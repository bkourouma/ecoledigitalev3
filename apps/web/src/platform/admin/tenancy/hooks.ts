"use client";

/**
 * Hooks du module `tenancy` (profil, établissements, campus, onboarding) et lecture de l'abonnement/usage du tenant
 * (`entitlements/me`). Tout passe par le client API typé : aucun `fetch` brut, aucune règle métier ici.
 *
 * Clés de cache : le thème (`platform/theme`) lit le même endpoint `/tenancy/profile` sous la clé
 * `["tenancy","profile"]` avec un schéma réduit ; le profil COMPLET utilise donc `["tenancy","profile","full"]`
 * (jamais la même clé avec deux formes de données). Une invalidation du préfixe `["tenancy","profile"]` rafraîchit les deux.
 */

import { z } from "zod";
import {
  CampusSchema,
  CountryProfileSchema,
  InstitutionSchema,
  OnboardingStateSchema,
  TenantProfileSchema,
  type Campus,
  type CountryProfile,
  type CreateCampusInput,
  type CreateInstitutionInput,
  type Institution,
  type OnboardingState,
  type OnboardingStepKey,
  type TenantProfile,
  type UpdateCampusInput,
  type UpdateInstitutionInput,
  type UpdateTenantProfileInput,
} from "@ecoledigitale/contracts/v2/tenancy";
import {
  EffectiveEntitlementsSchema,
  UsageCounterSchema,
  type EffectiveEntitlementsDto,
  type UsageCounter,
} from "@ecoledigitale/contracts/v2/entitlements";
import { platformHooks } from "@/platform/api/default-client";

export const TENANCY = "/api/v1/tenancy";

const FIVE_MINUTES = 5 * 60 * 1000;

/** Copie sans la clé d'identifiant, qui voyage dans le chemin et non dans le corps. */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

const InstitutionListSchema = z.object({ items: z.array(InstitutionSchema) });
const CampusListSchema = z.object({ items: z.array(CampusSchema) });
const CountryListSchema = z.object({ items: z.array(CountryProfileSchema) });
const CreatedInstitutionSchema = InstitutionSchema.extend({ defaultCampus: CampusSchema });
const UsageListSchema = z.object({ items: z.array(UsageCounterSchema) });

// --------------------------------------------------------------------------- profil

export function useTenantProfile(options: { enabled?: boolean } = {}) {
  return platformHooks.useApiQuery<TenantProfile>(["tenancy", "profile", "full"], `${TENANCY}/profile`, {
    schema: TenantProfileSchema,
    staleTime: FIVE_MINUTES,
    retry: false,
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
  });
}

export function useUpdateTenantProfile() {
  return platformHooks.useApiMutation<TenantProfile, UpdateTenantProfileInput>({
    method: "PATCH",
    path: `${TENANCY}/profile`,
    schema: TenantProfileSchema,
    invalidate: [["tenancy", "profile"]],
  });
}

export function useCountries() {
  return platformHooks.useApiQuery<CountryProfile[]>(["tenancy", "countries"], `${TENANCY}/countries`, {
    schema: CountryListSchema.transform((v) => v.items),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

// --------------------------------------------------------------------------- établissements

export function useInstitutions() {
  return platformHooks.useApiQuery<Institution[]>(["tenancy", "institutions"], `${TENANCY}/institutions`, {
    schema: InstitutionListSchema.transform((v) => v.items),
  });
}

export function useCreateInstitution() {
  return platformHooks.useApiMutation<Institution & { defaultCampus: Campus }, CreateInstitutionInput>({
    path: `${TENANCY}/institutions`,
    schema: CreatedInstitutionSchema,
    invalidate: [["tenancy", "institutions"], ["tenancy", "campuses"], ["tenancy", "onboarding"]],
  });
}

export type UpdateInstitutionVars = { id: string } & UpdateInstitutionInput;

export function useUpdateInstitution() {
  return platformHooks.useApiMutation<Institution, UpdateInstitutionVars>({
    method: "PATCH",
    path: (v) => `${TENANCY}/institutions/${v.id}`,
    body: (v) => without(v, "id"),
    schema: InstitutionSchema,
    invalidate: [["tenancy", "institutions"]],
  });
}

// --------------------------------------------------------------------------- campus

export function useCampuses(institutionId: string | null) {
  return platformHooks.useApiQuery<Campus[]>(
    ["tenancy", "campuses", institutionId ?? "none"],
    `${TENANCY}/institutions/${institutionId ?? ""}/campuses`,
    { schema: CampusListSchema.transform((v) => v.items), enabled: institutionId !== null },
  );
}

export type CreateCampusVars = { institutionId: string } & CreateCampusInput;

export function useCreateCampus() {
  return platformHooks.useApiMutation<Campus, CreateCampusVars>({
    path: (v) => `${TENANCY}/institutions/${v.institutionId}/campuses`,
    body: (v) => without(v, "institutionId"),
    schema: CampusSchema,
    invalidate: [["tenancy", "campuses"]],
  });
}

export type UpdateCampusVars = { id: string } & UpdateCampusInput;

export function useUpdateCampus() {
  return platformHooks.useApiMutation<Campus, UpdateCampusVars>({
    method: "PATCH",
    path: (v) => `${TENANCY}/campuses/${v.id}`,
    body: (v) => without(v, "id"),
    schema: CampusSchema,
    invalidate: [["tenancy", "campuses"]],
  });
}

export function useDeleteCampus() {
  return platformHooks.useApiMutation<void, { id: string }>({
    method: "DELETE",
    path: (v) => `${TENANCY}/campuses/${v.id}`,
    body: () => undefined,
    invalidate: [["tenancy", "campuses"]],
  });
}

// --------------------------------------------------------------------------- onboarding

export function useOnboarding() {
  return platformHooks.useApiQuery<OnboardingState>(["tenancy", "onboarding"], `${TENANCY}/onboarding`, {
    schema: OnboardingStateSchema,
    retry: false,
  });
}

export type OnboardingAction = "complete" | "skip";

/** `complete` ou `skip` d'une étape ; la réponse est le nouvel état complet du parcours. */
export function useOnboardingStep(action: OnboardingAction) {
  return platformHooks.useApiMutation<OnboardingState, { step: OnboardingStepKey }>({
    path: (v) => `${TENANCY}/onboarding/steps/${v.step}/${action}`,
    body: () => undefined,
    schema: OnboardingStateSchema,
    invalidate: [["tenancy", "onboarding"]],
  });
}

// --------------------------------------------------------------------------- abonnement et usage (lecture)

export function useEffectiveEntitlements() {
  return platformHooks.useApiQuery<EffectiveEntitlementsDto>(["entitlements", "me", "effective"], "/api/v1/entitlements/me", {
    schema: EffectiveEntitlementsSchema,
    staleTime: FIVE_MINUTES,
    retry: false,
  });
}

export function useMyUsage() {
  return platformHooks.useApiQuery<UsageCounter[]>(["entitlements", "me", "usage"], "/api/v1/entitlements/me/usage", {
    schema: UsageListSchema.transform((v) => v.items),
    retry: false,
  });
}
