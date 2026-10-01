/** Enregistrements lus en base (formes du domaine : `Money` pour les montants, `AAAA-MM-JJ` pour les dates). */
import type { CurrencyCode, Money } from "@ecoledigitale/kernel";
import type { AdjustmentKind, ConfigType, HourSourceKind, IsoDate, PaymentMethod, PayslipStatus, PeriodStatus, RateOrigin, SkipReason, Uuid } from "./types";

export interface PayrollSettings {
  readonly currency: CurrencyCode;
  readonly defaultOvertimeThresholdMinutes: number;
  readonly defaultOvertimeMultiplierPermille: number;
  readonly requireSeparateApprover: boolean;
  readonly ownerApprovalThreshold: Money | null;
  readonly updatedAt: Date | null;
}

export interface PayPeriodRecord {
  readonly id: Uuid;
  readonly name: string;
  readonly description: string | null;
  readonly startDate: IsoDate;
  readonly endDate: IsoDate;
  readonly status: PeriodStatus;
  readonly academicYearId: Uuid;
  readonly awaitingCalculation: boolean;
  readonly targetStaffIds: readonly Uuid[];
  readonly createdBy: Uuid;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PayConfigRecord {
  readonly id: Uuid;
  readonly staffId: Uuid;
  readonly type: ConfigType;
  readonly monthlySalary: Money | null;
  readonly annualSalary: Money | null;
  readonly defaultHourlyRate: Money | null;
  readonly overtimeThresholdMinutes: number;
  readonly overtimeMultiplierPermille: number;
  readonly effectiveFrom: IsoDate;
  readonly effectiveTo: IsoDate | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface HourlyRateRecord {
  readonly id: Uuid;
  readonly curriculumNodeId: Uuid;
  readonly staffId: Uuid | null;
  readonly rate: Money;
  readonly validFrom: IsoDate;
  readonly validTo: IsoDate | null;
  readonly notes: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PayslipRecord {
  readonly id: Uuid;
  readonly periodId: Uuid;
  readonly staffId: Uuid;
  readonly configId: Uuid;
  readonly kind: ConfigType;
  readonly salaryAmount: Money;
  readonly baseAmount: Money;
  readonly overtimeAmount: Money;
  readonly bonusAmount: Money;
  readonly deductionAmount: Money;
  readonly totalAmount: Money;
  readonly currency: CurrencyCode;
  readonly regularMinutes: number;
  readonly overtimeMinutes: number;
  readonly calcDetails: Record<string, unknown>;
  readonly configSnapshot: Record<string, unknown>;
  readonly status: PayslipStatus;
  readonly calculatedAt: Date;
  readonly calculatedBy: Uuid;
  readonly calculatedByName: string;
  readonly approvedAt: Date | null;
  readonly approvedBy: Uuid | null;
  readonly approvedByName: string | null;
  readonly paidAt: Date | null;
  readonly paidBy: Uuid | null;
  readonly paidByName: string | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly paymentReference: string | null;
  readonly disputedAt: Date | null;
  readonly disputeReason: string | null;
  readonly cancelledAt: Date | null;
  readonly cancelledBy: Uuid | null;
  readonly cancelledByName: string | null;
  readonly cancelReason: string | null;
  readonly hasSnapshot: boolean;
  readonly snapshotHash: string | null;
  readonly replacesPayslipId: Uuid | null;
  readonly rowVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PayslipLineRecord {
  readonly id: Uuid;
  readonly payslipId: Uuid;
  readonly sourceKind: HourSourceKind;
  readonly sourceRefId: Uuid;
  readonly staffId: Uuid;
  readonly sessionDate: IsoDate;
  readonly startTime: string | null;
  readonly minutes: number;
  readonly rate: Money;
  readonly multiplierPermille: number;
  readonly amount: Money;
  readonly isOvertime: boolean;
  readonly rateOrigin: RateOrigin;
  readonly curriculumNodeId: Uuid | null;
  readonly classroomId: Uuid | null;
  readonly label: string | null;
  readonly code: string | null;
  readonly classroomLabel: string | null;
  readonly position: number;
}

export interface AdjustmentRecord {
  readonly id: Uuid;
  readonly payslipId: Uuid;
  readonly kind: AdjustmentKind;
  readonly amount: Money;
  readonly label: string;
  readonly reason: string | null;
  readonly createdBy: Uuid;
  readonly createdByName: string;
  readonly createdAt: Date;
}

export interface PayslipEventRecord {
  readonly id: Uuid;
  readonly payslipId: Uuid;
  readonly action: string;
  readonly oldValues: unknown;
  readonly newValues: unknown;
  readonly reason: string | null;
  readonly actorId: Uuid | null;
  readonly actorName: string;
  readonly occurredAt: Date;
}

export type RunScope = "ALL" | "SESSION" | "ATTENDANCE";

export interface CalculationRunRecord {
  readonly id: Uuid;
  readonly periodId: Uuid;
  readonly scope: RunScope;
  readonly recalculate: boolean;
  readonly dryRun: boolean;
  readonly staffFilter: readonly Uuid[] | null;
  readonly status: "RUNNING" | "COMPLETED" | "FAILED";
  readonly calculated: number;
  readonly skipped: number;
  readonly locked: number;
  readonly failed: number;
  readonly durationMs: number | null;
  readonly error: string | null;
  readonly requestedBy: Uuid;
  readonly requestedAt: Date;
  readonly finishedAt: Date | null;
}

export type RunOutcome = "CALCULATED" | "SKIPPED" | "LOCKED" | "FAILED";

export interface CalculationRunItemRecord {
  readonly id: Uuid;
  readonly runId: Uuid;
  readonly staffId: Uuid;
  readonly staffName: string;
  readonly outcome: RunOutcome;
  readonly skipReason: SkipReason | null;
  readonly message: string | null;
  readonly payslipId: Uuid | null;
  readonly minutesBySource: Partial<Record<HourSourceKind, number>> | null;
  readonly totalAmount: Money | null;
}
