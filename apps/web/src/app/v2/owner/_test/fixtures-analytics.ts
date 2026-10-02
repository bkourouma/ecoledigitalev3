/**
 * Faux contenus de l'API `analytics` pour les tests d'écrans : ils respectent les schémas Zod des contrats (le faux client les
 * valide), de sorte qu'un changement de contrat casse le test au lieu de passer silencieusement.
 */
import type {
  AnalyticsAdmissionsFunnelData,
  AnalyticsAgedData,
  AnalyticsAlertDetail,
  AnalyticsAlertMetricsData,
  AnalyticsAlertRulesData,
  AnalyticsAlertsData,
  AnalyticsComparisonData,
  AnalyticsSchoolLifeData,
  AnalyticsAttendanceData,
  AnalyticsCashData,
  AnalyticsCollectionsData,
  AnalyticsEnrollmentData,
  AnalyticsFinanceSummaryData,
  AnalyticsFreshnessData,
  AnalyticsMeta,
  AnalyticsOverviewData,
  AnalyticsPayrollData,
  AnalyticsReceivablesData,
  AnalyticsResultsData,
  AnalyticsScopesData,
  AnalyticsTeachingLoadData,
} from "@ecoledigitale/contracts/v2/analytics";

export const aid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const IDS = { institution: aid(1), campusA: aid(2), campusB: aid(3), year: aid(10), p1: aid(20), p2: aid(21), classA: aid(30), classB: aid(31) };

export function meta(overrides: Partial<AnalyticsMeta> = {}): AnalyticsMeta {
  return {
    asOf: "2026-03-20T10:00:00.000Z",
    stale: false,
    sources: {},
    gaps: [],
    scope: { institutionId: null, campusId: null, yearId: IDS.year, periodId: null, from: null, to: null },
    ...overrides,
  };
}

export const env = <T,>(data: T, overrides: Partial<AnalyticsMeta> = {}): { meta: AnalyticsMeta; data: T } => ({ meta: meta(overrides), data });

export function scopes(overrides: Partial<AnalyticsScopesData> = {}): AnalyticsScopesData {
  return {
    institutions: [{ id: IDS.institution, label: "Collège Les Palmiers" }],
    campuses: [
      { id: IDS.campusA, institutionId: IDS.institution, label: "Campus Cocody" },
      { id: IDS.campusB, institutionId: IDS.institution, label: "Campus Marcory" },
    ],
    years: [{ id: IDS.year, institutionId: IDS.institution, code: "2025-2026", label: "Année 2025-2026", startsOn: "2025-09-15", endsOn: "2026-07-10", status: "OPEN", isCurrent: true }],
    periods: [
      { id: IDS.p1, yearId: IDS.year, code: "S1", label: "Semestre 1", ordinal: 1, startsOn: "2025-09-15", endsOn: "2026-01-31", status: "CLOSED" },
      { id: IDS.p2, yearId: IDS.year, code: "S2", label: "Semestre 2", ordinal: 2, startsOn: "2026-02-01", endsOn: "2026-07-10", status: "OPEN" },
    ],
    classrooms: [
      { id: IDS.classA, yearId: IDS.year, institutionId: IDS.institution, campusId: IDS.campusA, name: "6e A", gradeLevelCode: "6E", gradeLevelLabel: "Sixième" },
      { id: IDS.classB, yearId: IDS.year, institutionId: IDS.institution, campusId: IDS.campusB, name: "5e B", gradeLevelCode: "5E", gradeLevelLabel: "Cinquième" },
    ],
    defaultYearId: IDS.year,
    ...overrides,
  };
}

export function overview(overrides: Partial<AnalyticsOverviewData> = {}): AnalyticsOverviewData {
  return {
    headcount: { inSchooling: 412, total: 440, classrooms: 14 },
    attendanceToday: { day: "2026-03-20", recordsCount: 400, presentCount: 372, absentCount: 22, lateCount: 6, rateBps: 9300, status: "good", measured: true },
    results: { periodId: IDS.p1, periodLabel: "Semestre 1", generalAverage: 11.72, cohortSize: 380, validatedCount: 266, validationRateBps: 7000, measured: true, demonstration: false },
    staffToday: { day: "2026-03-20", present: 31, absent: 2, onLeave: 3, measured: true },
    ...overrides,
  };
}

export function financeSummary(overrides: Partial<AnalyticsFinanceSummaryData> = {}): AnalyticsFinanceSummaryData {
  return {
    currency: "XOF",
    asOfDate: "2026-03-20",
    summary: { invoiceCount: 120, billed: 60_000_000, credited: 1_000_000, netBilled: 59_000_000, collected: 41_000_000, outstanding: 18_000_000, overdue: 7_500_000, overdueInvoiceCount: 31, unallocated: 250_000, collectionRateBps: 6949, status: "warning" },
    byClassroom: [
      { groupKey: IDS.classA, label: "6e A", learnerCount: 30, invoiceCount: 30, billed: 30_000_000, credited: 0, collected: 24_000_000, outstanding: 6_000_000, overdue: 3_000_000, collectionRateBps: 8000 },
      { groupKey: IDS.classB, label: "5e B", learnerCount: 28, invoiceCount: 28, billed: 30_000_000, credited: 1_000_000, collected: 17_000_000, outstanding: 12_000_000, overdue: 4_500_000, collectionRateBps: 5862 },
    ],
    ...overrides,
  };
}

export function receivables(by: "class" | "learner" = "class", overrides: Partial<AnalyticsReceivablesData> = {}): AnalyticsReceivablesData {
  return {
    by,
    currency: "XOF",
    total: 2,
    rows: [
      { id: by === "class" ? IDS.classB : aid(900), label: by === "class" ? "5e B" : "KONE Mariam", groupLabel: "5e B", learnerCount: by === "class" ? 28 : 1, oldestOverdueDate: by === "learner" ? "2025-11-30" : null, invoiceCount: 3, billed: 300_000, credited: 0, collected: 100_000, outstanding: 200_000, overdue: 150_000, collectionRateBps: 3333 },
      { id: by === "class" ? IDS.classA : aid(901), label: by === "class" ? "6e A" : "TRAORE Issa", groupLabel: "6e A", learnerCount: by === "class" ? 30 : 1, oldestOverdueDate: null, invoiceCount: 1, billed: 100_000, credited: 0, collected: 50_000, outstanding: 50_000, overdue: 0, collectionRateBps: 5000 },
    ],
    ...overrides,
  };
}

export function collections(overrides: Partial<AnalyticsCollectionsData> = {}): AnalyticsCollectionsData {
  return {
    currency: "XOF",
    granularity: "month",
    range: { from: "2025-03-21", to: "2026-03-20" },
    points: [
      { bucket: "2026-01-01", collected: 5_000_000, refunded: 100_000, net: 4_900_000, paymentCount: 40 },
      { bucket: "2026-02-01", collected: 6_000_000, refunded: 0, net: 6_000_000, paymentCount: 52 },
    ],
    totals: { collected: 11_000_000, refunded: 100_000, net: 10_900_000, paymentCount: 92 },
    ...overrides,
  };
}

export function aged(overrides: Partial<AnalyticsAgedData> = {}): AnalyticsAgedData {
  return {
    currency: "XOF",
    asOfDate: "2026-03-20",
    buckets: [
      { bucket: "NOT_DUE", amount: 400_000, invoiceCount: 5 },
      { bucket: "D1_30", amount: 300_000, invoiceCount: 4 },
      { bucket: "D31_60", amount: 200_000, invoiceCount: 3 },
      { bucket: "D61_90", amount: 100_000, invoiceCount: 2 },
      { bucket: "D91_PLUS", amount: 50_000, invoiceCount: 1 },
    ],
    total: 1_050_000,
    learners: [{ learnerId: aid(900), learnerName: "KONE Mariam", notDue: 0, d1_30: 300_000, d31_60: 0, d61_90: 0, d91_plus: 0, total: 300_000 }],
    ...overrides,
  };
}

export function cash(overrides: Partial<AnalyticsCashData> = {}): AnalyticsCashData {
  return {
    currency: "XOF",
    totals: { sessions: 3, closed: 2, withVariance: 1, netVariance: -5000, absoluteVariance: 5000 },
    sessions: [
      { sessionId: aid(800), registerId: aid(810), cashierId: aid(820), status: "CLOSED", openedAt: "2026-03-10T08:00:00.000Z", closedAt: "2026-03-10T17:00:00.000Z", openingFloat: 50_000, expected: 300_000, counted: 295_000, variance: -5000 },
      { sessionId: aid(801), registerId: aid(810), cashierId: aid(820), status: "OPEN", openedAt: "2026-03-20T08:00:00.000Z", closedAt: null, openingFloat: 50_000, expected: null, counted: null, variance: null },
    ],
    ...overrides,
  };
}

export function payroll(overrides: Partial<AnalyticsPayrollData> = {}): AnalyticsPayrollData {
  return {
    currency: "XOF",
    periods: [
      {
        periodId: aid(600),
        name: "Février 2026",
        startsOn: "2026-02-01",
        endsOn: "2026-02-28",
        yearId: IDS.year,
        byStatus: { CALCULATED: { payslips: 3, total: 900_000 }, APPROVED: { payslips: 4, total: 1_400_000 }, PAID: { payslips: 2, total: 700_000 }, CANCELLED: { payslips: 1, total: 120_000 }, DISPUTED: { payslips: 1, total: 200_000 } },
        counted: { payslips: 9, total: 3_000_000 },
        cancelled: { payslips: 1, total: 120_000 },
        disputed: { payslips: 1, total: 200_000 },
      },
    ],
    counted: { payslips: 9, total: 3_000_000 },
    ...overrides,
  };
}

export function enrollment(overrides: Partial<AnalyticsEnrollmentData> = {}): AnalyticsEnrollmentData {
  const row = (key: string, label: string, count: number, inSchooling: number) => ({ key, label, count, inSchooling });
  return {
    totals: { total: 100, inSchooling: 90, repeaters: 9, repeaterRateBps: 1000 },
    byStatus: [row("ACTIVE", "ACTIVE", 90, 90), row("PENDING", "PENDING", 10, 0)],
    bySex: [row("F", "F", 50, 46), row("M", "M", 48, 44), row("UNKNOWN", "UNKNOWN", 2, 0)],
    byGradeLevel: [row("6E", "Sixième", 60, 55), row("5E", "Cinquième", 40, 35)],
    byFunding: [row("PRIVATE", "PRIVATE", 75, 70), row("STATE_ASSIGNED", "STATE_ASSIGNED", 25, 20)],
    byCampus: [row(IDS.campusA, "Campus Cocody", 60, 55), row(IDS.campusB, "Campus Marcory", 40, 35)],
    byClassroom: [{ classroomId: IDS.classA, name: "6e A", gradeLevelLabel: "Sixième", count: 30, inSchooling: 28, male: 14, female: 14 }],
    admissions: {
      created: 100,
      confirmed: 90,
      cancelled: 4,
      confirmationRateBps: 9000,
      bySource: [
        { sourceKind: "ADMISSION", created: 60, confirmed: 55 },
        { sourceKind: "MANUAL", created: 40, confirmed: 35 },
      ],
      monthly: [
        { month: "2025-09", created: 50, confirmed: 45 },
        { month: "2025-10", created: 50, confirmed: 45 },
      ],
    },
    ...overrides,
  };
}

export function attendance(overrides: Partial<AnalyticsAttendanceData> = {}): AnalyticsAttendanceData {
  const counts = { recordsCount: 200, presentCount: 180, absentCount: 20, excusedCount: 5, lateCount: 7, absentMinutes: 1200, rateBps: 9000 };
  return {
    range: { from: "2026-02-19", to: "2026-03-20" },
    totals: { ...counts, sessionsCount: 12, status: "good" },
    byDay: [{ day: "2026-03-19", ...counts }, { day: "2026-03-20", ...counts, rateBps: 8000 }],
    byClassroom: [{ classroomId: IDS.classA, name: "6e A", gradeLevelLabel: "Sixième", ...counts, status: "good" }, { classroomId: IDS.classB, name: "5e B", gradeLevelLabel: "Cinquième", ...counts, rateBps: 6500, status: "critical" }],
    staff: { byDay: [{ day: "2026-03-20", present: 31, absent: 2, onLeave: 3 }], measured: true },
    ...overrides,
  };
}

export function results(overrides: Partial<AnalyticsResultsData> = {}): AnalyticsResultsData {
  const stats = { count: 40, average: 12.35, min: 4.5, max: 18.25, validatedCount: 28, validationRateBps: 7000 };
  return {
    totals: { ...stats, classPeriodsFinal: 4, classPeriodsNotFinal: 1 },
    byClassroom: [{ classroomId: IDS.classA, name: "6e A", gradeLevelLabel: "Sixième", ...stats }],
    bySubject: [
      { nodeId: aid(500), code: "MATH", label: "Mathématiques", level: "SUBJECT", ...stats, validationRateBps: 4500, validatedCount: 18, resitEligibleCount: 12, session2Count: 3 },
      { nodeId: aid(501), code: "FR", label: "Français", level: "SUBJECT", ...stats, validationRateBps: 8000, validatedCount: 32, resitEligibleCount: 4, session2Count: 1 },
      { nodeId: aid(502), code: "UE1", label: "UE Fondamentale", level: "UE", ...stats, validationRateBps: 3000, validatedCount: 12, resitEligibleCount: 0, session2Count: 0 },
    ],
    byPeriod: [{ periodId: IDS.p1, label: "Semestre 1", ordinal: 1, ...stats, demonstration: false }],
    rulesSource: { demonstration: false, finalClassPeriods: 4, placeholderClassPeriods: 0, unknownClassPeriods: 0 },
    distribution: { scaleMax: 20, binWidth: 2, bins: Array.from({ length: 10 }, (_, i) => ({ index: i, from: i * 2, to: i * 2 + 2, count: i === 5 ? 9 : 3 })) },
    decisions: { period: [{ code: "ADMITTED", outcome: "ADMITTED", count: 28 }, { code: "ADJOURNED", outcome: "ADJOURNED", count: 12 }], year: [{ code: "REPEAT", outcome: "REPEAT", count: 5 }] },
    ...overrides,
  };
}

export function teachingLoad(overrides: Partial<AnalyticsTeachingLoadData> = {}): AnalyticsTeachingLoadData {
  return {
    yearId: IDS.year,
    rows: [{ staffId: aid(700), displayName: "Enseignant Un", status: "ACTIVE", plannedHours: 17.5, classroomCount: 3, contractualHoursPerWeek: 18 }],
    totals: { staffCount: 1, plannedHours: 17.5 },
    ...overrides,
  };
}

export function freshness(overrides: Partial<AnalyticsFreshnessData> = {}): AnalyticsFreshnessData {
  return {
    states: [
      { kind: "ENROLLMENT", scopeKey: "*", lastSuccessAt: "2026-03-20T10:00:00.000Z", lastAttemptAt: "2026-03-20T10:00:00.000Z", lastStatus: "OK", rowsWritten: 440, durationMs: 120, lastError: null },
      { kind: "PAYROLL", scopeKey: "*", lastSuccessAt: null, lastAttemptAt: "2026-03-20T10:01:00.000Z", lastStatus: "UNAVAILABLE", rowsWritten: 0, durationMs: 0, lastError: "Source non branchée." },
    ],
    queue: { PENDING: 2, FAILED: 1 },
    staleAfterSeconds: 86_400,
    ...overrides,
  };
}

// --- Partie B : entonnoir, vie scolaire, comparaisons, alertes -----------------------------------------------------------

export function funnel(overrides: Partial<AnalyticsAdmissionsFunnelData> = {}): AnalyticsAdmissionsFunnelData {
  const statuses = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "MISSING_DOCUMENT", "ACCEPTED", "REJECTED", "WAITLISTED", "ENROLLED"] as const;
  const counts: Record<(typeof statuses)[number], number> = { DRAFT: 5, SUBMITTED: 40, UNDER_REVIEW: 25, MISSING_DOCUMENT: 0, ACCEPTED: 20, REJECTED: 10, WAITLISTED: 0, ENROLLED: 30 };
  return {
    totals: { applications: 130, submitted: 125, accepted: 50, enrolled: 30, rejected: 10, waitlisted: 0, acceptanceRateBps: 4000, enrollmentRateBps: 6000, seats: 120, seatsLeft: 70 },
    byStatus: statuses.map((status) => ({ status, count: counts[status] })),
    campaigns: [
      {
        campaignId: aid(7001),
        institutionId: IDS.institution,
        yearId: IDS.year,
        code: "ADM-2026",
        label: "Campagne 2026-2027",
        status: "OPEN",
        seats: 120,
        seatsLeft: 70,
        applications: 130,
        stages: [
          { code: "DEPOSE", label: "Déposé", canonicalStatus: "SUBMITTED", ordinal: 1, isTerminal: false, applications: 40 },
          { code: "ETUDE", label: "En étude", canonicalStatus: "UNDER_REVIEW", ordinal: 2, isTerminal: false, applications: 25 },
          { code: "INSCRIT", label: "Inscrit", canonicalStatus: "ENROLLED", ordinal: 4, isTerminal: true, applications: 30 },
        ],
      },
    ],
    ...overrides,
  };
}

export function schoolLife(overrides: Partial<AnalyticsSchoolLifeData> = {}): AnalyticsSchoolLifeData {
  return {
    scopeConfidentiality: "STANDARD",
    institutionId: null,
    indicators: [
      { indicator: "OPEN_INCIDENTS", value: 7, measured: true },
      { indicator: "MEASURES_TO_VALIDATE", value: 2, measured: true },
      { indicator: "ACTIVE_EXCLUSIONS", value: 1, measured: true },
      { indicator: "CONVOCATIONS_TO_HOLD", value: 3, measured: true },
    ],
    ...overrides,
  };
}

export function comparison(domain: AnalyticsComparisonData["domain"] = "enrollment", overrides: Partial<AnalyticsComparisonData> = {}): AnalyticsComparisonData {
  const side = (label: string, demonstration = false) => ({ label, yearId: IDS.year, periodId: null, from: null, to: null, demonstration });
  return {
    domain,
    currency: domain === "finance" ? "XOF" : null,
    baseline: side("Année 2024-2025"),
    target: side("Année 2025-2026"),
    metrics:
      domain === "finance"
        ? [
            { key: "collected", unit: "AMOUNT", baseline: 38_000_000, target: 41_000_000, delta: 3_000_000, changeBps: 789 },
            { key: "collectionRateBps", unit: "BPS", baseline: null, target: 6949, delta: null, changeBps: null },
          ]
        : [
            { key: "inSchooling", unit: "COUNT", baseline: 400, target: 412, delta: 12, changeBps: 300 },
            { key: "repeaterRateBps", unit: "BPS", baseline: 800, target: 650, delta: -150, changeBps: -1875 },
            { key: "repeaters", unit: "COUNT", baseline: 0, target: 5, delta: 5, changeBps: null },
          ],
    ...overrides,
  };
}

const rule = (over: Record<string, unknown> = {}) => ({
  id: aid(8001),
  label: "Présence trop basse",
  metric: "ATTENDANCE_RATE",
  comparator: "BELOW",
  unit: "BPS",
  warningValue: 8500,
  criticalValue: 7000,
  windowDays: 30,
  institutionId: null,
  campusId: null,
  recipientRoles: ["directeur", "owner"],
  frequency: "DAILY",
  enabled: true,
  rowVersion: 1,
  lastEvaluatedAt: "2026-03-20T10:15:00.000Z",
  lastOutcome: "CRITICAL",
  lastValue: 6000,
  createdAt: "2026-03-01T08:00:00.000Z",
  updatedAt: "2026-03-01T08:00:00.000Z",
  ...over,
});

export function alertRules(rules: Array<Record<string, unknown>> = [rule(), rule({ id: aid(8002), label: "Impayés élevés", metric: "OVERDUE_AMOUNT", comparator: "ABOVE", unit: "AMOUNT", warningValue: 5_000_000, criticalValue: null, windowDays: null, recipientRoles: ["econome", "equipe_paie"], frequency: "WEEKLY", lastOutcome: "OK", lastValue: 3_000_000 })]): AnalyticsAlertRulesData {
  return { rules } as AnalyticsAlertRulesData;
}

export function alertMetrics(only?: string[]): AnalyticsAlertMetricsData {
  const all = [
    { metric: "ATTENDANCE_RATE", label: "Taux de présence des élèves", unit: "BPS", comparator: "BELOW", permission: "analytics.attendance.read", windowed: true, defaultWindowDays: 30, campusScoped: false },
    { metric: "COLLECTION_RATE", label: "Taux de recouvrement de la scolarité", unit: "BPS", comparator: "BELOW", permission: "analytics.finance.read", windowed: false, defaultWindowDays: null, campusScoped: true },
    { metric: "OVERDUE_AMOUNT", label: "Montant des impayés échus", unit: "AMOUNT", comparator: "ABOVE", permission: "analytics.finance.read", windowed: false, defaultWindowDays: null, campusScoped: true },
    { metric: "SCHOOLLIFE_OPEN_INCIDENTS", label: "Incidents de vie scolaire ouverts", unit: "COUNT", comparator: "ABOVE", permission: "analytics.schoollife.read", windowed: false, defaultWindowDays: null, campusScoped: false },
  ];
  return { metrics: all.filter((m) => !only || only.includes(m.metric)) } as AnalyticsAlertMetricsData;
}

const alert = (over: Record<string, unknown> = {}) => ({
  id: aid(9001),
  ruleId: aid(8001),
  ruleLabel: "Présence trop basse",
  metric: "ATTENDANCE_RATE",
  unit: "BPS",
  comparator: "BELOW",
  severity: "CRITICAL",
  status: "OPEN",
  value: 6000,
  threshold: 7000,
  currency: null,
  institutionId: null,
  campusId: null,
  raisedAt: "2026-03-18T07:30:00.000Z",
  lastSeenAt: "2026-03-20T07:30:00.000Z",
  asOf: "2026-03-20T07:29:00.000Z",
  notifyCount: 3,
  lastNotifiedAt: "2026-03-20T07:30:00.000Z",
  acknowledgedAt: null,
  acknowledgementNote: null,
  resolvedAt: null,
  resolvedValue: null,
  ...over,
});

export function alertsData(alerts: Array<Record<string, unknown>> = [alert(), alert({ id: aid(9002), ruleId: aid(8002), ruleLabel: "Impayés élevés", metric: "OVERDUE_AMOUNT", unit: "AMOUNT", comparator: "ABOVE", severity: "WARNING", status: "ACKNOWLEDGED", value: 6_200_000, threshold: 5_000_000, currency: "XOF", acknowledgedAt: "2026-03-19T09:00:00.000Z", acknowledgementNote: "Relance en cours", notifyCount: 1 }), alert({ id: aid(9003), status: "RESOLVED", severity: "WARNING", value: 8400, threshold: 8500, resolvedAt: "2026-03-10T08:00:00.000Z", resolvedValue: 9100, raisedAt: "2026-03-05T07:30:00.000Z" })]): AnalyticsAlertsData {
  const count = (s: string) => alerts.filter((a) => a.status === s).length;
  return { total: alerts.length, counts: { open: count("OPEN"), acknowledged: count("ACKNOWLEDGED"), resolved: count("RESOLVED") }, alerts } as AnalyticsAlertsData;
}

export function alertDetail(over: Record<string, unknown> = {}): AnalyticsAlertDetail {
  return {
    ...alert(),
    notifications: [
      { id: aid(9101), reason: "RAISED", severity: "CRITICAL", value: 6200, recipientRoles: ["directeur", "owner"], emittedAt: "2026-03-18T07:30:00.000Z" },
      { id: aid(9102), reason: "REMINDER", severity: "CRITICAL", value: 6000, recipientRoles: ["directeur", "owner"], emittedAt: "2026-03-19T07:30:00.000Z" },
    ],
    ...over,
  } as AnalyticsAlertDetail;
}
