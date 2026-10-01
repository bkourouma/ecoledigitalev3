/**
 * Types du domaine attendance. Aucun import d'infrastructure : ce dossier est pur (règle `domain-is-pure`).
 *
 * Les références vers les autres modules (élèves, classes, inscriptions, séances, périodes, personnel) sont des
 * UUID sans clé étrangère, résolus par les ports de `application/ports.ts`.
 */

export type Uuid = string;
/** `AAAA-MM-JJ` (date calendaire de l'établissement). */
export type IsoDate = string;

export type SubjectKind = "STUDENT" | "STAFF";
export type SessionScope = "DAILY" | "SESSION";
export type SessionStatus = "OPEN" | "SUBMITTED" | "VALIDATED" | "CANCELLED";
export type SessionSource = "MANUAL" | "OFFLINE_SYNC" | "LIVE_CLASS" | "IMPORT";
export type RecordSource = "TEACHER" | "ADMIN" | "LIVE_CLASS" | "OFFLINE_SYNC" | "IMPORT" | "JUSTIFICATION";
export type JustificationStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "REVOKED";
export type SubmitterKind = "GUARDIAN" | "STUDENT" | "STAFF";
export type LeaveStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED";
export type StaffSource = "MANUAL" | "SELF" | "OFFLINE_SYNC" | "IMPORT" | "QR" | "BADGE" | "BIOMETRIC";
export type CallScope = "DAILY" | "SESSION" | "BOTH";
export type AttachmentType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

/** Codes de statut SYSTÈME (verrouillés en base : sémantique non modifiable). */
export const StatusCode = {
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  LATE: "LATE",
  EXCUSED: "EXCUSED",
  EARLY_LEAVE: "EARLY_LEAVE",
  ON_LEAVE: "ON_LEAVE",
} as const;

export const SYSTEM_STUDENT_CODES: readonly string[] = Object.freeze(["PRESENT", "ABSENT", "LATE", "EXCUSED", "EARLY_LEAVE"]);
export const SYSTEM_STAFF_CODES: readonly string[] = Object.freeze(["PRESENT", "ABSENT", "LATE", "ON_LEAVE"]);

/** Définition d'un statut de présence (donnée de pack). Les drapeaux pilotent TOUS les comptages. */
export interface StatusDefinition {
  readonly subjectKind: SubjectKind;
  readonly code: string;
  readonly label: string;
  readonly countsAsPresent: boolean;
  readonly countsAsAbsence: boolean;
  readonly countsAsLate: boolean;
  readonly isJustified: boolean;
  readonly requiresJustification: boolean;
  readonly sortOrder: number;
  readonly isSystem: boolean;
  readonly active: boolean;
}

export type StatusIndex = ReadonlyMap<string, StatusDefinition>;

/** Politique d'appel d'un cycle (donnée d'établissement, pas une règle réglementaire). */
export interface CallPolicy {
  readonly institutionId: Uuid;
  readonly educationLevelCode: string;
  readonly callScope: CallScope;
  /** Minutes pendant lesquelles un enseignant corrige une séance SUBMITTED ; `null` = jusqu'à la validation. */
  readonly editWindowMinutes: number | null;
  readonly lateRequiresMinutes: boolean;
  /** Durée comptée pour une absence constatée à l'appel JOURNALIER ; `null` = on ne compte que des jours. */
  readonly dailyMinutes: number | null;
}

/** Séance d'appel (vue domaine). */
export interface AttendanceSession {
  readonly id: Uuid;
  readonly institutionId: Uuid;
  readonly academicYearId: Uuid;
  readonly classroomId: Uuid;
  readonly curriculumNodeId: Uuid | null;
  readonly offeringId: Uuid | null;
  readonly occurrenceId: Uuid | null;
  readonly scope: SessionScope;
  readonly sessionDate: IsoDate;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly durationMinutes: number | null;
  readonly takenByStaffId: Uuid | null;
  readonly takenByUserId: Uuid | null;
  readonly status: SessionStatus;
  readonly source: SessionSource;
  readonly clientId: Uuid | null;
  readonly submittedAt: Date | null;
  readonly validatedAt: Date | null;
  readonly validatedBy: Uuid | null;
  readonly reopenedCount: number;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Pointage d'un élève (vue domaine). */
export interface StudentRecord {
  readonly id: Uuid;
  readonly sessionId: Uuid;
  readonly enrollmentId: Uuid;
  readonly studentId: Uuid;
  readonly statusCode: string;
  readonly originalStatusCode: string | null;
  readonly excused: boolean;
  readonly minutesLate: number | null;
  readonly countedMinutes: number | null;
  readonly arrivedAt: Date | null;
  readonly leftAt: Date | null;
  readonly justificationId: Uuid | null;
  readonly note: string | null;
  readonly markedBy: Uuid;
  readonly markedAt: Date;
  readonly clientMarkedAt: Date | null;
  readonly sourceDetail: RecordSource | null;
  readonly clientId: Uuid | null;
}

export interface Justification {
  readonly id: Uuid;
  readonly studentId: Uuid;
  readonly enrollmentId: Uuid;
  readonly fromDate: IsoDate;
  readonly toDate: IsoDate;
  readonly reasonCode: string;
  readonly comment: string | null;
  readonly submittedByKind: SubmitterKind;
  readonly submittedByUser: Uuid;
  readonly submittedAt: Date;
  readonly status: JustificationStatus;
  readonly decidedBy: Uuid | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  readonly revokedBy: Uuid | null;
  readonly revokedAt: Date | null;
  readonly revocationReason: string | null;
}

/** Comptages bruts d'un couple (inscription, période). `absent*` = TOTAL, `excused*` = sous-ensemble justifié. */
export interface SummaryCounts {
  readonly sessionsTotal: number;
  readonly presentCount: number;
  readonly absentCount: number;
  readonly excusedCount: number;
  readonly lateCount: number;
  readonly excusedLateCount: number;
  readonly earlyLeaveCount: number;
  readonly unmarkedCount: number;
  readonly absentMinutes: number;
  readonly excusedMinutes: number;
  readonly lateMinutes: number;
}

export const EMPTY_SUMMARY: SummaryCounts = Object.freeze({
  sessionsTotal: 0,
  presentCount: 0,
  absentCount: 0,
  excusedCount: 0,
  lateCount: 0,
  excusedLateCount: 0,
  earlyLeaveCount: 0,
  unmarkedCount: 0,
  absentMinutes: 0,
  excusedMinutes: 0,
  lateMinutes: 0,
});

export interface SummaryOverride {
  readonly id: Uuid;
  readonly enrollmentId: Uuid;
  readonly periodId: Uuid;
  readonly absentMinutes: number;
  readonly excusedMinutes: number;
  readonly reason: string;
  readonly setBy: Uuid;
  readonly setAt: Date;
}
