/**
 * Enregistrements du domaine -> DTO des contrats (`packages/contracts/src/v2/stateassign.ts`).
 * Montants : `{ amount: entier, currency }` ; instants : ISO 8601 ; dates civiles : `YYYY-MM-DD`.
 */
import type { Money } from "@ecoledigitale/kernel";
import type {
  AssignmentDocumentDto,
  AssignmentDto,
  ControlDto,
  ExportFormatDto,
  ReceivableDto,
  StateassignMoney,
  StateassignSettingsDto,
} from "@ecoledigitale/contracts/src/v2/stateassign";
import { billedFrom } from "../domain/assignment";
import { controlOverdue } from "../domain/controls";
import { viewReceivable } from "../domain/reconciliation";
import type { AssignmentEventRecord, AssignmentRecord, ControlRecord, DocumentRecord, ExportFormatRecord, IsoDate, ReceivableEventRecord, ReceivableRecord, SettingsRecord } from "../domain/types";

export const moneyDto = (m: Money): StateassignMoney => ({ amount: m.amount, currency: m.currency });
export const moneyDtoOrNull = (m: Money | null): StateassignMoney | null => (m ? moneyDto(m) : null);
const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function assignmentDto(a: AssignmentRecord, studentName: string | null): AssignmentDto {
  return {
    id: a.id,
    institutionId: a.institutionId,
    academicYearId: a.academicYearId,
    enrollmentId: a.enrollmentId,
    studentId: a.studentId,
    studentName,
    version: a.version,
    supersedesId: a.supersedesId,
    reference: a.reference,
    issuedOn: a.issuedOn,
    issuingAuthority: a.issuingAuthority,
    source: a.source,
    externalRef: a.externalRef,
    declaredState: moneyDtoOrNull(a.declaredState),
    declaredParent: moneyDtoOrNull(a.declaredParent),
    status: a.status,
    receivedBy: a.receivedBy,
    receivedAt: iso(a.receivedAt),
    verifiedBy: a.verifiedBy,
    verifiedAt: isoOrNull(a.verifiedAt),
    verificationNote: a.verificationNote,
    activatedAt: isoOrNull(a.activatedAt),
    suspendedAt: isoOrNull(a.suspendedAt),
    suspensionReason: a.suspensionReason,
    endedOn: a.endedOn,
    endReason: a.endReason,
    rejectionReason: a.rejectionReason,
    finance: { scholarshipId: a.scholarshipId, stateInvoiceId: a.stateInvoiceId, parentInvoiceId: a.parentInvoiceId },
    reconciliation: {
      status: a.reconciliationStatus,
      lastReconciledAt: isoOrNull(a.lastReconciledAt),
      stateDelta: moneyDtoOrNull(a.stateDelta),
      parentDelta: moneyDtoOrNull(a.parentDelta),
      stateBilled: moneyDtoOrNull(billedFrom(a.declaredState, a.stateDelta, a.currency)),
      parentBilled: moneyDtoOrNull(billedFrom(a.declaredParent, a.parentDelta, a.currency)),
    },
    notes: a.notes,
    rowVersion: a.rowVersion,
    createdAt: iso(a.createdAt),
  };
}

export function assignmentEventDto(e: AssignmentEventRecord) {
  return {
    id: e.id,
    assignmentId: e.assignmentId,
    action: e.action,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    actorId: e.actorId,
    actorKind: e.actorKind,
    reason: e.reason,
    data: e.data,
    occurredAt: iso(e.occurredAt),
  };
}

export function controlDto(c: ControlRecord, today: IsoDate): ControlDto {
  return {
    id: c.id,
    assignmentId: c.assignmentId,
    kind: c.kind,
    academicPeriodId: c.academicPeriodId,
    dueOn: c.dueOn,
    status: c.status,
    performedBy: c.performedBy,
    performedAt: isoOrNull(c.performedAt),
    findings: c.findings,
    evidence: c.evidence,
    anomalyResolution: c.anomalyResolution,
    anomalyResolvedAt: isoOrNull(c.anomalyResolvedAt),
    overdue: controlOverdue(c, today),
    createdAt: iso(c.createdAt),
  };
}

export function documentDto(d: DocumentRecord): AssignmentDocumentDto {
  return {
    id: d.id,
    assignmentId: d.assignmentId,
    kind: d.kind,
    documentRef: d.documentRef,
    label: d.label,
    receivedOn: d.receivedOn,
    addedBy: d.addedBy,
    status: d.status,
    withdrawnBy: d.withdrawnBy,
    withdrawnAt: isoOrNull(d.withdrawnAt),
    withdrawnReason: d.withdrawnReason,
    createdAt: iso(d.createdAt),
  };
}

export function receivableDto(r: ReceivableRecord, ctx: { asOf: IsoDate; graceDays: number; studentName: string | null; assignmentReference: string | null }): ReceivableDto {
  const v = viewReceivable(r, ctx.asOf, ctx.graceDays);
  return {
    id: r.id,
    assignmentId: r.assignmentId,
    institutionId: r.institutionId,
    academicYearId: r.academicYearId,
    enrollmentId: r.enrollmentId,
    studentId: r.studentId,
    studentName: ctx.studentName,
    assignmentReference: ctx.assignmentReference,
    seq: r.seq,
    label: r.label,
    dueOn: r.dueOn,
    expected: moneyDto(r.expected),
    received: moneyDto(r.received),
    outstanding: moneyDto(v.outstanding),
    status: r.status,
    daysOverdue: v.daysOverdue,
    overdue: v.overdue,
    agingBucket: v.agingBucket,
    lastReconciledAt: isoOrNull(r.lastReconciledAt),
    overdueFlaggedAt: isoOrNull(r.overdueFlaggedAt),
    cancelReason: r.cancelReason,
    createdAt: iso(r.createdAt),
  };
}

export function receivableEventDto(e: ReceivableEventRecord) {
  return {
    id: e.id,
    receivableId: e.receivableId,
    action: e.action,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    fromAmount: moneyDtoOrNull(e.fromAmount),
    toAmount: moneyDtoOrNull(e.toAmount),
    actorId: e.actorId,
    actorKind: e.actorKind,
    reason: e.reason,
    data: e.data,
    occurredAt: iso(e.occurredAt),
  };
}

export function settingsDto(s: SettingsRecord): StateassignSettingsDto {
  return {
    institutionId: s.institutionId,
    isDefault: s.isDefault,
    requireSeparateVerifier: s.requireSeparateVerifier,
    reconciliationTolerance: s.reconciliationTolerance,
    requiredControlKinds: [...s.requiredControlKinds],
    controlDueOffsetDays: s.controlDueOffsetDays,
    receivableGraceDays: s.receivableGraceDays,
    updatedAt: isoOrNull(s.updatedAt),
  };
}

export function exportFormatDto(f: ExportFormatRecord): ExportFormatDto {
  return {
    id: f.id,
    institutionId: f.institutionId,
    code: f.code,
    label: f.label,
    dataset: f.dataset,
    columns: f.columns.map((c) => ({ key: c.key, header: c.header })),
    delimiter: f.delimiter,
    includeBom: f.includeBom,
    active: f.active,
    updatedAt: iso(f.updatedAt),
  };
}
