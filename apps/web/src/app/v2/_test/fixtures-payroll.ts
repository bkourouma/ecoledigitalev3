/** Jeux de données de test du module paie, conformes à `packages/contracts/src/v2/payroll.ts` (validés par Zod). */

export const pid = (n: number): string => `00000000-0000-4000-8000-${String(n + 800_000).padStart(12, "0")}`;

type Over = Partial<Record<string, unknown>>;
const NOW = "2026-10-01T08:00:00.000Z";

export function period(over: Over = {}) {
  return {
    id: pid(1),
    name: "Octobre 2026",
    description: null,
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    status: "ACTIVE",
    academicYearId: pid(2),
    awaitingCalculation: false,
    targeted: false,
    targetStaffIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function payslip(over: Over = {}) {
  return {
    id: pid(10),
    periodId: pid(1),
    staffId: pid(20),
    staffName: "KOUASSI Marc",
    kind: "MIXED",
    status: "CALCULATED",
    statusLabel: "Calculé",
    currency: "XOF",
    salaryAmount: 200000,
    baseAmount: 300000,
    overtimeAmount: 44818,
    bonusAmount: 0,
    deductionAmount: 0,
    totalAmount: 344818,
    regularMinutes: 2400,
    overtimeMinutes: 120,
    calculatedAt: NOW,
    calculatedByName: "Gestionnaire Paie",
    approvedAt: null,
    approvedByName: null,
    paidAt: null,
    paidByName: null,
    paymentMethod: null,
    paymentReference: null,
    disputedAt: null,
    disputeReason: null,
    cancelledAt: null,
    cancelledByName: null,
    cancelReason: null,
    hasSnapshot: false,
    snapshotHash: null,
    replacesPayslipId: null,
    rowVersion: 1,
    updatedAt: NOW,
    ...over,
  };
}

export function line(over: Over = {}) {
  return {
    position: 1,
    source: "ATTENDANCE",
    sourceRefId: pid(30),
    date: "2026-10-05",
    startTime: "08:00",
    minutes: 120,
    rate: 5000,
    multiplierPermille: 1000,
    amount: 10000,
    isOvertime: false,
    rateOrigin: "NODE_STAFF",
    label: "Algèbre",
    code: "MATH-101",
    classroomLabel: "6e A",
    ...over,
  };
}

export function adjustment(over: Over = {}) {
  return { id: pid(40), kind: "BONUS", amount: 15000, label: "Prime d'assiduité", reason: null, createdByName: "Gestionnaire Paie", createdAt: NOW, ...over };
}

export function payslipDetail(over: Over = {}) {
  return {
    payslip: payslip(),
    lines: [line(), line({ position: 2, isOvertime: true, multiplierPermille: 1500, amount: 15000, sourceRefId: pid(31) })],
    adjustments: [],
    events: [{ id: pid(50), action: "payroll.payslip.calculated", reason: null, actorName: "Gestionnaire Paie", occurredAt: NOW, oldValues: null, newValues: null }],
    calcDetails: {},
    ...over,
  };
}

export function payslipData(over: Over = {}) {
  return {
    final: true,
    watermark: "NON VERSÉ",
    status: "APPROVED",
    snapshotHash: "ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12",
    intact: true,
    document: {
      v: 1,
      staff: { id: pid(20), displayName: "KOUASSI Marc", matricule: "ENS-0007" },
      period: { id: pid(1), name: "Octobre 2026", startDate: "2026-10-01", endDate: "2026-10-31" },
      currency: "XOF",
      amounts: { salary: 200000, regularHours: 100000, overtime: 44818, bonus: 0, deduction: 0, total: 344818 },
      minutes: { regular: 2400, overtime: 120 },
      approvedAt: NOW,
      approvedByName: "Directeur Paie",
    },
    payment: null,
    ...over,
  };
}

export function config(over: Over = {}) {
  return {
    id: pid(60),
    staffId: pid(20),
    type: "MIXED",
    monthlySalary: 200000,
    annualSalary: null,
    defaultHourlyRate: 5000,
    overtimeThresholdMinutes: 2400,
    overtimeMultiplierPermille: 1500,
    effectiveFrom: "2026-09-01",
    effectiveTo: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function rate(over: Over = {}) {
  return { id: pid(70), curriculumNodeId: pid(80), staffId: null, rate: 6000, validFrom: "2026-09-01", validTo: null, notes: null, createdAt: NOW, updatedAt: NOW, ...over };
}

export function settings(over: Over = {}) {
  return { currency: "XOF", defaultOvertimeThresholdMinutes: 2400, defaultOvertimeMultiplierPermille: 1500, requireSeparateApprover: true, ownerApprovalThreshold: 500000, updatedAt: NOW, ...over };
}

export function report(over: Over = {}) {
  return {
    runId: pid(90),
    periodId: pid(1),
    dryRun: false,
    scope: "ALL",
    recalculate: false,
    calculated: 1,
    skipped: 2,
    locked: 1,
    failed: 0,
    durationMs: 42,
    items: [
      { staffId: pid(20), staffName: "KOUASSI Marc", outcome: "CALCULATED", skipReason: null, message: null, payslipId: pid(10), minutesBySource: { ATTENDANCE: 1200, SESSION: 1320 }, total: 344818, preview: null },
      { staffId: pid(21), staffName: "BAMBA Awa", outcome: "SKIPPED", skipReason: "NO_RATE_RESOLVED", message: "Aucun tarif pour Algèbre le 5 octobre.", payslipId: null, minutesBySource: null, total: null, preview: null },
      { staffId: pid(22), staffName: "DIALLO Sékou", outcome: "SKIPPED", skipReason: "NO_CONFIG", message: null, payslipId: null, minutesBySource: null, total: null, preview: null },
      { staffId: pid(23), staffName: "TOURE Fanta", outcome: "LOCKED", skipReason: "PAYSLIP_LOCKED", message: null, payslipId: pid(11), minutesBySource: null, total: 120000, preview: null },
    ],
    ...over,
  };
}

export function run(over: Over = {}) {
  return {
    id: pid(90),
    periodId: pid(1),
    scope: "ALL",
    recalculate: false,
    dryRun: false,
    status: "COMPLETED",
    calculated: 1,
    skipped: 2,
    locked: 1,
    failed: 0,
    durationMs: 42,
    error: null,
    requestedBy: pid(500),
    requestedAt: NOW,
    finishedAt: NOW,
    items: [],
    ...over,
  };
}

export function batch(over: Over = {}) {
  return { done: [], unchanged: [], rejected: [], ...over };
}

export function ownerMass(over: Over = {}) {
  const status = (payslips: number, total: number) => ({ payslips, total });
  return {
    periods: [
      {
        periodId: pid(1),
        periodName: "Octobre 2026",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        academicYearId: pid(2),
        byStatus: { CALCULATED: status(2, 700000), APPROVED: status(1, 344818), PAID: status(3, 900000) },
        counted: status(6, 1944818),
        apart: { cancelled: status(1, 50000), disputed: status(1, 80000) },
      },
    ],
    counted: status(6, 1944818),
    ...over,
  };
}

export function summaryReport(over: Over = {}) {
  return {
    rows: [
      { status: "APPROVED", payslips: 2, total: 700000, attendance: 400000, session: 250000, outOfHours: 50000, filtered: 400000 },
      { status: "PAID", payslips: 3, total: 900000, attendance: 500000, session: 400000, outOfHours: 0, filtered: 500000 },
    ],
    sources: [
      { kind: "ATTENDANCE", minutes: 12000, amount: 900000 },
      { kind: "SESSION", minutes: 9000, amount: 650000 },
    ],
    filteredTotal: 900000,
    ...over,
  };
}
