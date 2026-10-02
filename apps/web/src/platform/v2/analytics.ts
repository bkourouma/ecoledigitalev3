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
  analyticsAdmissionsFunnelDataSchema,
  analyticsAgedDataSchema,
  analyticsAlertDetailSchema,
  analyticsAlertMetricsDataSchema,
  analyticsAlertRulesDataSchema,
  analyticsAlertsDataSchema,
  analyticsAttendanceDataSchema,
  analyticsCashDataSchema,
  analyticsChargesDataSchema,
  analyticsCollectionsDataSchema,
  analyticsComparisonDataSchema,
  analyticsEnrollmentDataSchema,
  analyticsEnvelope,
  analyticsFinanceSummaryDataSchema,
  analyticsFreshnessDataSchema,
  analyticsOverviewDataSchema,
  analyticsPayrollDataSchema,
  analyticsReceivablesDataSchema,
  analyticsResultsDataSchema,
  analyticsSchoolLifeDataSchema,
  analyticsScopesDataSchema,
  analyticsSettingsDataSchema,
  analyticsTeachingLoadDataSchema,
  type AnalyticsAlert,
  type AnalyticsAlertAcknowledgeBody,
  type AnalyticsAlertRule,
  type AnalyticsAlertRuleCreate,
  type AnalyticsAlertRuleUpdate,
  type AnalyticsAlertsQuery,
  type AnalyticsCompareQuery,
  type AnalyticsComparisonDomain,
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

// ---------------------------------------------------------------------------------------------------------------------
// Indicateurs transverses de direction (admissions, vie scolaire agrégée, comparaisons)
// ---------------------------------------------------------------------------------------------------------------------

/** Entonnoir d'admission : comptages par campagne et par étape (aucun candidat). */
export const useAnalyticsAdmissionsFunnel = (filters: { institutionId?: string; yearId?: string } = {}, options?: { enabled?: boolean }) =>
  useView("admissions-funnel", "admissions/funnel", analyticsAdmissionsFunnelDataSchema, scopeQuery(filters), options);

/** Vie scolaire agrégée : quatre comptages (confidentialité STANDARD), aucun élève. */
export const useAnalyticsSchoolLife = (filters: { institutionId?: string } = {}, options?: { enabled?: boolean }) =>
  useView("schoollife", "schoollife/summary", analyticsSchoolLifeDataSchema, scopeQuery(filters), options);

/** Comparaison d'un indicateur entre deux périodes ou années (la requête n'est émise que si ses deux côtés sont choisis). */
export const useAnalyticsCompare = (domain: AnalyticsComparisonDomain, query: Partial<AnalyticsCompareQuery>, options?: { enabled?: boolean }) =>
  useView(`compare-${domain}`, `compare/${domain}`, analyticsComparisonDataSchema, scopeQuery(query as Query), options);

// ---------------------------------------------------------------------------------------------------------------------
// Alertes configurables
// ---------------------------------------------------------------------------------------------------------------------

const alertsView = <T>(view: string, path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, query: Query, options: { enabled?: boolean } = {}) =>
  hooks.useApiQuery<T>(["analytics", "alerts", view, query], `${ANALYTICS_BASE}/${path}`, { schema, query, staleTime: 0, enabled: options.enabled ?? true });

/** Indicateurs que l'utilisateur peut surveiller (selon ses permissions de données). */
export const useAnalyticsAlertMetrics = (options?: { enabled?: boolean }) => alertsView("metrics", "alerts/metrics", analyticsAlertMetricsDataSchema, {}, options);
export const useAnalyticsAlertRules = (options?: { enabled?: boolean }) => alertsView("rules", "alerts/rules", analyticsAlertRulesDataSchema, {}, options);
export const useAnalyticsAlerts = (query: Partial<AnalyticsAlertsQuery> = {}, options?: { enabled?: boolean }) => alertsView("list", "alerts", analyticsAlertsDataSchema, scopeQuery(query as Query), options);
export const useAnalyticsAlert = (id: string | null, options?: { enabled?: boolean }) => alertsView("detail", `alerts/${id ?? "none"}`, analyticsAlertDetailSchema, { id: id ?? "" }, { enabled: Boolean(id) && (options?.enabled ?? true) });

const ALERT_KEYS = [["analytics", "alerts"]] as const;

export function useAnalyticsCreateAlertRule() {
  return useApiAction<AnalyticsAlertRule, AnalyticsAlertRuleCreate>({ path: `${ANALYTICS_BASE}/alerts/rules`, body: (v) => v, invalidate: ALERT_KEYS });
}

export function useAnalyticsUpdateAlertRule() {
  return useApiAction<AnalyticsAlertRule, { id: string; body: AnalyticsAlertRuleUpdate }>({ method: "PUT", path: (v) => `${ANALYTICS_BASE}/alerts/rules/${v.id}`, body: (v) => v.body, invalidate: ALERT_KEYS });
}

/** Accusé de réception : l'alerte et ses listes sont relues. */
export function useAnalyticsAcknowledgeAlert() {
  return useApiAction<AnalyticsAlert, { id: string; body: AnalyticsAlertAcknowledgeBody }>({ path: (v) => `${ANALYTICS_BASE}/alerts/${v.id}/acknowledge`, body: (v) => v.body, invalidate: ALERT_KEYS });
}

