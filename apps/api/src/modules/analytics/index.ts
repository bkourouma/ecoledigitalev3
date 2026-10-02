/**
 * API PUBLIQUE du module `analytics` : SEUL point d'import autorisé pour les autres modules et pour les adaptateurs de
 * `platform/adapters` (règle dependency-cruiser, `pnpm check:boundaries`).
 *
 *   import { registerAnalyticsPorts, setAnalyticsWorkerPorts, type AnalyticsSourcePorts } from "../analytics";
 *
 * `analytics` ne lit AUCUN autre module : les adaptateurs construisent les ports sources (`AnalyticsSourcePorts`) sur l'API
 * publique des modules fournisseurs. Les autres modules n'ont pas à l'appeler : les tableaux de bord sont servis par les
 * routes `/api/v1/analytics/*` et alimentés par les événements.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as analyticsManifest } from "./manifest";

// Plugin Fastify et registres de ports sources
export { default as analyticsPlugin, registerAnalyticsPorts, setup as analyticsSetup } from "./http/plugin";
export { analyticsWorkerPorts, createAnalyticsPortRegistry, resetAnalyticsWorkerPorts, setAnalyticsWorkerPorts, type AnalyticsPortRegistry } from "./application/port-registry";

// Dépendances et ports
export { createAnalyticsDeps, type AnalyticsDepsInput } from "./application/deps";
export {
  noopAudit as analyticsNoopAudit,
  type AnalyticsDeps,
  type AnalyticsSourcePorts,
  type AttendanceSource,
  type AuditEntry as AnalyticsAuditEntry,
  type AuditPort as AnalyticsAuditPort,
  type CalendarSource,
  type EnrollmentSource,
  type FinanceSource,
  type PayrollSource,
  type ResultsSource,
  type ScopeSource,
  type SourcePortName,
  type StaffPresenceSource,
  type TeachingLoadSource,
} from "./application/ports";
export { InMemoryAnalyticsWorld } from "./infrastructure/in-memory-sources";

// Cas d'usage : file de rafraîchissement, reconstruction, lectures
export { enqueueFromEvent, enqueueRefresh, processAllTenants as processAllAnalyticsRefreshes, processDueRefreshes, retryDelayMs, type ProcessReport } from "./application/requests";
export { rebuildAllTenants as rebuildAllAnalytics, rebuildTenant, refreshKind, summarize as summarizeRebuild, type RebuildReport } from "./application/rebuild";
export { refreshLeaf, PortUnavailable, REQUIRED_PORTS, type RefreshOutcome } from "./application/refresh";
export * as analyticsQueries from "./application/queries";
export { exportDataset, EXPORT_PERMISSIONS, type ExportResult } from "./application/exports";
export { getSettings as getAnalyticsSettings, requestRebuild, updateSettings as updateAnalyticsSettings } from "./application/admin";

// Domaine pur
export { planRefreshes, SUBSCRIPTION_GROUPS, REFRESH_DELAY_SECONDS, type RefreshRequestPlan } from "./domain/refresh-plan";
export { AnalyticsEvents, ALL_EVENT_TYPES as ALL_ANALYTICS_EVENT_TYPES, type AnalyticsEventType } from "./domain/events";
export { REFRESH_KINDS, type RefreshKind } from "./domain/types";
export type * from "./domain/types";
export { toCsv, csvCell } from "./domain/csv";
export { rateBps, readingStatus, contentHash } from "./domain/metrics";
