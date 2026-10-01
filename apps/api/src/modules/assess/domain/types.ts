/**
 * Types du domaine `assess`. Notes et barèmes : CHAÎNES décimales exactes (jamais de flottant). Instants : `Date`
 * (UTC). Dates calendaires : `AAAA-MM-JJ` lues en texte.
 */
import type { AssessEntryStatus, AssessStatus } from "@ecoledigitale/contracts/src/v2/assess";

export type Uuid = string;
export type IsoDate = string;
export type SessionNo = 1 | 2;
export type PublicationMode = "MANUAL" | "AUTO_ON_APPROVAL";
export type RevisionKind = "CORRECTION" | "ADDITION" | "REMOVAL";
export type RevisionStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "APPLIED";

export type { AssessEntryStatus, AssessStatus };

export interface AssessmentType {
  id: Uuid;
  code: string;
  label: string;
  aggregationGroup: string;
  defaultScaleMax: string;
  defaultWeight: string;
  publicationMode: PublicationMode;
  visibleToStudents: boolean;
  allowsSession2: boolean;
  isSystem: boolean;
  templateKey: string | null;
  position: number;
  active: boolean;
}

export interface AssessSettings {
  requireSeparateReviewer: boolean;
  requireSeparateApprover: boolean;
  maxScoreDecimals: number;
  lateGradePolicy: "REVISION";
  updatedAt: Date | null;
}

export const DEFAULT_ASSESS_SETTINGS: AssessSettings = Object.freeze({
  requireSeparateReviewer: true,
  requireSeparateApprover: true,
  maxScoreDecimals: 2,
  lateGradePolicy: "REVISION" as const,
  updatedAt: null,
});

export interface Assessment {
  id: Uuid;
  typeId: Uuid;
  typeCode: string | null;
  aggregationGroup: string | null;
  visibleToStudents: boolean | null;
  publicationMode: PublicationMode | null;
  classroomId: Uuid;
  curriculumNodeId: Uuid;
  academicPeriodId: Uuid;
  academicYearId: Uuid;
  teacherId: Uuid;
  title: string;
  assessedOn: IsoDate;
  scaleMax: string;
  weight: string;
  sessionNo: SessionNo;
  status: AssessStatus;
  submittedAt: Date | null;
  submittedBy: Uuid | null;
  reviewedAt: Date | null;
  reviewedBy: Uuid | null;
  approvedAt: Date | null;
  approvedBy: Uuid | null;
  publishedAt: Date | null;
  publishedBy: Uuid | null;
  cancelledAt: Date | null;
  cancelledBy: Uuid | null;
  cancelReason: string | null;
  fourEyesWaived: boolean;
  returnComment: string | null;
  rowVersion: number;
  createdBy: Uuid;
  createdAt: Date;
}

export interface Grade {
  id: Uuid;
  assessmentId: Uuid;
  enrollmentId: Uuid;
  studentId: Uuid;
  score: string | null;
  entryStatus: AssessEntryStatus;
  comment: string | null;
  status: AssessStatus;
  rowVersion: number;
  enteredBy: Uuid | null;
  enteredAt: Date | null;
  /** Date de la dernière révision appliquée (mention « corrigée le … »). */
  correctedAt: Date | null;
}

export interface GradeRevision {
  id: Uuid;
  assessmentId: Uuid;
  gradeId: Uuid | null;
  enrollmentId: Uuid;
  studentId: Uuid | null;
  kind: RevisionKind;
  oldScore: string | null;
  oldEntryStatus: AssessEntryStatus | null;
  newScore: string | null;
  newEntryStatus: AssessEntryStatus | null;
  reason: string;
  requestedBy: Uuid;
  requestedByName: string;
  requestedAt: Date;
  status: RevisionStatus;
  decidedBy: Uuid | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  fourEyesWaived: boolean;
  appliedAt: Date | null;
  batchId: Uuid | null;
}

export interface PeriodLock {
  id: Uuid;
  classroomId: Uuid;
  academicPeriodId: Uuid;
  lockedAt: Date;
  lockedBy: Uuid;
  lockReason: string | null;
  lockedSessions: SessionNo[];
  releasedAt: Date | null;
  releasedBy: Uuid | null;
  releaseReason: string | null;
}

export interface Transition {
  id: Uuid;
  assessmentId: Uuid;
  fromStatus: AssessStatus | null;
  toStatus: AssessStatus;
  actorId: Uuid | null;
  actorName: string | null;
  comment: string | null;
  fourEyesWaived: boolean;
  at: Date;
}

/** Note publiée telle que la lit le module `results` (aucune identité d'élève hors identifiants). */
export interface PublishedGrade {
  gradeId: Uuid;
  assessmentId: Uuid;
  enrollmentId: Uuid;
  studentId: Uuid;
  curriculumNodeId: Uuid;
  classroomId: Uuid;
  academicPeriodId: Uuid;
  sessionNo: SessionNo;
  assessedOn: IsoDate;
  title: string;
  typeCode: string;
  aggregationGroup: string;
  scaleMax: string;
  weight: string;
  score: string | null;
  entryStatus: AssessEntryStatus;
  visibleToStudents: boolean;
  typeLabel: string;
  publishedAt: Date;
  /** Date de la dernière révision appliquée (mention « corrigée le … »). */
  correctedAt: Date | null;
}
