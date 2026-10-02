/**
 * API PUBLIQUE du module `payroll` — seul point d'import autorisé pour les autres modules.
 *
 *   import { registerPayrollPorts, inMemoryPayrollPorts, createPayrollDeps, calculatePeriod } from "../payroll";
 *
 * Les cas d'usage sont des fonctions `(deps, ctx, input) => Promise<Result<T, AppError>>` (conventions n° 4).
 * Branchement des sources : `scheduling` (séances réalisées et validées), `attendance` (présences enseignants),
 * `people` (annuaire du personnel), `academic` (libellés de curriculum) appellent, dans leur `setup(app, runtime)`,
 *
 *     registerPayrollPorts(app, { sessionHours, attendanceHours, staff, curriculum });
 *
 * La résolution est PARESSEUSE (à l'appel) ; tant qu'un port nécessaire manque, le calcul est REFUSÉ
 * (`payroll.port_unavailable`), jamais partiel. Événements : `PayrollEvents` (consommés par 014/015, 016, 025).
 */

// Manifeste (le registre le découvre via manifest.ts ; réexporté pour les tests d'assemblage)
export { default as payrollManifest } from "./manifest";

// Plugin Fastify, assemblage et ports
export { payrollPlugin, registerPayrollPorts, setup as payrollSetup, PAYROLL_ROUTES_PREFIX, type PayrollPluginOptions } from "./http/plugin";
export { createPayrollDeps, inTx as payrollInTx, type PayrollDeps, type PayrollDepsInput } from "./application/deps";
export { createPortRegistry as createPayrollPortRegistry } from "./application/ports";
export type {
  CurriculumLabel,
  CurriculumLabelPort,
  HourLockLine,
  HoursQuery,
  HoursSourcePort,
  OfficialDocumentInput,
  OfficialDocumentState,
  OfficialDocumentStatus,
  PayslipDocumentPort,
  PayrollPortRegistry,
  PayrollPorts,
  PayrollPortsInput,
  StaffDirectoryPort,
  StaffInfo,
} from "./application/ports";
export { InMemoryCurriculum, InMemoryHoursSource, InMemoryStaffDirectory, inMemoryPorts as inMemoryPayrollPorts, type InMemoryPayrollWorld } from "./infrastructure/in-memory-ports";
export { getPayslipPdf } from "./application/payslip-document";
export { buildPayslipDocument, durationText, type PayslipDocument as PayslipPdfContent, type PayslipPaymentFacts } from "./domain/payslip-document";
export { noopAudit, RecordingAudit, type AuditEntry, type AuditPort } from "./application/audit";
export { payrollAuditAdapter } from "./infrastructure/audit-adapter";

// Cas d'usage
export { calculatePeriod, type CalculateInput, type CalculationReport, type PayslipPreview, type StaffOutcome } from "./application/calculate";
export { approvePayslips, payPayslips, cancelPayslip, disputePayslip, adjustPayslip, notifyPayslip, type ApproveInput, type PayInput, type AdjustInput, type BatchResult, type Selection } from "./application/workflow";
export { createPeriod, updatePeriod, setPeriodStatus, getPeriod, listPeriods, getPendingPeriod, type CreatePeriodInput } from "./application/periods";
export { createPayConfig, updatePayConfig, listPayConfigs, getPayConfig, getCurrentConfig, createHourlyRate, updateHourlyRate, deleteHourlyRate, listHourlyRates, simulateRate, configState, type ConfigInput, type ConfigState, type RateInput } from "./application/configs";
export { getPayrollSettings, updatePayrollSettings } from "./application/settings";
export { getPayslipDetail, getPayslipData, listPayslips, listHistory, listMyPayslips, getRun, listRuns, reportSummary, ownerMass, exportPayslipsCsv, authorizeRead, ownStaffId, type PayslipDetail, type PayslipDocument, type ReadCaps } from "./application/queries";
export { onTenantProvisioned, onSessionSourceChanged, onYearClosed, failStaleRunsForTenant } from "./application/consumers";

// Domaine : calcul pur, prédicat de payabilité, événements, codes d'erreur
export { computePayslip, lineAmount, compareHours, type PayslipComputation, type ComputeInput } from "./domain/calculation";
export { isPayable, toPayable, retainedMinutes, payabilityBlockers, collectPayable } from "./domain/payability";
export { PayrollEvents, ALL_PAYROLL_EVENT_TYPES, ConsumedEvents as PayrollConsumedEvents, type PayslipEventPayload } from "./domain/events";
export { PayrollCodes } from "./domain/errors";
export { LEGAL_TRANSITIONS, canTransition } from "./domain/state";
export type { HourFact, HourSourceKind, PayslipStatus, ConfigType } from "./domain/types";
export type { PayslipRecord, PayPeriodRecord, PayConfigRecord, HourlyRateRecord, PayrollSettings } from "./domain/records";
