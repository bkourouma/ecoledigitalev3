"use client";

/**
 * Hooks typés du module `analytics` (`/api/v1/analytics/*`, spec v2/025) : une fonction par vue, schémas Zod de
 * `packages/contracts/src/v2/analytics.ts`. AUCUN calcul de moyenne, de taux, de rang, de solde ou de décision ici ni dans les
 * écrans : le web affiche ce que l'API a lu des read-models (résultats FINAL de `results`, reporting de `finance`…) avec leur
 * `meta.asOf`, leur `stale` et leurs `gaps`.
 *
 * Clés de cache : `["analytics", <vue>, …]` (le tenant est ajouté par `platformHooks`). Les lectures restent « fraîches » 15 s,
 * comme l'en-tête `Cache-Control` de l'API.
 */

import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  analyticsAgedDataSchema,
  analyticsAttendanceDataSchema,
  analyticsCashDataSchema,
  analyticsChargesDataSchema,
  analyticsCollectionsDataSchema,
  analyticsEnrollmentDataSchema,
  analyticsEnvelope,
  analyticsFinanceSummaryDataSchema,
  analyticsFreshnessDataSchema,
  analyticsOverviewDataSchema,
  analyticsPayrollDataSchema,
  analyticsReceivablesDataSchema,
  analyticsResultsDataSchema,
  analyticsScopesDataSchema,
  analyticsSettingsDataSchema,
  analyticsTeachingLoadDataSchema,
  type AnalyticsExportDataset,
  type AnalyticsScopeQuery,
  type AnalyticsSettingsData,
  type AnalyticsSettingsUpdate,
} from "@ecoledigitale/contracts/v2/analytics";
import { useApiAction } from "./actions";

export const ANALYTICS_BASE = "/api/v1/analytics";

const STALE_MS = 15_000;
type Query = Record<string, string | number | boolean | undefined>;

/** Filtres communs : les valeurs vides ne sont pas envoyées. */
export function scopeQuery(filters: Partial<AnalyticsScopeQuery> & Record<string, string | number | boolean | undefined> = {}): Query {
  return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== "" && v !== null)) as Query;
}

function useView<S extends z.ZodTypeAny>(view: string, path: string, data: S, query: Query, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["analytics", view, query], `${ANALYTICS_BASE}/${path}`, {
    schema: analyticsEnvelope(data),
    query,
    staleTime: STALE_MS,
    enabled: options.enabled ?? true,
  });
}

/** Référentiel des filtres : établissements, campus, années, périodes, classes, année par défaut. */
export const useAnalyticsScopes = (filters: Partial<AnalyticsScopeQuery> = {}) => useView("scopes", "scopes", analyticsScopesDataSchema, scopeQuery(filters));

export const useAnalyticsOverview = (filters: Partial<AnalyticsScopeQuery> = {}, options?: { enabled?: boolean }) => useView("overview", "overview", analyticsOverviewDataSchema, scopeQuery(filters), options);
export const useAnalyticsEnrollment = (filters: Partial<AnalyticsScopeQuery> = {}, options?: { enabled?: boolean }) => useView("enrollment", "enrollment", analyticsEnrollmentDataSchema, scopeQuery(filters), options);
export const useAnalyticsAttendance = (filters: Partial<AnalyticsScopeQuery> = {}, options?: { enabled?: boolean }) => useView("attendance", "attendance", analyticsAttendanceDataSchema, scopeQuery(filters), options);
export const useAnalyticsResults = (filters: Partial<AnalyticsScopeQuery> & { gradeLevelCode?: string; scaleMax?: number; binWidth?: number } = {}, options?: { enabled?: boolean }) =>
  useView("results", "pedagogy/results", analyticsResultsDataSchema, scopeQuery(filters), options);
export const useAnalyticsTeachingLoad = (filters: Partial<AnalyticsScopeQuery> = {}, options?: { enabled?: boolean }) => useView("teaching-load", "pedagogy/teaching-load", analyticsTeachingLoadDataSchema, scopeQuery(filters), options);

export const useAnalyticsFinanceSummary = (filters: Partial<AnalyticsScopeQuery> = {}, options?: { enabled?: boolean }) => useView("finance-summary", "finance/summary", analyticsFinanceSummaryDataSchema, scopeQuery(filters), options);
export const useAnalyticsReceivables = (filters: Partial<AnalyticsScopeQuery> & { by?: "class" | "learner"; onlyOutstanding?: boolean; limit?: number; offset?: number } = {}, options?: { enabled?: boolean }) =>
  useView("receivables", "finance/receivables", analyticsReceivablesDataSchema, scopeQuery({ ...filters, onlyOutstanding: filters.onlyOutstanding === undefined ? undefined : String(filters.onlyOutstanding) }), options);
export const useAnalyticsCollections = (filters: { from?: string; to?: string; granularity?: "day" | "week" | "month" } = {}, options?: { enabled?: boolean }) =>
  useView("collections", "treasury/collections", analyticsCollectionsDataSchema, scopeQuery(filters), options);
export const useAnalyticsAged = (filters: Partial<AnalyticsScopeQuery> = {}, options?: { enabled?: boolean }) => useView("aged", "treasury/aged", analyticsAgedDataSchema, scopeQuery(filters), options);
export const useAnalyticsCash = (filters: Partial<AnalyticsScopeQuery> = {}, options?: { enabled?: boolean }) => useView("cash", "treasury/cash", analyticsCashDataSchema, scopeQuery(filters), options);

export const useAnalyticsPayroll = (filters: Partial<AnalyticsScopeQuery> = {}, options?: { enabled?: boolean }) => useView("payroll", "payroll/mass", analyticsPayrollDataSchema, scopeQuery(filters), options);
export const useAnalyticsCharges = (options?: { enabled?: boolean }) => useView("charges", "charges", analyticsChargesDataSchema, {}, options);
export const useAnalyticsFreshness = (options?: { enabled?: boolean }) => useView("freshness", "freshness", analyticsFreshnessDataSchema, {}, options);

/** Réglages d'affichage (seuils des feux, délai de fraîcheur). */
export const useAnalyticsSettings = (options?: { enabled?: boolean }) =>
  hooks.useApiQuery(["analytics", "settings"], `${ANALYTICS_BASE}/settings`, { schema: analyticsSettingsDataSchema, staleTime: STALE_MS, enabled: options?.enabled ?? true });

/** Mise à jour des réglages d'affichage : les vues sont relues (leurs états changent). */
export function useAnalyticsUpdateSettings() {
  return useApiAction<AnalyticsSettingsData, AnalyticsSettingsUpdate>({ method: "PUT", path: `${ANALYTICS_BASE}/settings`, body: (v) => v, schema: analyticsSettingsDataSchema, invalidate: [["analytics"]] });
}

/** Demande de reconstruction (mise en file côté API, exécutée par le worker). */
export function useAnalyticsRebuild() {
  return useApiAction<{ requested: boolean; requestId: string | null; queued: boolean }, { reason?: string }>({
    path: `${ANALYTICS_BASE}/rebuild`,
    body: (v) => v,
    invalidate: [["analytics", "freshness"]],
  });
}

/**
 * Export CSV PRODUIT PAR L'API (audité, BOM, `;`) : la réponse texte est enregistrée telle quelle, aucune ligne n'est recalculée
 * dans le navigateur. `onDone` reçoit le texte (le composant déclenche le téléchargement).
 */
export function useAnalyticsExport() {
  return useMutation<string, Error, { dataset: AnalyticsExportDataset; query?: Query }>({
    mutationFn: ({ dataset, query }) =>
      hooks.client.request<string, undefined>("GET", `${ANALYTICS_BASE}/export/${dataset}.csv`, { query: query ?? {}, responseType: "text" }) as Promise<string>,
  });
}
