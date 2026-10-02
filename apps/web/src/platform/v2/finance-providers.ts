"use client";

/**
 * Hooks typés de la configuration des fournisseurs de paiement (`/api/v1/finance/providers`, permission
 * `finance.provider.manage`, action sensible). Schémas Zod de `packages/contracts/src/v2/finance.ts`.
 *
 * SECRETS : l'API ne renvoie JAMAIS un secret (seulement « enregistré ou non »). Dans l'autre sens, les secrets saisis
 * transitent par `useSaveProvider` : cette mutation ne survit pas à sa réponse (`gcTime: 0`) pour que les variables (donc
 * les secrets) ne restent pas dans le cache de mutations de react-query ; l'écran appelle en plus `reset()` au succès.
 *
 * Clés de cache : `["finance", "providers", …]` (le tenant est ajouté par `platformHooks`).
 */

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import {
  financeProviderDtoSchema,
  financeProviderListDtoSchema,
  financeProviderTestResultDtoSchema,
  financeRotateSecretsResultDtoSchema,
  type FinanceProviderDto,
  type FinanceProviderName,
  type FinanceSaveProviderBody,
} from "@ecoledigitale/contracts/v2/finance";
import type { ApiError } from "@/platform/api/errors";
import { platformHooks as hooks } from "@/platform/api/default-client";
import { useApiAction } from "./actions";
import { FINANCE_BASE } from "./finance";

export const PROVIDERS_BASE = `${FINANCE_BASE}/providers`;
const PROVIDERS_KEY = ["finance", "providers"] as const;

export function useFinanceProviders() {
  return hooks.useApiQuery([...PROVIDERS_KEY, "list"], PROVIDERS_BASE, { schema: financeProviderListDtoSchema, refetchOnWindowFocus: false });
}

/**
 * Enregistrement : un secret omis est CONSERVÉ côté API ; `clearSecrets` en retire. Le corps est transmis tel quel
 * (contrat `strict()`), l'identifiant du fournisseur ne va que dans le chemin.
 */
export function useSaveProvider(): UseMutationResult<FinanceProviderDto, ApiError, { provider: FinanceProviderName; body: FinanceSaveProviderBody }> {
  const queryClient = useQueryClient();
  return useMutation<FinanceProviderDto, ApiError, { provider: FinanceProviderName; body: FinanceSaveProviderBody }>({
    gcTime: 0,
    mutationFn: (v) => hooks.client.request("PUT", `${PROVIDERS_BASE}/${v.provider}`, { body: v.body, schema: financeProviderDtoSchema }) as Promise<FinanceProviderDto>,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: hooks.queryKey(...PROVIDERS_KEY) });
    },
  });
}

export function useSetProviderEnabled() {
  return useApiAction({
    method: "PATCH",
    path: (v: { provider: FinanceProviderName; enabled: boolean }) => `${PROVIDERS_BASE}/${v.provider}/status`,
    body: (v) => ({ enabled: v.enabled }),
    schema: financeProviderDtoSchema,
    invalidate: [PROVIDERS_KEY],
  });
}

/** Test de connexion : ne crée jamais de paiement ; le résultat est un code (jamais un message du fournisseur). */
export function useTestProvider() {
  return useApiAction({
    path: (v: { provider: FinanceProviderName }) => `${PROVIDERS_BASE}/${v.provider}/test`,
    schema: financeProviderTestResultDtoSchema,
    invalidate: [PROVIDERS_KEY],
  });
}

/** Efface tous les secrets du fournisseur et le désactive. */
export function useClearProviderCredentials() {
  return useApiAction({
    method: "DELETE",
    path: (v: { provider: FinanceProviderName }) => `${PROVIDERS_BASE}/${v.provider}/credentials`,
    schema: financeProviderDtoSchema,
    invalidate: [PROVIDERS_KEY],
  });
}

/** Rechiffre les secrets du tenant avec la clé active du coffre. */
export function useRotateProviderSecrets() {
  return useApiAction({
    path: `${PROVIDERS_BASE}/rotate-secrets`,
    schema: financeRotateSecretsResultDtoSchema,
    invalidate: [PROVIDERS_KEY],
  });
}

export type { FinanceProviderDto, FinanceProviderName, FinanceSaveProviderBody };
export type { FinanceProviderFieldDto, FinanceProviderListDto, FinanceProviderTestResultDto, FinanceRotateSecretsResultDto } from "@ecoledigitale/contracts/v2/finance";
