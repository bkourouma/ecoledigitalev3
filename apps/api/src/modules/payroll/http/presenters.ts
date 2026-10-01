/** Conversion enregistrements du domaine -> DTO des contrats (`packages/contracts/src/v2/payroll.ts`). Montants entiers, dates ISO. */
import { STATUS_LABELS } from "../domain/state";
import type { AdjustmentRecord, CalculationRunItemRecord, CalculationRunRecord, HourlyRateRecord, PayConfigRecord, PayPeriodRecord, PayslipEventRecord, PayslipLineRecord, PayslipRecord, PayrollSettings } from "../domain/records";
import type { PayslipLineDraft } from "../domain/types";
import type { CalculationReport, PayslipPreview, StaffOutcome } from "../application/calculate";
import type { OwnerMassPeriod, PayslipDocument, SummaryRow } from "../application/queries";
import type { SourceTotals } from "../infrastructure/report-repo";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const isoReq = (d: Date): string => d.toISOString();

export const settingsDto = (s: PayrollSettings) => ({
  currency: s.currency,
  defaultOvertimeThresholdMinutes: s.defaultOvertimeThresholdMinutes,
  defaultOvertimeMultiplierPermille: s.defaultOvertimeMultiplierPermille,
  requireSeparateApprover: s.requireSeparateApprover,
  ownerApprovalThreshold: s.ownerApprovalThreshold ? s.ownerApprovalThreshold.amount : null,
  updatedAt: iso(s.updatedAt),
});

export const periodDto = (p: PayPeriodRecord) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  startDate: p.startDate,
  endDate: p.endDate,
  status: p.status,
  academicYearId: p.academicYearId,
  awaitingCalculation: p.awaitingCalculation,
  targeted: p.targetStaffIds.length > 0,
  targetStaffIds: [...p.targetStaffIds],
  createdAt: isoReq(p.createdAt),
  updatedAt: isoReq(p.updatedAt),
});

export const configDto = (c: PayConfigRecord) => ({
  id: c.id,
  staffId: c.staffId,
  type: c.type,
  monthlySalary: c.monthlySalary ? c.monthlySalary.amount : null,
  annualSalary: c.annualSalary ? c.annualSalary.amount : null,
  defaultHourlyRate: c.defaultHourlyRate ? c.defaultHourlyRate.amount : null,
  overtimeThresholdMinutes: c.overtimeThresholdMinutes,
  overtimeMultiplierPermille: c.overtimeMultiplierPermille,
  effectiveFrom: c.effectiveFrom,
  effectiveTo: c.effectiveTo,
  createdAt: isoReq(c.createdAt),
  updatedAt: isoReq(c.updatedAt),
});

export const rateDto = (r: HourlyRateRecord) => ({
  id: r.id,
  curriculumNodeId: r.curriculumNodeId,
  staffId: r.staffId,
  rate: r.rate.amount,
  validFrom: r.validFrom,
  validTo: r.validTo,
  notes: r.notes,
  createdAt: isoReq(r.createdAt),
  updatedAt: isoReq(r.updatedAt),
});

export const payslipDto = (p: PayslipRecord, staffName: string) => ({
  id: p.id,
  periodId: p.periodId,
  staffId: p.staffId,
  staffName,
  kind: p.kind,
  status: p.status,
  statusLabel: STATUS_LABELS[p.status],
  currency: p.currency,
  salaryAmount: p.salaryAmount.amount,
  baseAmount: p.baseAmount.amount,
  overtimeAmount: p.overtimeAmount.amount,
  bonusAmount: p.bonusAmount.amount,
  deductionAmount: p.deductionAmount.amount,
  totalAmount: p.totalAmount.amount,
  regularMinutes: p.regularMinutes,
  overtimeMinutes: p.overtimeMinutes,
  calculatedAt: isoReq(p.calculatedAt),
  calculatedByName: p.calculatedByName,
  approvedAt: iso(p.approvedAt),
  approvedByName: p.approvedByName,
  paidAt: iso(p.paidAt),
  paidByName: p.paidByName,
  paymentMethod: p.paymentMethod,
  paymentReference: p.paymentReference,
  disputedAt: iso(p.disputedAt),
  disputeReason: p.disputeReason,
  cancelledAt: iso(p.cancelledAt),
  cancelledByName: p.cancelledByName,
  cancelReason: p.cancelReason,
  hasSnapshot: p.hasSnapshot,
  snapshotHash: p.snapshotHash,
  replacesPayslipId: p.replacesPayslipId,
  rowVersion: p.rowVersion,
  updatedAt: isoReq(p.updatedAt),
});

export const lineDto = (l: PayslipLineRecord) => ({
  position: l.position,
  source: l.sourceKind,
  sourceRefId: l.sourceRefId,
  date: l.sessionDate,
  startTime: l.startTime,
  minutes: l.minutes,
  rate: l.rate.amount,
  multiplierPermille: l.multiplierPermille,
  amount: l.amount.amount,
  isOvertime: l.isOvertime,
  rateOrigin: l.rateOrigin,
  label: l.label,
  code: l.code,
  classroomLabel: l.classroomLabel,
});

export const draftLineDto = (l: PayslipLineDraft) => ({
  position: l.position,
  source: l.sourceKind,
  sourceRefId: l.sourceRefId,
  date: l.sessionDate,
  startTime: l.startTime,
  minutes: l.minutes,
  rate: l.rate.amount,
  multiplierPermille: l.multiplierPermille,
  amount: l.amount.amount,
  isOvertime: l.isOvertime,
  rateOrigin: l.rateOrigin,
  label: l.label,
  code: l.code,
  classroomLabel: l.classroomLabel,
});

export const adjustmentDto = (a: AdjustmentRecord) => ({ id: a.id, kind: a.kind, amount: a.amount.amount, label: a.label, reason: a.reason, createdByName: a.createdByName, createdAt: isoReq(a.createdAt) });

export const eventDto = (e: PayslipEventRecord) => ({ id: e.id, action: e.action, reason: e.reason, actorName: e.actorName, occurredAt: isoReq(e.occurredAt), oldValues: e.oldValues ?? null, newValues: e.newValues ?? null });

export const previewDto = (p: PayslipPreview) => ({
  kind: p.kind,
  salary: p.salary.amount,
  regularHours: p.regularHours.amount,
  overtime: p.overtime.amount,
  bonus: p.bonus.amount,
  deduction: p.deduction.amount,
  total: p.total.amount,
  regularMinutes: p.regularMinutes,
  overtimeMinutes: p.overtimeMinutes,
  lines: p.lines.map(draftLineDto),
  details: p.details as unknown as Record<string, unknown>,
});

export const outcomeDto = (o: StaffOutcome, withPreview: boolean) => ({
  staffId: o.staffId,
  staffName: o.staffName,
  outcome: o.outcome,
  skipReason: o.skipReason,
  message: o.message,
  payslipId: o.payslipId,
  minutesBySource: o.minutesBySource ? (o.minutesBySource as Record<string, number>) : null,
  total: o.total ? o.total.amount : null,
  ...(withPreview ? { preview: o.preview ? previewDto(o.preview) : null } : {}),
});

export const reportDto = (r: CalculationReport) => ({
  runId: r.runId,
  periodId: r.periodId,
  dryRun: r.dryRun,
  scope: r.scope,
  recalculate: r.recalculate,
  calculated: r.calculated,
  skipped: r.skipped,
  locked: r.locked,
  failed: r.failed,
  durationMs: r.durationMs,
  items: r.items.map((i) => outcomeDto(i, r.dryRun)),
});

export const runDto = (run: CalculationRunRecord, items: readonly CalculationRunItemRecord[]) => ({
  id: run.id,
  periodId: run.periodId,
  scope: run.scope,
  recalculate: run.recalculate,
  dryRun: run.dryRun,
  status: run.status,
  calculated: run.calculated,
  skipped: run.skipped,
  locked: run.locked,
  failed: run.failed,
  durationMs: run.durationMs,
  error: run.error,
  requestedBy: run.requestedBy,
  requestedAt: isoReq(run.requestedAt),
  finishedAt: iso(run.finishedAt),
  items: items.map((i) => ({
    staffId: i.staffId,
    staffName: i.staffName,
    outcome: i.outcome,
    skipReason: i.skipReason,
    message: i.message,
    payslipId: i.payslipId,
    minutesBySource: i.minutesBySource ? (i.minutesBySource as Record<string, number>) : null,
    total: i.totalAmount ? i.totalAmount.amount : null,
  })),
});

export const dataDto = (d: PayslipDocument) => ({
  final: d.final,
  watermark: d.watermark,
  status: d.status,
  snapshotHash: d.snapshotHash,
  intact: d.intact,
  document: d.document as unknown as Record<string, unknown>,
  payment: d.payment,
});

export const summaryDto = (rows: readonly SummaryRow[], sources: readonly SourceTotals[], filteredTotal: number) => ({
  rows: rows.map((r) => ({ status: r.status, payslips: r.payslips, total: r.total.amount, attendance: r.attendance.amount, session: r.session.amount, outOfHours: r.outOfHours.amount, filtered: r.filtered.amount })),
  sources: sources.map((s) => ({ kind: s.kind, minutes: s.minutes, amount: s.amount.amount })),
  filteredTotal,
});

export const massDto = (periods: readonly OwnerMassPeriod[], counted: { payslips: number; total: { amount: number } }) => {
  const entry = (v: { payslips: number; total: { amount: number } }) => ({ payslips: v.payslips, total: v.total.amount });
  return {
    periods: periods.map((p) => ({
      periodId: p.periodId,
      periodName: p.periodName,
      startDate: p.startDate,
      endDate: p.endDate,
      academicYearId: p.academicYearId,
      byStatus: Object.fromEntries(Object.entries(p.byStatus).map(([k, v]) => [k, entry(v)])),
      counted: entry(p.counted),
      apart: { cancelled: entry(p.apart.cancelled), disputed: entry(p.apart.disputed) },
    })),
    counted: entry(counted),
  };
};
