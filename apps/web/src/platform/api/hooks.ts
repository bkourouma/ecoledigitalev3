/**
 * Fabrique de hooks react-query adossée à un `ApiClient`.
 *
 * Les clés de cache sont STABLES et incluent le tenant : `["api", <tenant>, ...clé]`. Deux tenants (ou un
 * tenant inconnu) ne partagent donc jamais d'entrée de cache, et un changement de tenant invalide
 * naturellement les données affichées.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
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
  /** Garde les données de la clé précédente pendant le chargement de la nouvelle (navigation par semaine, pagination). */
  keepPreviousData?: boolean;
  /** Relecture périodique (ms), ou calculée depuis la donnée (suivi d'une tâche de fond : simulation, rendu) ; `false` : arrêt. */
  refetchInterval?: number | false | ((data: TData | undefined) => number | false);
}

export interface ApiMutationOptions<TData, TVariables> {
  method?: Exclude<HttpMethod, "GET" | "HEAD" | "OPTIONS">;
  /** Chemin fixe ou calculé depuis les variables. */
  path: string | ((variables: TVariables) => string);
  /**
   * Corps de la requête calculé depuis les variables (défaut : les variables elles-mêmes). Permet de sortir un
   * identifiant du chemin sans l'envoyer dans le corps ; renvoyer `undefined` n'envoie aucun corps (DELETE).
   */
  body?: (variables: TVariables) => unknown;
  schema?: ZodType<TData, ZodTypeDef, unknown>;
  /** Préfixes de clés (sans tenant) à invalider après succès. */
  invalidate?: readonly (readonly unknown[])[];
  /** Clé d'idempotence (autorise les retries d'un POST). */
  idempotencyKey?: (variables: TVariables) => string;
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: ApiError, variables: TVariables) => void;
}

export interface ApiInfiniteQueryOptions<TPage> {
  query?: QueryParams;
  schema?: ZodType<TPage, ZodTypeDef, unknown>;
  /** Curseur de la page suivante, ou `null`/`undefined` à la fin. */
  getNextCursor: (lastPage: TPage) => string | null | undefined;
  /** Nom du paramètre de requête portant le curseur (défaut `cursor`). */
  cursorParam?: string;
  enabled?: boolean;
  staleTime?: number;
  retry?: boolean | number;
}

export interface QueryHooks {
  client: ApiClient;
  /** `["api", tenant, ...parts]` pour le tenant courant du client. */
  queryKey(...parts: readonly unknown[]): QueryKey;
  /** Liste paginée par curseur (journal d'audit…) : `data.pages` s'accumule à chaque `fetchNextPage()`. */
  useApiInfiniteQuery<TPage = unknown>(
    key: readonly unknown[],
    path: string,
    options: ApiInfiniteQueryOptions<TPage>,
  ): UseInfiniteQueryResult<InfiniteData<TPage, string | null>, ApiError>;
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

const noopSubscribe = (): (() => void) => () => {};

/**
 * Faux sur le serveur et pendant l'hydratation, vrai ensuite côté navigateur : le tenant n'est connu que dans le navigateur
 * (sous-domaine, stockage) ; sans cette garde, le HTML du serveur (requête désactivée) diffère du premier rendu client
 * (requête active, squelette) et React signale « Hydration failed » (rapports QA C-02-04 et C-05).
 */
function useClientReady(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function createQueryHooks(client: ApiClient): QueryHooks {
  const queryKey = (...parts: readonly unknown[]): QueryKey => buildQueryKey(client.getTenant(), parts);

  function useApiQuery<TData = unknown, TSelected = TData>(
    key: readonly unknown[],
    path: string,
    options: ApiQueryOptions<TData, TSelected> = {},
  ): UseQueryResult<TSelected, ApiError> {
    const clientReady = useClientReady();
    const tenant = clientReady ? client.getTenant() : null;
    const hasTenant = tenant !== null;
    const queryKey = buildQueryKey(tenant, options.query ? [...key, options.query] : key);
    // Même ressource (clé identique hors paramètres de requête) : seulement dans ce cas on garde l'ancien contenu pendant
    // le chargement ; un changement de ressource (autre classe, autre enfant) ne montre jamais les données de la précédente.
    const sameResource = (previousKey: readonly unknown[]) => JSON.stringify(previousKey.slice(0, -1)) === JSON.stringify(queryKey.slice(0, -1));
    return useQuery<TData, ApiError, TSelected>({
      // Les paramètres de requête font partie de la clé : deux filtres différents = deux entrées.
      queryKey,
      queryFn: ({ signal }) =>
        client.request<TData, ZodTypeAny | undefined>("GET", path, { query: options.query, schema: options.schema, signal }) as Promise<TData>,
      // Sans tenant, aucune requête n'est émise (l'UI affiche l'état « tenant inconnu »).
      enabled: (options.enabled ?? true) && hasTenant,
      staleTime: options.staleTime,
      gcTime: options.gcTime,
      select: options.select,
      refetchOnWindowFocus: options.refetchOnWindowFocus,
      placeholderData: options.keepPreviousData && options.query ? (previous, previousQuery) => (previousQuery && sameResource(previousQuery.queryKey) ? previous : undefined) : undefined,
      refetchInterval:
        typeof options.refetchInterval === "function"
          ? (query) => (options.refetchInterval as (data: TData | undefined) => number | false)(query.state.data)
          : options.refetchInterval,
      retry: options.retry ?? ((count, error) => count < 1 && !isClientError(error)),
    });
  }

  function useApiInfiniteQuery<TPage = unknown>(
    key: readonly unknown[],
    path: string,
    options: ApiInfiniteQueryOptions<TPage>,
  ): UseInfiniteQueryResult<InfiniteData<TPage, string | null>, ApiError> {
    const clientReady = useClientReady();
    const tenant = clientReady ? client.getTenant() : null;
    const cursorParam = options.cursorParam ?? "cursor";
    return useInfiniteQuery<TPage, ApiError, InfiniteData<TPage, string | null>, QueryKey, string | null>({
      queryKey: buildQueryKey(tenant, options.query ? [...key, "infinite", options.query] : [...key, "infinite"]),
      initialPageParam: null,
      queryFn: ({ signal, pageParam }) =>
        client.request<TPage, ZodTypeAny | undefined>("GET", path, {
          query: { ...options.query, ...(pageParam ? { [cursorParam]: pageParam } : {}) },
          schema: options.schema,
          signal,
        }) as Promise<TPage>,
      getNextPageParam: (lastPage) => options.getNextCursor(lastPage) ?? undefined,
      enabled: (options.enabled ?? true) && tenant !== null,
      staleTime: options.staleTime,
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
          body: options.body ? options.body(variables) : variables,
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

  return { client, queryKey, useApiQuery, useApiInfiniteQuery, useApiMutation };
}

function isClientError(error: ApiError): boolean {
  return error.status >= 400 && error.status < 500;
}
