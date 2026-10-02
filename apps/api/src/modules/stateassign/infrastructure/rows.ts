/**
 * Colonnes et conversions ligne SQL -> enregistrement du domaine.
 * Les `bigint` reviennent en chaîne (`::text`) et deviennent des `Money` ; les dates civiles sont lues avec `to_char`
 * (le type `date` de `pg` serait un `Date` à minuit local : jamais de décalage de fuseau).
 */
import { Money, type CurrencyCode } from "@ecoledigitale/kernel";
import type {
  ActorKind,
  AssignmentEventRecord,
  AssignmentRecord,
  AssignmentStatus,
  ControlRecord,
  DocumentRecord,
  ExportFormatRecord,
  ReceivableEventRecord,
  ReceivableRecord,
  SettingsRecord,
} from "../domain/types";

type Row = Record<string, any>;

const moneyOrNull = (text: string | null | undefined, currency: string): Money | null =>
  text === null || text === undefined ? null : Money.fromString(text, currency as CurrencyCode);

export const ASSIGNMENT_COLS = `id, institution_id AS "institutionId", academic_year_id AS "academicYearId", enrollment_id AS "enrollmentId",
  student_id AS "studentId", version, supersedes_id AS "supersedesId", assignment_reference AS reference,
  to_char(issued_on, 'YYYY-MM-DD') AS "issuedOn", issuing_authority AS "issuingAuthority", source, external_ref AS "externalRef",
  external_payload_hash AS "externalPayloadHash", declared_state_amount::text AS "declaredState",
  declared_parent_amount::text AS "declaredParent", currency, status, received_by AS "receivedBy", received_at AS "receivedAt",
  verified_by AS "verifiedBy", verified_at AS "verifiedAt", verification_note AS "verificationNote", activated_at AS "activatedAt",
  suspended_at AS "suspendedAt", suspension_reason AS "suspensionReason", to_char(ended_on, 'YYYY-MM-DD') AS "endedOn",
  end_reason AS "endReason", rejection_reason AS "rejectionReason", finance_scholarship_id AS "scholarshipId",
  finance_state_invoice_id AS "stateInvoiceId", finance_parent_invoice_id AS "parentInvoiceId",
  reconciliation_status AS "reconciliationStatus", last_reconciled_at AS "lastReconciledAt",
  reconciled_state_delta::text AS "stateDelta", reconciled_parent_delta::text AS "parentDelta", notes,
  row_version AS "rowVersion", created_at AS "createdAt"`;

export const assignmentOf = (r: Row): AssignmentRecord => ({
  id: r.id,
  institutionId: r.institutionId,
  academicYearId: r.academicYearId,
  enrollmentId: r.enrollmentId,
  studentId: r.studentId,
  version: r.version,
  supersedesId: r.supersedesId,
  reference: r.reference,
  issuedOn: r.issuedOn,
  issuingAuthority: r.issuingAuthority,
  source: r.source,
  externalRef: r.externalRef,
  externalPayloadHash: r.externalPayloadHash,
  declaredState: moneyOrNull(r.declaredState, r.currency),
  declaredParent: moneyOrNull(r.declaredParent, r.currency),
  currency: r.currency,
  status: r.status as AssignmentStatus,
  receivedBy: r.receivedBy,
  receivedAt: r.receivedAt,
  verifiedBy: r.verifiedBy,
  verifiedAt: r.verifiedAt,
  verificationNote: r.verificationNote,
  activatedAt: r.activatedAt,
  suspendedAt: r.suspendedAt,
  suspensionReason: r.suspensionReason,
  endedOn: r.endedOn,
  endReason: r.endReason,
  rejectionReason: r.rejectionReason,
  scholarshipId: r.scholarshipId,
  stateInvoiceId: r.stateInvoiceId,
  parentInvoiceId: r.parentInvoiceId,
  reconciliationStatus: r.reconciliationStatus,
  lastReconciledAt: r.lastReconciledAt,
  stateDelta: moneyOrNull(r.stateDelta, r.currency),
  parentDelta: moneyOrNull(r.parentDelta, r.currency),
  notes: r.notes,
  rowVersion: r.rowVersion,
  createdAt: r.createdAt,
});

export const ASSIGNMENT_EVENT_COLS = `id, assignment_id AS "assignmentId", action, from_status AS "fromStatus", to_status AS "toStatus",
  actor_id AS "actorId", actor_kind AS "actorKind", reason, data, occurred_at AS "occurredAt"`;

export const assignmentEventOf = (r: Row): AssignmentEventRecord => ({
  id: r.id,
  assignmentId: r.assignmentId,
  action: r.action,
  fromStatus: r.fromStatus,
  toStatus: r.toStatus,
  actorId: r.actorId,
  actorKind: r.actorKind as ActorKind | null,
  reason: r.reason,
  data: (r.data ?? {}) as Record<string, unknown>,
  occurredAt: r.occurredAt,
});

export const controlCols = (p = ""): string => `${p}id, ${p}assignment_id AS "assignmentId", ${p}kind, ${p}academic_period_id AS "academicPeriodId",
  to_char(${p}due_on, 'YYYY-MM-DD') AS "dueOn", ${p}status, ${p}performed_by AS "performedBy", ${p}performed_at AS "performedAt", ${p}findings, ${p}evidence,
  ${p}anomaly_resolution AS "anomalyResolution", ${p}anomaly_resolved_at AS "anomalyResolvedAt", ${p}due_notified_at AS "dueNotifiedAt",
  ${p}created_at AS "createdAt"`;

export const CONTROL_COLS = controlCols();

export const controlOf = (r: Row): ControlRecord => ({
  id: r.id,
  assignmentId: r.assignmentId,
  kind: r.kind,
  academicPeriodId: r.academicPeriodId,
  dueOn: r.dueOn,
  status: r.status,
  performedBy: r.performedBy,
  performedAt: r.performedAt,
  findings: r.findings,
  evidence: (r.evidence ?? {}) as Record<string, unknown>,
  anomalyResolution: r.anomalyResolution,
  anomalyResolvedAt: r.anomalyResolvedAt,
  dueNotifiedAt: r.dueNotifiedAt,
  createdAt: r.createdAt,
});

export const DOCUMENT_COLS = `id, assignment_id AS "assignmentId", kind, document_ref AS "documentRef", label,
  to_char(received_on, 'YYYY-MM-DD') AS "receivedOn", added_by AS "addedBy", status, withdrawn_by AS "withdrawnBy",
  withdrawn_at AS "withdrawnAt", withdrawn_reason AS "withdrawnReason", created_at AS "createdAt"`;

export const documentOf = (r: Row): DocumentRecord => ({ ...(r as DocumentRecord) });

export const RECEIVABLE_COLS = `r.id, r.assignment_id AS "assignmentId", r.institution_id AS "institutionId", r.academic_year_id AS "academicYearId",
  r.enrollment_id AS "enrollmentId", r.student_id AS "studentId", r.seq, r.label, to_char(r.due_on, 'YYYY-MM-DD') AS "dueOn",
  r.expected_amount::text AS expected, r.received_amount::text AS received, r.currency, r.status,
  r.last_reconciled_at AS "lastReconciledAt", r.overdue_flagged_at AS "overdueFlaggedAt", r.cancel_reason AS "cancelReason",
  r.row_version AS "rowVersion", r.created_at AS "createdAt"`;

export const receivableOf = (r: Row): ReceivableRecord => ({
  id: r.id,
  assignmentId: r.assignmentId,
  institutionId: r.institutionId,
  academicYearId: r.academicYearId,
  enrollmentId: r.enrollmentId,
  studentId: r.studentId,
  seq: r.seq,
  label: r.label,
  dueOn: r.dueOn,
  expected: Money.fromString(r.expected, r.currency as CurrencyCode),
  received: Money.fromString(r.received, r.currency as CurrencyCode),
  status: r.status,
  lastReconciledAt: r.lastReconciledAt,
  overdueFlaggedAt: r.overdueFlaggedAt,
  cancelReason: r.cancelReason,
  rowVersion: r.rowVersion,
  createdAt: r.createdAt,
});

export const RECEIVABLE_EVENT_COLS = `e.id, e.receivable_id AS "receivableId", e.action, e.from_status AS "fromStatus", e.to_status AS "toStatus",
  e.from_amount::text AS "fromAmount", e.to_amount::text AS "toAmount", e.actor_id AS "actorId", e.actor_kind AS "actorKind",
  e.reason, e.data, e.occurred_at AS "occurredAt"`;

export const receivableEventOf = (r: Row, currency: string): ReceivableEventRecord => ({
  id: r.id,
  receivableId: r.receivableId,
  action: r.action,
  fromStatus: r.fromStatus,
  toStatus: r.toStatus,
  fromAmount: moneyOrNull(r.fromAmount, currency),
  toAmount: moneyOrNull(r.toAmount, currency),
  actorId: r.actorId,
  actorKind: r.actorKind as ActorKind | null,
  reason: r.reason,
  data: (r.data ?? {}) as Record<string, unknown>,
  occurredAt: r.occurredAt,
});

export const SETTINGS_COLS = `institution_id AS "institutionId", require_separate_verifier AS "requireSeparateVerifier",
  reconciliation_tolerance::text AS "reconciliationTolerance", required_control_kinds AS "requiredControlKinds",
  control_due_offset_days AS "controlDueOffsetDays", receivable_grace_days AS "receivableGraceDays", updated_at AS "updatedAt"`;

export const settingsOf = (r: Row): SettingsRecord => ({
  institutionId: r.institutionId,
  isDefault: false,
  requireSeparateVerifier: r.requireSeparateVerifier,
  reconciliationTolerance: Number(r.reconciliationTolerance),
  requiredControlKinds: r.requiredControlKinds,
  controlDueOffsetDays: r.controlDueOffsetDays,
  receivableGraceDays: r.receivableGraceDays,
  updatedAt: r.updatedAt,
});

export const EXPORT_FORMAT_COLS = `id, institution_id AS "institutionId", code, label, dataset, columns, delimiter, include_bom AS "includeBom",
  active, updated_at AS "updatedAt"`;

export const exportFormatOf = (r: Row): ExportFormatRecord => ({
  id: r.id,
  institutionId: r.institutionId,
  code: r.code,
  label: r.label,
  dataset: r.dataset,
  columns: r.columns as ExportFormatRecord["columns"],
  delimiter: r.delimiter,
  includeBom: r.includeBom,
  active: r.active,
  updatedAt: r.updatedAt,
});
