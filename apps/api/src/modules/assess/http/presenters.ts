/**
 * Domaine -> DTO HTTP (contrats de `packages/contracts/src/v2/assess.ts`). Instants en ISO 8601 UTC, notes en chaînes
 * décimales, aucune donnée interne.
 */
import type {
  AssessGradeDto,
  AssessmentDto,
  AssessRevisionDto,
  AssessTypeDto,
} from "@ecoledigitale/contracts/src/v2/assess";
import type { Assessment, AssessmentType, AssessSettings, Grade, GradeRevision, PeriodLock, PublishedGrade } from "../domain/types";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const typeDto = (t: AssessmentType): AssessTypeDto => ({
  id: t.id,
  code: t.code,
  label: t.label,
  aggregationGroup: t.aggregationGroup,
  defaultScaleMax: t.defaultScaleMax,
  defaultWeight: t.defaultWeight,
  publicationMode: t.publicationMode,
  visibleToStudents: t.visibleToStudents,
  allowsSession2: t.allowsSession2,
  isSystem: t.isSystem,
  templateKey: t.templateKey,
  position: t.position,
  active: t.active,
});

export const settingsDto = (s: AssessSettings) => ({
  requireSeparateReviewer: s.requireSeparateReviewer,
  requireSeparateApprover: s.requireSeparateApprover,
  maxScoreDecimals: s.maxScoreDecimals,
  lateGradePolicy: s.lateGradePolicy,
  updatedAt: iso(s.updatedAt),
});

export const assessmentDto = (a: Assessment): AssessmentDto => ({
  id: a.id,
  typeId: a.typeId,
  typeCode: a.typeCode,
  aggregationGroup: a.aggregationGroup,
  classroomId: a.classroomId,
  curriculumNodeId: a.curriculumNodeId,
  academicPeriodId: a.academicPeriodId,
  academicYearId: a.academicYearId,
  teacherId: a.teacherId,
  title: a.title,
  assessedOn: a.assessedOn,
  scaleMax: a.scaleMax,
  weight: a.weight,
  sessionNo: a.sessionNo,
  status: a.status,
  submittedAt: iso(a.submittedAt),
  submittedBy: a.submittedBy,
  reviewedAt: iso(a.reviewedAt),
  reviewedBy: a.reviewedBy,
  approvedAt: iso(a.approvedAt),
  approvedBy: a.approvedBy,
  publishedAt: iso(a.publishedAt),
  publishedBy: a.publishedBy,
  cancelledAt: iso(a.cancelledAt),
  cancelReason: a.cancelReason,
  fourEyesWaived: a.fourEyesWaived,
  returnComment: a.returnComment,
  rowVersion: a.rowVersion,
  createdAt: a.createdAt.toISOString(),
});

export const gradeDto = (g: Grade): AssessGradeDto => ({
  id: g.id,
  assessmentId: g.assessmentId,
  enrollmentId: g.enrollmentId,
  studentId: g.studentId,
  score: g.score,
  entryStatus: g.entryStatus,
  comment: g.comment,
  status: g.status,
  rowVersion: g.rowVersion,
  enteredAt: iso(g.enteredAt),
  correctedAt: iso(g.correctedAt),
});

export const revisionDto = (r: GradeRevision): AssessRevisionDto => ({
  id: r.id,
  assessmentId: r.assessmentId,
  gradeId: r.gradeId,
  enrollmentId: r.enrollmentId,
  kind: r.kind,
  oldScore: r.oldScore,
  oldEntryStatus: r.oldEntryStatus,
  newScore: r.newScore,
  newEntryStatus: r.newEntryStatus,
  reason: r.reason,
  requestedBy: r.requestedBy,
  requestedByName: r.requestedByName,
  requestedAt: r.requestedAt.toISOString(),
  status: r.status,
  decidedBy: r.decidedBy,
  decidedByName: r.decidedByName,
  decidedAt: iso(r.decidedAt),
  decisionComment: r.decisionComment,
  fourEyesWaived: r.fourEyesWaived,
  appliedAt: iso(r.appliedAt),
  batchId: r.batchId,
});

export const lockDto = (l: PeriodLock) => ({
  id: l.id,
  classroomId: l.classroomId,
  academicPeriodId: l.academicPeriodId,
  lockedAt: l.lockedAt.toISOString(),
  lockedBy: l.lockedBy,
  lockReason: l.lockReason,
  lockedSessions: l.lockedSessions,
  releasedAt: iso(l.releasedAt),
  releaseReason: l.releaseReason,
});

/** Lecture famille : la valeur courante et la mention « corrigée le … » — ni identité d'un tiers ni commentaire interne. */
export const publishedGradeDto = (p: PublishedGrade) => ({
  gradeId: p.gradeId,
  assessmentId: p.assessmentId,
  title: p.title,
  typeLabel: p.typeLabel,
  curriculumNodeId: p.curriculumNodeId,
  academicPeriodId: p.academicPeriodId,
  assessedOn: p.assessedOn,
  sessionNo: p.sessionNo,
  score: p.score,
  entryStatus: p.entryStatus,
  scaleMax: p.scaleMax,
  weight: p.weight,
  publishedAt: p.publishedAt.toISOString(),
  correctedAt: iso(p.correctedAt),
});
