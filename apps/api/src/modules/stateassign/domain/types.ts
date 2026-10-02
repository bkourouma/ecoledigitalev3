/**
 * Types du domaine stateassign : enregistrements lus en base (montants en `Money`, jamais un flottant) et alias des
 * énumérations des contrats (une seule source pour l'API et le web).
 */
import type { Money } from "@ecoledigitale/kernel";
import type {
  AssignmentDocumentKind,
  AssignmentSource,
  AssignmentStatus,
  ControlKind,
  ControlStatus,
  ExportDataset,
  ReceivableStatus,
  ReconciliationStatus,
} from "@ecoledigitale/contracts/src/v2/stateassign";

export type {
  AssignmentDocumentKind,
  AssignmentSource,
  AssignmentStatus,
  ControlKind,
  ControlStatus,
  ExportDataset,
  ReceivableStatus,
  ReconciliationStatus,
};

export type Uuid = string;
/** Date civile `YYYY-MM-DD`. */
export type IsoDate = string;
export type ActorKind = "user" | "system" | "superAdmin";

export interface SettingsRecord {
  readonly institutionId: Uuid;
  /** Aucune ligne enregistrée : valeurs prudentes. */
  readonly isDefault: boolean;
  readonly requireSeparateVerifier: boolean;
  /** Entier (unités mineures) ; 0 par défaut. */
  readonly reconciliationTolerance: number;
  readonly requiredControlKinds: readonly ControlKind[];
  readonly controlDueOffsetDays: number | null;
  readonly receivableGraceDays: number;
  readonly updatedAt: Date | null;
}

export const DEFAULT_SETTINGS = (institutionId: Uuid): SettingsRecord =>
  Object.freeze({
    institutionId,
    isDefault: true,
    requireSeparateVerifier: true,
    reconciliationTolerance: 0,
    requiredControlKinds: Object.freeze([]) as readonly ControlKind[],
    controlDueOffsetDays: null,
    receivableGraceDays: 0,
    updatedAt: null,
  });

export interface AssignmentRecord {
  readonly id: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly version: number;
  readonly supersedesId: Uuid | null;
  readonly reference: string;
  readonly issuedOn: IsoDate | null;
  readonly issuingAuthority: string | null;
  readonly source: AssignmentSource;
  readonly externalRef: string | null;
  readonly externalPayloadHash: string | null;
  readonly declaredState: Money | null;
  readonly declaredParent: Money | null;
  readonly currency: string;
  readonly status: AssignmentStatus;
  readonly receivedBy: Uuid | null;
  readonly receivedAt: Date;
  readonly verifiedBy: Uuid | null;
  readonly verifiedAt: Date | null;
  readonly verificationNote: string | null;
  readonly activatedAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly suspensionReason: string | null;
  readonly endedOn: IsoDate | null;
  readonly endReason: string | null;
  readonly rejectionReason: string | null;
  readonly scholarshipId: Uuid | null;
  readonly stateInvoiceId: Uuid | null;
  readonly parentInvoiceId: Uuid | null;
  readonly reconciliationStatus: ReconciliationStatus;
  readonly lastReconciledAt: Date | null;
  /** facturé − déclaré. */
  readonly stateDelta: Money | null;
  readonly parentDelta: Money | null;
  readonly notes: string | null;
  readonly rowVersion: number;
  readonly createdAt: Date;
}

export interface AssignmentEventRecord {
  readonly id: Uuid;
  readonly assignmentId: Uuid;
  readonly action: "CREATED" | "STATUS_CHANGED" | "RECONCILED" | "LINKED";
  readonly fromStatus: AssignmentStatus | null;
  readonly toStatus: AssignmentStatus | null;
  readonly actorId: Uuid | null;
  readonly actorKind: ActorKind | null;
  readonly reason: string | null;
  readonly data: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface ControlRecord {
  readonly id: Uuid;
  readonly assignmentId: Uuid;
  readonly kind: ControlKind;
  readonly academicPeriodId: Uuid | null;
  readonly dueOn: IsoDate;
  readonly status: ControlStatus;
  readonly performedBy: Uuid | null;
  readonly performedAt: Date | null;
  readonly findings: string | null;
  readonly evidence: Record<string, unknown>;
  readonly anomalyResolution: string | null;
  readonly anomalyResolvedAt: Date | null;
  readonly dueNotifiedAt: Date | null;
  readonly createdAt: Date;
}

export interface DocumentRecord {
  readonly id: Uuid;
  readonly assignmentId: Uuid;
  readonly kind: AssignmentDocumentKind;
  readonly documentRef: Uuid;
  readonly label: string | null;
  readonly receivedOn: IsoDate | null;
  readonly addedBy: Uuid;
  readonly status: "ACTIVE" | "WITHDRAWN";
  readonly withdrawnBy: Uuid | null;
  readonly withdrawnAt: Date | null;
  readonly withdrawnReason: string | null;
  readonly createdAt: Date;
}

export interface ReceivableRecord {
  readonly id: Uuid;
  readonly assignmentId: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly seq: number;
  readonly label: string;
  readonly dueOn: IsoDate;
  readonly expected: Money;
  readonly received: Money;
  readonly status: ReceivableStatus;
  readonly lastReconciledAt: Date | null;
  readonly overdueFlaggedAt: Date | null;
  readonly cancelReason: string | null;
  readonly rowVersion: number;
  readonly createdAt: Date;
}

export interface ReceivableEventRecord {
  readonly id: Uuid;
  readonly receivableId: Uuid;
  readonly action: "CREATED" | "RESCHEDULED" | "AMOUNT_CHANGED" | "RECEIVED_UPDATED" | "STATUS_CHANGED" | "OVERDUE_FLAGGED" | "CANCELLED";
  readonly fromStatus: ReceivableStatus | null;
  readonly toStatus: ReceivableStatus | null;
  readonly fromAmount: Money | null;
  readonly toAmount: Money | null;
  readonly actorId: Uuid | null;
  readonly actorKind: ActorKind | null;
  readonly reason: string | null;
  readonly data: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface ExportFormatRecord {
  readonly id: Uuid;
  readonly institutionId: Uuid;
  readonly code: string;
  readonly label: string;
  readonly dataset: ExportDataset;
  readonly columns: ReadonlyArray<{ readonly key: string; readonly header: string }>;
  readonly delimiter: ";" | "," | "\t";
  readonly includeBom: boolean;
  readonly active: boolean;
  readonly updatedAt: Date;
}
