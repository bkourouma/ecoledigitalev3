"use client";

/**
 * Mutations des écrans v2 : même client API typé que `platformHooks.useApiMutation`, avec en plus un CORPS distinct des
 * variables (les contrats d'entrée sont `strict()` : y glisser l'identifiant du chemin serait refusé par l'API).
 *
 * - le chemin et le corps se calculent depuis les variables ;
 * - la réponse est validée par le schéma Zod du contrat ;
 * - le cache est invalidé par préfixes de clés (sans tenant : `platformHooks.queryKey` l'ajoute) ;
 */

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { ZodType, ZodTypeDef } from "zod";
import type { ApiError } from "@/platform/api/errors";
import type { HttpMethod, QueryParams } from "@/platform/api/client";
import { platformHooks } from "@/platform/api/default-client";

export interface ActionOptions<TData, TVars> {
  method?: Exclude<HttpMethod, "GET" | "HEAD" | "OPTIONS">;
  path: string | ((variables: TVars) => string);
  /** Corps JSON ; absent : aucune donnée envoyée (action sans paramètre). */
  body?: (variables: TVars) => unknown;
  /** Paramètres de requête (par exemple `DELETE` avec motif : l'API les lit dans la chaîne de requête). */
  query?: (variables: TVars) => QueryParams;
  schema?: ZodType<TData, ZodTypeDef, unknown>;
  invalidate?: ReadonlyArray<readonly unknown[]>;
  /** Clé d'idempotence (en-tête `Idempotency-Key`) : autorise aussi les nouvelles tentatives d'un POST. */
  idempotencyKey?: (variables: TVars) => string | undefined;
  /** `text` pour un export (CSV) : la réponse n'est pas du JSON. */
  responseType?: "json" | "text" | "blob";
}

export function useApiAction<TData = unknown, TVars = void>(options: ActionOptions<TData, TVars>): UseMutationResult<TData, ApiError, TVars> {
  const queryClient = useQueryClient();
  return useMutation<TData, ApiError, TVars>({
    mutationFn: (variables) =>
      platformHooks.client.request<TData, ZodType<TData, ZodTypeDef, unknown> | undefined>(options.method ?? "POST", typeof options.path === "function" ? options.path(variables) : options.path, {
        body: options.body ? options.body(variables) : undefined,
        query: options.query ? options.query(variables) : undefined,
        schema: options.schema,
        idempotencyKey: options.idempotencyKey?.(variables),
        responseType: options.responseType,
      }) as Promise<TData>,
    onSuccess: async () => {
      await Promise.all((options.invalidate ?? []).map((parts) => queryClient.invalidateQueries({ queryKey: platformHooks.queryKey(...parts) })));
    },
  });
}
