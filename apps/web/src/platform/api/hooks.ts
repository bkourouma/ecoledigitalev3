/**
 * Fabrique de hooks react-query adossée à un `ApiClient`.
 *
 * Les clés de cache sont STABLES et incluent le tenant : `["api", <tenant>, ...clé]`. Deux tenants (ou un
 * tenant inconnu) ne partagent donc jamais d'entrée de cache, et un changement de tenant invalide
 * naturellement les données affichées.
 */

import { useMutation, useQuery, useQueryClient, type QueryKey, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import type { ZodType, ZodTypeAny, ZodTypeDef } from "zod";
import type { ApiClient, HttpMethod, QueryParams } from "./client";
import type { ApiError } from "./errors";

export const API_KEY_ROOT = "api";
export const NO_TENANT_KEY = "no-tenant";

export interface ApiQueryOptions<TData, TSelected = TData> {
  query?: QueryParams;
  /** Schéma Zod de la réponse (contrats). */
  schema?: ZodType<TData, ZodTypeDef, unknown>;
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  retry?: boolean | number;
  select?: (data: TData) => TSelected;
  refetchOnWindowFocus?: boolean;
}

export interface ApiMutationOptions<TData, TVariables> {
  method?: Exclude<HttpMethod, "GET" | "HEAD" | "OPTIONS">;
  /** Chemin fixe ou calculé depuis les variables. */
  path: string | ((variables: TVariables) => string);
  schema?: ZodType<TData, ZodTypeDef, unknown>;
  /** Préfixes de clés (sans tenant) à invalider après succès. */
  invalidate?: readonly (readonly unknown[])[];
  /** Clé d'idempotence (autorise les retries d'un POST). */
  idempotencyKey?: (variables: TVariables) => string;
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: ApiError, variables: TVariables) => void;
}

export interface QueryHooks {
  client: ApiClient;
  /** `["api", tenant, ...parts]` pour le tenant courant du client. */
  queryKey(...parts: readonly unknown[]): QueryKey;
  useApiQuery<TData = unknown, TSelected = TData>(
    key: readonly unknown[],
    path: string,
    options?: ApiQueryOptions<TData, TSelected>,
  ): UseQueryResult<TSelected, ApiError>;
  useApiMutation<TData = unknown, TVariables = void>(
    options: ApiMutationOptions<TData, TVariables>,
  ): UseMutationResult<TData, ApiError, TVariables>;
}

export function buildQueryKey(tenant: string | null | undefined, parts: readonly unknown[]): QueryKey {
  return [API_KEY_ROOT, tenant && tenant.trim() !== "" ? tenant.trim() : NO_TENANT_KEY, ...parts];
}

export function createQueryHooks(client: ApiClient): QueryHooks {
  const queryKey = (...parts: readonly unknown[]): QueryKey => buildQueryKey(client.getTenant(), parts);

  function useApiQuery<TData = unknown, TSelected = TData>(
    key: readonly unknown[],
    path: string,
    options: ApiQueryOptions<TData, TSelected> = {},
  ): UseQueryResult<TSelected, ApiError> {
    const tenant = client.getTenant();
    const hasTenant = tenant !== null;
    return useQuery<TData, ApiError, TSelected>({
      // Les paramètres de requête font partie de la clé : deux filtres différents = deux entrées.
      queryKey: buildQueryKey(tenant, options.query ? [...key, options.query] : key),
      queryFn: ({ signal }) =>
        client.request<TData, ZodTypeAny | undefined>("GET", path, { query: options.query, schema: options.schema, signal }) as Promise<TData>,
      // Sans tenant, aucune requête n'est émise (l'UI affiche l'état « tenant inconnu »).
      enabled: (options.enabled ?? true) && hasTenant,
      staleTime: options.staleTime,
      gcTime: options.gcTime,
      select: options.select,
      refetchOnWindowFocus: options.refetchOnWindowFocus,
      retry: options.retry ?? ((count, error) => count < 1 && !isClientError(error)),
    });
  }

  function useApiMutation<TData = unknown, TVariables = void>(
    options: ApiMutationOptions<TData, TVariables>,
  ): UseMutationResult<TData, ApiError, TVariables> {
    const queryClient = useQueryClient();
    return useMutation<TData, ApiError, TVariables>({
      mutationFn: (variables) =>
        client.request<TData, ZodTypeAny | undefined>(options.method ?? "POST", typeof options.path === "function" ? options.path(variables) : options.path, {
          body: variables,
          schema: options.schema,
          idempotencyKey: options.idempotencyKey?.(variables),
        }) as Promise<TData>,
      onSuccess: async (data, variables) => {
        await Promise.all((options.invalidate ?? []).map((parts) => queryClient.invalidateQueries({ queryKey: queryKey(...parts) })));
        options.onSuccess?.(data, variables);
      },
      onError: (error, variables) => options.onError?.(error, variables),
    });
  }

  return { client, queryKey, useApiQuery, useApiMutation };
}

function isClientError(error: ApiError): boolean {
  return error.status >= 400 && error.status < 500;
}
