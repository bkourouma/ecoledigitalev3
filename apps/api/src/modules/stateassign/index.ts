/**
 * API PUBLIQUE du module `stateassign` — seul point d'import autorisé pour les autres modules (et les adaptateurs de plateforme).
 *
 *   import { createStateassignDeps, reconcileAssignment, registerStateassignPorts } from "../stateassign";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (convention n° 4) ; les montants sont des
 * `Money` (kernel, entiers) ; élèves, inscriptions, factures, paiements, présences et documents sont des UUID lus par des ports.
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as stateassignManifest } from "./manifest";

// Plugin Fastify et registre de ports
export { stateassignPlugin, registerStateassignPorts, setup as stateassignSetup, type StateassignPluginOptions } from "./http/plugin";
export { createPermissionKit, PERMISSIONS as STATEASSIGN_PERMISSIONS, FEATURES as STATEASSIGN_FEATURES, type PermissionKit } from "./http/guards";
export {
  createStateassignPortRegistry,
  resetStateassignWorkerPorts,
  setStateassignWorkerPorts,
  stateassignWorkerPorts,
  type StateassignPortRegistry,
} from "./application/port-registry";

// Dépendances et configuration
export { createStateassignDeps, DEFAULT_STATEASSIGN_CONFIG, type StateassignConfig, type StateassignDeps, type StateassignDepsInput } from "./application/deps";

// Ports (ce que le module attend de ses voisins) et leurs implémentations de test / de repli
export type {
  AttendanceFacts,
  AttendanceFactsPort,
  AuditEntry,
  AuditPort,
  DocumentReadCaps,
  DocumentRefPort,
  EnrollmentFacts,
  EnrollmentFundingPort,
  EnrollmentPort,
  FinancePort,
  FundingInvoiceFacts,
  FundingPaymentFacts,
  FundingRefusal,
  GatewayAssignment,
  GatewayRefusal,
  GuardianshipPort,
  PeriodFacts,
  SetFundingInput,
  StateFundingBilling,
  StateGateway,
  StateassignPorts,
  StudentNamesPort,
} from "./application/ports";
export { noopAudit, RecordingAudit } from "./application/ports";
export { stateassignAuditAdapter } from "./infrastructure/audit-adapter";
export { billingOf, InMemoryWorld, NotConfiguredGateway, unavailablePorts } from "./infrastructure/in-memory-ports";

// Cas d'usage
export {
  actOnAssignment,
  amendAssignment,
  getAssignmentDetail,
  getChildAssignment,
  listAssignmentPage,
  recordAssignment,
  updateAssignment,
  type ActInput,
  type RecordAssignmentInput,
} from "./application/assignments";
export { billedOf, reconcileAllTenants, reconcileAssignment, reconcileEnrollment, reconcileStudent, reconcileTenant, type ReconcileOptions, type ReconcileTenantReport } from "./application/reconciliation";
export {
  cancelReceivable,
  flagOverdueAllTenants,
  flagOverdueReceivables,
  getReceivableHistory,
  getReceivablesAging,
  listReceivablePage,
  scheduleReceivable,
  updateReceivable,
  type OverdueSweepReport,
} from "./application/receivables";
export {
  completeControl,
  getAttendanceFacts,
  listControlsReport,
  notifyDueControls,
  notifyDueControlsAllTenants,
  planControl,
  planControlsAllTenants,
  planRequiredControls,
  resolveControlAnomaly,
  waiveControl,
  type PlanControlsReport,
} from "./application/controls";
export { addAssignmentDocument, withdrawAssignmentDocument } from "./application/documents";
export { getInstitutionSettings, updateInstitutionSettings } from "./application/settings";
export {
  createFormat,
  exportCsv,
  fetchFromGateway,
  getExportCatalog,
  getGatewayStatus,
  getReconciliationReport,
  getSummary,
  listFormats,
  pushCertificateToGateway,
  updateFormat,
  type CsvExport,
  type ExportInput,
} from "./application/reports";

// Faits publiés pour les autres modules (analytics, bulletins : « Affecté(e) » = type de financement de l'inscription, jamais la décision)
export { getAssignmentFacts, listAssignmentsByStatus, type AssignmentFacts } from "./application/facts";

// Domaine (types et fonctions pures utiles aux autres modules et au web)
export { StateassignCode, HTTP_STATUS_BY_STATEASSIGN_CODE } from "./domain/errors";
export { ALL_STATEASSIGN_EVENT_TYPES, StateassignEvents, type StateassignEventType } from "./domain/events";
export { ASSIGNMENT_ACTS, ASSIGNMENT_TRANSITIONS, canTransitionAssignment, FINAL_ASSIGNMENT_STATUSES, type AssignmentAct } from "./domain/assignment";
export { CONTROL_TRANSITIONS, canTransitionControl, planControls } from "./domain/controls";
export { agingBucketOf, allocateReceived, daysOverdue, reconcile, receivableStatusOf, viewReceivable } from "./domain/reconciliation";
export { EXPORT_CATALOG, csvCell, toCsv, validateColumns } from "./domain/export";
export type * from "./domain/types";
