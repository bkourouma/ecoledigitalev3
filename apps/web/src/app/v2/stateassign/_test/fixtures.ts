/**
 * Fabriques de test conformes aux contrats du module `stateassign` (validées par les schémas dans les tests : aucune dérive).
 */
import type {
  AssignmentDetailDto,
  AssignmentDocumentDto,
  AssignmentDto,
  ChildAssignmentDto,
  ControlDto,
  ExportCatalogResponse,
  ExportFormatDto,
  ReceivableDto,
  ReceivablesAgingResponse,
  ReconciliationReportResponse,
  StateassignMoney,
  StateassignSettingsDto,
  StateassignSummaryResponse,
} from "@ecoledigitale/contracts/v2/stateassign";

export const NOW = "2026-10-02T09:00:00.000Z";
export const uuid = (n: number): string => `0192f0a4-7b1e-7c3a-8d2e-${String(n).padStart(12, "0")}`;

export const IDS = {
  institution: uuid(1),
  year: uuid(2),
  assignment: uuid(10),
  assignment2: uuid(11),
  v1: uuid(12),
  enrollment: uuid(20),
  student: uuid(30),
  student2: uuid(31),
  user: uuid(40),
  receivable: uuid(50),
  control: uuid(60),
  document: uuid(70),
  documentRef: uuid(71),
  format: uuid(80),
  period: uuid(90),
};

export const xof = (amount: number): StateassignMoney => ({ amount, currency: "XOF" });

export function assignment(over: Partial<AssignmentDto> = {}): AssignmentDto {
  return {
    id: IDS.assignment,
    institutionId: IDS.institution,
    academicYearId: IDS.year,
    enrollmentId: IDS.enrollment,
    studentId: IDS.student,
    studentName: "KOUASSI Awa",
    version: 1,
    supersedesId: null,
    reference: "AFF-2026-001",
    issuedOn: "2026-09-15",
    issuingAuthority: "Direction régionale",
    source: "MANUAL",
    externalRef: null,
    declaredState: xof(400000),
    declaredParent: xof(100000),
    status: "RECEIVED",
    receivedBy: IDS.user,
    receivedAt: NOW,
    verifiedBy: null,
    verifiedAt: null,
    verificationNote: null,
    activatedAt: null,
    suspendedAt: null,
    suspensionReason: null,
    endedOn: null,
    endReason: null,
    rejectionReason: null,
    finance: { scholarshipId: null, stateInvoiceId: null, parentInvoiceId: null },
    reconciliation: { status: "NEVER", lastReconciledAt: null, stateDelta: null, parentDelta: null, stateBilled: null, parentBilled: null },
    notes: null,
    rowVersion: 3,
    createdAt: NOW,
    ...over,
  };
}

export function receivable(over: Partial<ReceivableDto> = {}): ReceivableDto {
  return {
    id: IDS.receivable,
    assignmentId: IDS.assignment,
    institutionId: IDS.institution,
    academicYearId: IDS.year,
    enrollmentId: IDS.enrollment,
    studentId: IDS.student,
    studentName: "KOUASSI Awa",
    assignmentReference: "AFF-2026-001",
    seq: 1,
    label: "1er versement",
    dueOn: "2026-11-15",
    expected: xof(150000),
    received: xof(0),
    outstanding: xof(150000),
    status: "OPEN",
    daysOverdue: 0,
    overdue: false,
    agingBucket: "NOT_DUE",
    lastReconciledAt: null,
    overdueFlaggedAt: null,
    cancelReason: null,
    rowVersion: 2,
    createdAt: NOW,
    ...over,
  };
}

export function control(over: Partial<ControlDto> = {}): ControlDto {
  return {
    id: IDS.control,
    assignmentId: IDS.assignment,
    kind: "IDENTITY",
    academicPeriodId: null,
    dueOn: "2026-12-01",
    status: "PENDING",
    performedBy: null,
    performedAt: null,
    findings: null,
    evidence: {},
    anomalyResolution: null,
    anomalyResolvedAt: null,
    overdue: false,
    createdAt: NOW,
    ...over,
  };
}

export function assignmentDocument(over: Partial<AssignmentDocumentDto> = {}): AssignmentDocumentDto {
  return {
    id: IDS.document,
    assignmentId: IDS.assignment,
    kind: "ASSIGNMENT_ORDER",
    documentRef: IDS.documentRef,
    label: "Acte d'affectation",
    receivedOn: "2026-09-20",
    addedBy: IDS.user,
    status: "ACTIVE",
    withdrawnBy: null,
    withdrawnAt: null,
    withdrawnReason: null,
    createdAt: NOW,
    ...over,
  };
}

export function detail(over: Partial<AssignmentDetailDto> = {}, assignmentOver: Partial<AssignmentDto> = {}): AssignmentDetailDto {
  const a = assignment(assignmentOver);
  return {
    assignment: a,
    versions: [{ id: a.id, version: a.version, status: a.status, reference: a.reference, declaredState: a.declaredState, declaredParent: a.declaredParent, issuedOn: a.issuedOn, endedOn: null, endReason: null, receivedAt: NOW, verifiedAt: a.verifiedAt }],
    controls: [],
    documents: [],
    events: [{ id: uuid(100), assignmentId: a.id, action: "CREATED", fromStatus: null, toStatus: "RECEIVED", actorId: IDS.user, actorKind: "user", reason: null, data: {}, occurredAt: NOW }],
    receivables: [],
    receivablesSummary: { expected: xof(0), received: xof(0), outstanding: xof(0), overdue: xof(0), unscheduled: xof(400000) },
    enrollment: { fundingType: "PRIVATE", assignmentReference: null, status: "ACTIVE", referenceMatchesAssignment: false },
    ...over,
  };
}

export function settings(over: Partial<StateassignSettingsDto> = {}): StateassignSettingsDto {
  return { institutionId: IDS.institution, isDefault: true, requireSeparateVerifier: true, reconciliationTolerance: 0, requiredControlKinds: [], controlDueOffsetDays: null, receivableGraceDays: 0, updatedAt: null, ...over };
}

export function summary(over: Partial<StateassignSummaryResponse> = {}): StateassignSummaryResponse {
  return {
    asOf: "2026-10-02",
    currency: "XOF",
    assignmentsByStatus: { ACTIVE: 3, RECEIVED: 1 },
    declaredState: xof(1_200_000),
    declaredParent: xof(300_000),
    receivables: { expected: xof(900_000), received: xof(300_000), outstanding: xof(600_000), overdue: xof(150_000) },
    controls: { pending: 4, overdue: 1, anomalies: 2 },
    reconciliation: { never: 1, balanced: 1, discrepancy: 1 },
    ...over,
  };
}

export function aging(over: Partial<ReceivablesAgingResponse> = {}): ReceivablesAgingResponse {
  return {
    asOf: "2026-10-02",
    currency: "XOF",
    buckets: [
      { bucket: "NOT_DUE", count: 1, outstanding: xof(100000) },
      { bucket: "D1_30", count: 1, outstanding: xof(100000) },
      { bucket: "D31_60", count: 0, outstanding: xof(0) },
      { bucket: "D61_90", count: 0, outstanding: xof(0) },
      { bucket: "D91_PLUS", count: 1, outstanding: xof(50000) },
    ],
    totals: { expected: xof(300000), received: xof(50000), outstanding: xof(250000), overdue: xof(150000), receivables: 3, overdueReceivables: 2 },
    ...over,
  };
}

export function reconciliationReport(over: Partial<ReconciliationReportResponse> = {}): ReconciliationReportResponse {
  const a = assignment({
    status: "ACTIVE",
    reconciliation: { status: "DISCREPANCY", lastReconciledAt: NOW, stateDelta: xof(-100000), parentDelta: xof(0), stateBilled: xof(300000), parentBilled: xof(100000) },
  });
  return { items: [a], total: 1, page: 1, pageSize: 30, counts: { never: 1, balanced: 2, discrepancy: 1 }, ...over };
}

export function format(over: Partial<ExportFormatDto> = {}): ExportFormatDto {
  return { id: IDS.format, institutionId: IDS.institution, code: "etat-admin", label: "État pour l'administration", dataset: "ASSIGNMENTS", columns: [{ key: "reference", header: "N° d'acte" }], delimiter: ";", includeBom: true, active: true, updatedAt: NOW, ...over };
}

export function catalog(): ExportCatalogResponse {
  const col = (key: string, label: string) => ({ key, label });
  const std = (cols: Array<{ key: string; label: string }>) => cols.map((c) => ({ key: c.key, header: c.label }));
  const a = [col("reference", "Référence d'affectation"), col("studentName", "Élève"), col("declaredStateAmount", "Part de l'État déclarée")];
  const r = [col("assignmentReference", "Référence d'affectation"), col("dueOn", "Échéance")];
  const c = [col("kind", "Nature du contrôle"), col("status", "Statut")];
  return {
    datasets: [
      { dataset: "ASSIGNMENTS", label: "Dossiers d'affectation", columns: a, standardColumns: std(a) },
      { dataset: "RECEIVABLES", label: "Créances sur l'État (échéances)", columns: r, standardColumns: std(r) },
      { dataset: "CONTROLS", label: "Contrôles", columns: c, standardColumns: std(c) },
    ],
  };
}

export function child(over: Partial<ChildAssignmentDto> = {}): ChildAssignmentDto {
  return { studentId: IDS.student, hasAssignment: true, status: "VERIFIED", verified: true, reference: "AFF-2026-001", issuedOn: "2026-09-15", academicYearId: IDS.year, ...over };
}
