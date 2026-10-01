"use client";

/**
 * Hooks typés du module `payroll` (`/api/v1/payroll/*`, spec 032) : schémas Zod de `packages/contracts/src/v2/payroll.ts`.
 * AUCUN calcul de paie côté client : les montants, écarts, motifs et totaux affichés sont ceux de l'API ; le web ne fait
 * que transmettre les actions (aperçu `dryRun`, calcul, recalcul, arrêt, versement, annulation, contestation).
 *
 * Clés de cache : `["payroll", <ressource>, …]` (le tenant est ajouté par `platformHooks`).
 */

import { z } from "zod";
import { platformApi, platformHooks as hooks } from "@/platform/api/default-client";
import {
  payrollBatchResultDtoSchema,
  payrollCalculationReportDtoSchema,
  payrollConfigDtoSchema,
  payrollConfigPageDtoSchema,
  payrollCurrentConfigDtoSchema,
  payrollOwnerMassDtoSchema,
  payrollPayslipDataDtoSchema,
  payrollPayslipDetailDtoSchema,
  payrollPayslipDtoSchema,
  payrollPayslipPageDtoSchema,
  payrollPendingPeriodDtoSchema,
  payrollPeriodDtoSchema,
  payrollPeriodPageDtoSchema,
  payrollRateDtoSchema,
  payrollRatePageDtoSchema,
  payrollResolvedRateDtoSchema,
  payrollRunDtoSchema,
  payrollSettingsDtoSchema,
  payrollSummaryDtoSchema,
} from "@ecoledigitale/contracts/v2/payroll";
import { useApiAction } from "./actions";

export const PAYROLL_BASE = "/api/v1/payroll";

type Query = Record<string, string | number | boolean | undefined>;
const KEY = (resource: string) => ["payroll", resource] as const;

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

export function usePayrollSettings() {
  return hooks.useApiQuery(["payroll", "settings"], `${PAYROLL_BASE}/settings`, { schema: payrollSettingsDtoSchema, retry: false });
}

export interface PayrollSettingsPatch {
  defaultOvertimeThresholdMinutes?: number;
  defaultOvertimeMultiplierPermille?: number;
  requireSeparateApprover?: boolean;
  ownerApprovalThreshold?: number | null;
}

export function useUpdatePayrollSettings() {
  return useApiAction({ method: "PUT", path: `${PAYROLL_BASE}/settings`, body: (v: PayrollSettingsPatch) => v, schema: payrollSettingsDtoSchema, invalidate: [KEY("settings")] });
}

// ---------------------------------------------------------------------------
// Configurations de paie
// ---------------------------------------------------------------------------

export function usePayConfigs(query: { staffId?: string; activeOn?: string; limit?: number; offset?: number } = {}) {
  return hooks.useApiQuery(["payroll", "configs", "list"], `${PAYROLL_BASE}/configs`, { schema: payrollConfigPageDtoSchema, query: query as Query });
}

export function useCurrentPayConfig(staffId: string | null, onDate?: string) {
  return hooks.useApiQuery(["payroll", "configs", "current", staffId], `${PAYROLL_BASE}/staff/${staffId}/config/current`, {
    schema: payrollCurrentConfigDtoSchema,
    query: onDate ? { onDate } : undefined,
    enabled: staffId !== null,
  });
}

export interface PayConfigInput {
  type: "SALARY" | "HOURLY" | "MIXED";
  monthlySalary?: number | null;
  annualSalary?: number | null;
  defaultHourlyRate?: number | null;
  overtimeThresholdMinutes?: number;
  overtimeMultiplierPermille?: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export function useCreatePayConfig() {
  return useApiAction({
    path: `${PAYROLL_BASE}/configs`,
    body: (v: PayConfigInput & { staffId: string }) => v,
    schema: payrollConfigDtoSchema,
    invalidate: [KEY("configs")],
  });
}

export function useUpdatePayConfig() {
  return useApiAction({
    method: "PUT",
    path: (v: { id: string; body: PayConfigInput }) => `${PAYROLL_BASE}/configs/${v.id}`,
    body: (v) => v.body,
    schema: payrollConfigDtoSchema,
    invalidate: [KEY("configs")],
  });
}

// ---------------------------------------------------------------------------
// Tarifs horaires et simulateur
// ---------------------------------------------------------------------------

export function useHourlyRates(query: { nodeId?: string; staffId?: string; generic?: boolean; activeOn?: string; limit?: number; offset?: number } = {}) {
  return hooks.useApiQuery(["payroll", "rates", "list"], `${PAYROLL_BASE}/rates`, {
    schema: payrollRatePageDtoSchema,
    query: (query.generic === undefined ? query : { ...query, generic: String(query.generic) }) as Query,
  });
}

export interface RateInput {
  rate: number;
  validFrom: string;
  validTo?: string | null;
  notes?: string | null;
}

export function useCreateHourlyRate() {
  return useApiAction({
    path: `${PAYROLL_BASE}/rates`,
    body: (v: RateInput & { curriculumNodeId: string; staffId?: string | null }) => v,
    schema: payrollRateDtoSchema,
    invalidate: [KEY("rates")],
  });
}

export function useUpdateHourlyRate() {
  return useApiAction({
    method: "PUT",
    path: (v: { id: string; body: RateInput }) => `${PAYROLL_BASE}/rates/${v.id}`,
    body: (v) => v.body,
    schema: payrollRateDtoSchema,
    invalidate: [KEY("rates")],
  });
}

export function useDeleteHourlyRate() {
  return useApiAction({ method: "DELETE", path: (v: { id: string }) => `${PAYROLL_BASE}/rates/${v.id}`, invalidate: [KEY("rates")] });
}

/** Simulateur de tarif : le tarif retenu et son ORIGINE sont déterminés par l'API (ordre figé, AC5.1). */
export function useResolveRate(query: { staffId: string; date: string; nodeId?: string } | null) {
  return hooks.useApiQuery(["payroll", "rates", "resolve", query], `${PAYROLL_BASE}/rates/resolve`, {
    schema: payrollResolvedRateDtoSchema,
    query: (query ?? {}) as Query,
    enabled: query !== null,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------

export function usePayPeriods(query: { status?: string; academicYearId?: string; limit?: number; offset?: number } = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["payroll", "periods", "list"], `${PAYROLL_BASE}/periods`, { schema: payrollPeriodPageDtoSchema, query: query as Query, enabled: options.enabled });
}

export function usePendingPeriod(options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["payroll", "periods", "pending"], `${PAYROLL_BASE}/periods/pending`, { schema: payrollPendingPeriodDtoSchema, select: (d) => d.pending, enabled: options.enabled });
}

export function usePayPeriod(id: string | null) {
  return hooks.useApiQuery(["payroll", "periods", "one", id], `${PAYROLL_BASE}/periods/${id}`, { schema: payrollPeriodDtoSchema, enabled: id !== null });
}

export function useCreatePayPeriod() {
  return useApiAction({
    path: `${PAYROLL_BASE}/periods`,
    body: (v: { name: string; description?: string; startDate: string; endDate: string; academicYearId: string; staffIds?: string[] }) => v,
    schema: payrollPeriodDtoSchema,
    invalidate: [KEY("periods")],
  });
}

export function useUpdatePayPeriod() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; patch: Record<string, unknown> }) => `${PAYROLL_BASE}/periods/${v.id}`,
    body: (v) => v.patch,
    schema: payrollPeriodDtoSchema,
    invalidate: [KEY("periods")],
  });
}

// ---------------------------------------------------------------------------
// Calcul
// ---------------------------------------------------------------------------

export interface CalculateInput {
  id: string;
  scope?: "ALL" | "SESSION" | "ATTENDANCE";
  recalculate?: boolean;
  dryRun?: boolean;
  staffIds?: string[];
}

/** Aperçu (`dryRun: true`, rien n'est écrit) puis calcul ; le compte rendu (écartés nommés, motifs) vient de l'API. */
export function useCalculatePeriod() {
  return useApiAction({
    path: (v: CalculateInput) => `${PAYROLL_BASE}/periods/${v.id}/calculate`,
    body: (v) => ({
      ...(v.scope ? { scope: v.scope } : {}),
      ...(v.recalculate !== undefined ? { recalculate: v.recalculate } : {}),
      ...(v.dryRun !== undefined ? { dryRun: v.dryRun } : {}),
      ...(v.staffIds ? { staffIds: v.staffIds } : {}),
    }),
    schema: payrollCalculationReportDtoSchema,
    invalidate: [KEY("payslips"), KEY("periods"), KEY("runs"), KEY("history"), KEY("reports"), KEY("mass")],
  });
}

export function usePeriodRuns(periodId: string | null) {
  return hooks.useApiQuery(["payroll", "runs", "list", periodId], `${PAYROLL_BASE}/periods/${periodId}/runs`, {
    schema: z.object({ items: z.array(payrollRunDtoSchema) }),
    select: (d) => d.items,
    enabled: periodId !== null,
  });
}

export function usePayRun(id: string | null) {
  return hooks.useApiQuery(["payroll", "runs", "one", id], `${PAYROLL_BASE}/runs/${id}`, { schema: payrollRunDtoSchema, enabled: id !== null });
}

// ---------------------------------------------------------------------------
// Bulletins
// ---------------------------------------------------------------------------

export interface PayslipsQuery {
  periodId?: string;
  staffId?: string;
  status?: string;
  academicYearId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function usePayslips(query: PayslipsQuery = {}, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery(["payroll", "payslips", "list"], `${PAYROLL_BASE}/payslips`, { schema: payrollPayslipPageDtoSchema, query: query as Query, enabled: options.enabled });
}

export function usePayslip(id: string | null) {
  return hooks.useApiQuery(["payroll", "payslips", "one", id], `${PAYROLL_BASE}/payslips/${id}`, { schema: payrollPayslipDetailDtoSchema, enabled: id !== null });
}

export function usePayslipData(id: string | null, enabled = true) {
  return hooks.useApiQuery(["payroll", "payslips", "data", id], `${PAYROLL_BASE}/payslips/${id}/data`, { schema: payrollPayslipDataDtoSchema, enabled: id !== null && enabled });
}

export type PayslipSelection = { payslipIds: string[] } | { all: true; periodId: string };

const PAYSLIP_KEYS = [KEY("payslips"), KEY("periods"), KEY("history"), KEY("reports"), KEY("mass"), KEY("my")] as const;

/** Arrêt du montant (une seule action métier pour le gestionnaire et le propriétaire). Séparation des tâches et seuil : API. */
export function useApprovePayslips() {
  return useApiAction({ path: `${PAYROLL_BASE}/payslips/approve`, body: (v: PayslipSelection) => v, schema: payrollBatchResultDtoSchema, invalidate: PAYSLIP_KEYS });
}

export type PaymentMethod = "CASH" | "MOBILE_MONEY" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";

export function usePayPayslips() {
  return useApiAction({
    path: `${PAYROLL_BASE}/payslips/pay`,
    body: (v: { selection: PayslipSelection; method: PaymentMethod; reference?: string }) => ({ ...v.selection, method: v.method, ...(v.reference ? { reference: v.reference } : {}) }),
    schema: payrollBatchResultDtoSchema,
    invalidate: PAYSLIP_KEYS,
  });
}

export function useCancelPayslip() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${PAYROLL_BASE}/payslips/${v.id}/cancel`,
    body: (v) => ({ reason: v.reason }),
    schema: payrollPayslipDtoSchema,
    invalidate: PAYSLIP_KEYS,
  });
}

export function useDisputePayslip() {
  return useApiAction({
    path: (v: { id: string; reason: string }) => `${PAYROLL_BASE}/payslips/${v.id}/dispute`,
    body: (v) => ({ reason: v.reason }),
    schema: payrollPayslipDtoSchema,
    invalidate: PAYSLIP_KEYS,
  });
}

export interface AdjustmentInput {
  add?: Array<{ kind: "BONUS" | "DEDUCTION"; amount: number; label: string; reason?: string }>;
  remove?: string[];
}

export function useAdjustPayslip() {
  return useApiAction({
    method: "PATCH",
    path: (v: { id: string; body: AdjustmentInput }) => `${PAYROLL_BASE}/payslips/${v.id}/adjustments`,
    body: (v) => v.body,
    schema: payrollPayslipDtoSchema,
    invalidate: PAYSLIP_KEYS,
  });
}

export function useNotifyPayslip() {
  return useApiAction({ path: (v: { id: string }) => `${PAYROLL_BASE}/payslips/${v.id}/notify` });
}

// ---------------------------------------------------------------------------
// Historique, rapports, propriétaire, espace enseignant
// ---------------------------------------------------------------------------

export function usePayHistory(query: { staffId?: string; periodId?: string; academicYearId?: string; limit?: number; offset?: number } = {}) {
  return hooks.useApiQuery(["payroll", "history", "list"], `${PAYROLL_BASE}/history`, { schema: payrollPayslipPageDtoSchema, query: query as Query });
}

export interface ReportQuery {
  periodId?: string;
  academicYearId?: string;
  staffId?: string;
  from?: string;
  to?: string;
  source?: "ALL" | "SESSION" | "ATTENDANCE";
}

export function usePayrollSummary(query: ReportQuery = {}) {
  return hooks.useApiQuery(["payroll", "reports", "summary"], `${PAYROLL_BASE}/reports/summary`, { schema: payrollSummaryDtoSchema, query: query as Query });
}

/** Export CSV produit par l'API (audité) : texte brut, pas de JSON. */
export async function fetchPayrollCsv(kind: "history" | "reports", query: ReportQuery): Promise<string> {
  const path = kind === "history" ? `${PAYROLL_BASE}/history/export` : `${PAYROLL_BASE}/reports/export`;
  return platformApi.get<string>(path, { query: query as Query, responseType: "text" });
}

export function useOwnerMass(query: { academicYearId?: string; periodId?: string } = {}) {
  return hooks.useApiQuery(["payroll", "mass"], `${PAYROLL_BASE}/owner/mass`, { schema: payrollOwnerMassDtoSchema, query: query as Query, retry: false });
}

/** Validation propriétaire : la MÊME action métier que l'écran du gestionnaire (`approvePayslips`). */
export function useOwnerValidate() {
  return useApiAction({ path: (v: { id: string }) => `${PAYROLL_BASE}/owner/payslips/${v.id}/validate`, schema: payrollBatchResultDtoSchema, invalidate: PAYSLIP_KEYS });
}

export function useMyPayslips(query: { limit?: number; offset?: number } = {}) {
  return hooks.useApiQuery(["payroll", "my", "list"], `${PAYROLL_BASE}/my/payslips`, { schema: payrollPayslipPageDtoSchema, query: query as Query });
}

export function useMyPayslipData(id: string | null) {
  return hooks.useApiQuery(["payroll", "my", "one", id], `${PAYROLL_BASE}/my/payslips/${id}`, { schema: payrollPayslipDataDtoSchema, enabled: id !== null });
}
