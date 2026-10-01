/**
 * Construction du snapshot IMMUABLE d'un bulletin (posé à l'arrêt du montant) et de sa vue « données » pour
 * l'API / le rendu PDF futur. Aucun calcul ici : on FIGE ce qui a été calculé.
 */
import { createHash } from "node:crypto";
import type { CalcDetails } from "../domain/calculation";
import type { AdjustmentRecord, PayPeriodRecord, PayslipLineRecord, PayslipRecord } from "../domain/records";
import { canonicalJson, type PayslipSnapshot } from "../domain/snapshot";
import type { ConfigType } from "../domain/types";
import type { StaffInfo } from "./ports";
import { fallbackStaffName } from "./support";

interface ConfigSnapshotShape {
  id?: string;
  type?: ConfigType;
  monthlySalary?: number | null;
  annualSalary?: number | null;
  defaultHourlyRate?: number | null;
  overtimeThresholdMinutes?: number;
  overtimeMultiplierPermille?: number;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

export function buildSnapshot(input: {
  payslip: PayslipRecord;
  period: PayPeriodRecord;
  lines: readonly PayslipLineRecord[];
  adjustments: readonly AdjustmentRecord[];
  staff: StaffInfo | undefined;
  approvedAt: Date;
  approvedByName: string;
}): PayslipSnapshot {
  const { payslip: p, period } = input;
  const cfg = p.configSnapshot as ConfigSnapshotShape;
  return {
    v: 1,
    payslipId: p.id,
    staff: { id: p.staffId, displayName: input.staff?.displayName ?? fallbackStaffName(p.staffId), matricule: input.staff?.matricule ?? null },
    period: { id: period.id, name: period.name, startDate: period.startDate, endDate: period.endDate },
    config: {
      id: cfg.id ?? p.configId,
      type: cfg.type ?? p.kind,
      monthlySalary: cfg.monthlySalary ?? null,
      annualSalary: cfg.annualSalary ?? null,
      defaultHourlyRate: cfg.defaultHourlyRate ?? null,
      overtimeThresholdMinutes: cfg.overtimeThresholdMinutes ?? 0,
      overtimeMultiplierPermille: cfg.overtimeMultiplierPermille ?? 1000,
      effectiveFrom: cfg.effectiveFrom ?? period.startDate,
      effectiveTo: cfg.effectiveTo ?? null,
    },
    currency: p.currency,
    amounts: {
      salary: p.salaryAmount.amount,
      regularHours: p.baseAmount.amount - p.salaryAmount.amount,
      overtime: p.overtimeAmount.amount,
      bonus: p.bonusAmount.amount,
      deduction: p.deductionAmount.amount,
      total: p.totalAmount.amount,
    },
    minutes: { regular: p.regularMinutes, overtime: p.overtimeMinutes },
    details: p.calcDetails as unknown as CalcDetails,
    lines: input.lines.map((l) => ({
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
    })),
    adjustments: input.adjustments.map((a) => ({ id: a.id, kind: a.kind, amount: a.amount.amount, label: a.label, reason: a.reason, createdByName: a.createdByName, createdAt: a.createdAt.toISOString() })),
    calculatedAt: p.calculatedAt.toISOString(),
    calculatedByName: p.calculatedByName,
    approvedAt: input.approvedAt.toISOString(),
    approvedByName: input.approvedByName,
  };
}

/** Empreinte SHA-256 (hex) de la forme canonique du snapshot. */
export const snapshotHash = (snapshot: unknown): string => createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
