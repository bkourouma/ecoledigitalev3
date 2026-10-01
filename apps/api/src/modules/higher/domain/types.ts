/**
 * Types du domaine du module higher (spec v2/019). Aucun import de `pg`, `fastify` ni d'infrastructure.
 *
 * Conventions : UUID en `string` ; dates calendaires `AAAA-MM-JJ` ; instants en `Date` ; moyennes EXACTES en chaîne
 * décimale (jamais converties en flottant) ; crédits en `number` à deux décimales (sommes via `domain/credits.ts`).
 */

export type Uuid = string;
export type IsoDate = string;
/** Chaîne décimale exacte (`"12.375"`). */
export type DecimalString = string;

export const LEDGER_STATUSES = ["ACQUIRED", "REVOKED", "EXPIRED"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

export const ACQUIRED_VIA = ["DIRECT", "RESIT", "JURY_OVERRIDE", "TRANSFER", "EXEMPTION"] as const;
export type AcquiredVia = (typeof ACQUIRED_VIA)[number];

/** États d'UE rendus par la règle `etat_ue` (contrat `credit-semester@1`). */
export const UE_STATES = ["VALIDATED", "RESIT", "DEBT"] as const;
export type UeState = (typeof UE_STATES)[number];

export interface LedgerEntry {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly studentId: Uuid;
  readonly enrollmentId: Uuid;
  readonly ueNodeId: Uuid;
  readonly academicYearId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly credits: number;
  readonly averageExact: DecimalString | null;
  readonly acquiredVia: AcquiredVia;
  readonly sessionObtained: 1 | 2;
  readonly status: LedgerStatus;
  readonly compensatedEcueCount: number;
  readonly overrideId: Uuid | null;
  readonly sourceResultId: Uuid;
  readonly sourceResultsVersion: number;
  readonly validUntil: IsoDate | null;
  readonly acquiredAt: Date;
  readonly revokedAt: Date | null;
  readonly revokeReason: string | null;
  readonly expiredAt: Date | null;
}

export interface UeDebt {
  readonly id: Uuid;
  readonly studentId: Uuid;
  readonly enrollmentId: Uuid;
  readonly ueNodeId: Uuid;
  readonly academicYearId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly status: "OPEN" | "CLEARED";
  readonly detectedAt: Date;
  readonly clearedAt: Date | null;
}

export const PREREQUISITE_MODES = ["VALIDATED", "ATTENDED", "MIN_AVERAGE"] as const;
export type PrerequisiteMode = (typeof PREREQUISITE_MODES)[number];

export interface Prerequisite {
  readonly id: Uuid;
  readonly ueNodeId: Uuid;
  readonly prerequisiteNodeId: Uuid;
  readonly mode: PrerequisiteMode;
  readonly minAverage: DecimalString | null;
}

export interface MissingPrerequisite {
  readonly prerequisiteNodeId: Uuid;
  readonly mode: PrerequisiteMode;
  readonly minAverage: DecimalString | null;
  /** Pourquoi il n'est pas satisfait. */
  readonly reason: "NOT_ACQUIRED" | "NOT_ATTENDED" | "AVERAGE_TOO_LOW";
}

export interface PrerequisiteCheck {
  readonly satisfied: boolean;
  readonly missing: readonly MissingPrerequisite[];
}

export const DIPLOMA_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type DiplomaStatus = (typeof DIPLOMA_STATUSES)[number];

export interface DiplomaDefinition {
  readonly id: Uuid;
  readonly institutionId: Uuid | null;
  readonly code: string;
  readonly label: string;
  readonly gradeCode: string;
  readonly curriculumNodeId: Uuid;
  readonly uvRequired: number;
  readonly autoAward: boolean;
  readonly status: DiplomaStatus;
  readonly description: string | null;
  readonly lastSyncedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DiplomaRequirement {
  readonly id: Uuid;
  readonly definitionId: Uuid;
  readonly ueNodeId: Uuid;
  readonly ueCode: string | null;
  readonly ueLabel: string | null;
  readonly credits: number;
  readonly mandatory: boolean;
  readonly position: number;
  readonly removedFromCurriculum: boolean;
}

export const AWARD_STATUSES = ["OBTAINED", "REVOKED"] as const;
export type AwardStatus = (typeof AWARD_STATUSES)[number];
export const AWARDED_VIA = ["AUTO", "MANUAL", "FORCED"] as const;
export type AwardedVia = (typeof AWARDED_VIA)[number];

/** Ligne figée dans le snapshot d'un octroi. */
export interface SnapshotRequirement {
  readonly ueNodeId: Uuid;
  readonly code: string | null;
  readonly label: string | null;
  readonly credits: number;
  readonly mandatory: boolean;
  readonly validated: boolean;
  readonly ledgerId: Uuid | null;
}

export interface RequirementsSnapshot {
  readonly v: 1;
  readonly uvRequired: number;
  readonly capturedAt: string;
  readonly requirements: readonly SnapshotRequirement[];
}

export interface DiplomaAward {
  readonly id: Uuid;
  readonly definitionId: Uuid;
  readonly studentId: Uuid;
  readonly lastEnrollmentId: Uuid | null;
  readonly academicYearId: Uuid | null;
  readonly reference: string;
  readonly referenceYear: number;
  readonly referenceSeq: number;
  readonly status: AwardStatus;
  readonly awardedVia: AwardedVia;
  readonly forcedReason: string | null;
  readonly creditsTotal: number;
  readonly requirementsSnapshot: RequirementsSnapshot;
  readonly eligibility: Readonly<Record<string, unknown>>;
  readonly cycleAverage: DecimalString | null;
  readonly mentionCode: string | null;
  readonly ruleSetCode: string;
  readonly ruleVersionId: Uuid;
  readonly ruleVersionNo: number;
  readonly definitionHash: string;
  readonly awardedAt: Date;
  readonly awardedBy: Uuid | null;
  readonly awardedByName: string;
  readonly acquiredDate: IsoDate | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: Uuid | null;
  readonly revokedByName: string | null;
  readonly revokeReason: string | null;
  readonly predecessorAwardId: Uuid | null;
  readonly reawardDecision: string | null;
}

export const DOCUMENT_KINDS = ["DIPLOMA", "ATTESTATION_SUCCESS", "ATTESTATION_AUTHENTICITY"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_STATUSES = ["ISSUED", "SUPERSEDED", "REVOKED"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export const SNAPSHOT_SCHEMAS = ["diploma/1", "attestation-success/1", "attestation-authenticity/1"] as const;
export type SnapshotSchema = (typeof SNAPSHOT_SCHEMAS)[number];

export interface OfficialDocument {
  readonly id: Uuid;
  readonly documentKind: DocumentKind;
  readonly awardId: Uuid | null;
  readonly studentId: Uuid;
  readonly programNodeId: Uuid | null;
  readonly reference: string;
  readonly referenceYear: number;
  readonly referenceSeq: number;
  readonly version: number;
  readonly supersedesId: Uuid | null;
  readonly status: DocumentStatus;
  readonly snapshotSchema: SnapshotSchema;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly snapshotHash: string;
  readonly verificationCode: string;
  readonly signingKeyId: string | null;
  readonly signature: string | null;
  readonly templateKey: string | null;
  readonly renderStatus: "PENDING" | "RENDERING" | "RENDERED" | "FAILED";
  readonly objectKey: string | null;
  readonly issuedAt: Date;
  readonly issuedBy: Uuid;
  readonly issuedByName: string;
  readonly publishedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokeReason: string | null;
}

export const SLOT_KEYS = ["DIPLOMA_LEFT", "DIPLOMA_RIGHT", "ATTESTATION_SUCCESS", "AUTHENTICITY"] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

export interface DocumentSlot {
  readonly id: Uuid;
  readonly slotKey: SlotKey;
  readonly signatoryId: Uuid;
  readonly validFrom: IsoDate;
  readonly validTo: IsoDate | null;
  readonly createdBy: Uuid;
  readonly createdAt: Date;
}

export const RESIT_WINDOW_STATUSES = ["OPEN", "CLOSED", "CANCELLED"] as const;
export type ResitWindowStatus = (typeof RESIT_WINDOW_STATUSES)[number];

export interface ResitWindow {
  readonly id: Uuid;
  readonly classroomId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly resultsStateId: Uuid | null;
  readonly opensOn: IsoDate;
  readonly closesOn: IsoDate;
  readonly nodeIds: readonly Uuid[] | null;
  readonly status: ResitWindowStatus;
  readonly openedBy: Uuid;
  readonly openedAt: Date;
  readonly closedBy: Uuid | null;
  readonly closedAt: Date | null;
}

export const RESIT_REGISTRATION_STATUSES = ["REGISTERED", "PRESENT", "ABSENT", "WAIVED", "GRADED"] as const;
export type ResitRegistrationStatus = (typeof RESIT_REGISTRATION_STATUSES)[number];

export interface ResitRegistration {
  readonly id: Uuid;
  readonly windowId: Uuid;
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly academicPeriodId: Uuid;
  readonly ecueNodeId: Uuid;
  readonly ueNodeId: Uuid;
  readonly session1Average: DecimalString | null;
  readonly status: ResitRegistrationStatus;
  readonly outcome: "VALIDATED" | "NOT_VALIDATED" | null;
}

export const COUNTER_KEYS = ["DIPLOMA", "AUTHENTICITY", "ATTESTATION"] as const;
export type CounterKey = (typeof COUNTER_KEYS)[number];

export interface HigherSettings {
  readonly creditValidityMonths: number | null;
}
