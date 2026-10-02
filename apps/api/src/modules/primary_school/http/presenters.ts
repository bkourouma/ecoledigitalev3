/** Domaine -> DTO des contrats (`packages/contracts/src/v2/primary_school.ts`) : instants en ISO 8601, aucune donnée interne. */
import type {
  PrimaryAnnualReviewDto,
  PrimaryAssessmentDto,
  PrimaryCompetencySheetDto,
  PrimaryCouncilCaseDto,
  PrimaryCouncilOverviewDto,
  PrimaryFrameworkDetailDto,
  PrimaryFrameworkDto,
  PrimaryPhraseDto,
  PrimaryRatingScaleDto,
  PrimaryRevisionDto,
  PrimarySettingsDto,
  PrimaryYearArchiveDto,
} from "@ecoledigitale/contracts/src/v2/primary_school";
import type { ArchiveView } from "../application/archives";
import type { CompetencySheet } from "../application/competencies";
import type { CouncilCaseView, CouncilOverview } from "../application/council";
import type { ReviewView } from "../application/reviews";
import type { CompetencyAssessment, CompetencyRevision, Framework, FrameworkDetail, Phrase, RatingScale, Settings } from "../domain/types";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const settingsDto = (s: Settings): PrimarySettingsDto => ({ ...s });

export const scaleDto = (s: RatingScale): PrimaryRatingScaleDto => ({
  id: s.id,
  code: s.code,
  label: s.label,
  sourceKind: s.sourceKind,
  sourceReference: s.sourceReference,
  status: s.status,
  locked: s.locked,
  levels: s.levels.map((l) => ({ id: l.id, code: l.code, label: l.label, ordinal: l.ordinal, meetsExpectation: l.meetsExpectation })),
});

export const frameworkDto = (f: Framework): PrimaryFrameworkDto => ({
  id: f.id,
  code: f.code,
  version: f.version,
  label: f.label,
  scaleId: f.scaleId,
  status: f.status,
  sourceKind: f.sourceKind,
  sourceReference: f.sourceReference,
  publishedAt: iso(f.publishedAt),
  gradeLevelCodes: f.gradeLevelCodes,
  competencyCount: f.competencyCount,
});

export const frameworkDetailDto = (f: FrameworkDetail): PrimaryFrameworkDetailDto => ({
  ...frameworkDto(f),
  scale: scaleDto(f.scale),
  publishBlockers: f.publishBlockers,
  domains: f.domains.map((d) => ({
    id: d.id,
    code: d.code,
    label: d.label,
    ordinal: d.ordinal,
    competencies: d.competencies.map((c) => ({ id: c.id, code: c.code, label: c.label, description: c.description, ordinal: c.ordinal })),
  })),
});

export const assessmentDto = (a: CompetencyAssessment): PrimaryAssessmentDto => ({
  id: a.id,
  enrollmentId: a.enrollmentId,
  studentId: a.studentId,
  competencyId: a.competencyId,
  ratingLevelId: a.ratingLevelId,
  observedOn: a.observedOn,
  note: a.note,
  status: a.status,
  rowVersion: a.rowVersion,
  validatedAt: iso(a.validatedAt),
});

export const revisionDto = (r: CompetencyRevision): PrimaryRevisionDto => ({
  id: r.id,
  assessmentId: r.assessmentId,
  fromLevelId: r.fromLevelId,
  toLevelId: r.toLevelId,
  reason: r.reason,
  requestedBy: r.requestedBy,
  createdAt: r.createdAt.toISOString(),
});

export const sheetDto = (s: CompetencySheet): PrimaryCompetencySheetDto => ({
  classroomId: s.classroomId,
  periodId: s.periodId,
  gradeLevelCode: s.gradeLevelCode,
  locked: s.locked,
  frameworks: s.frameworks.map(frameworkDto),
  framework: s.framework ? frameworkDetailDto(s.framework) : null,
  students: s.students,
  assessments: s.assessments.map(assessmentDto),
  completeness: s.completeness,
});

export const phraseDto = (p: Phrase): PrimaryPhraseDto => ({ ...p });

export const caseDto = (c: CouncilCaseView): PrimaryCouncilCaseDto => ({
  id: c.id,
  deliberationId: c.deliberationId,
  classroomId: c.classroomId,
  enrollmentId: c.enrollmentId,
  studentId: c.studentId,
  studentName: c.studentName,
  reasonCodes: c.reasonCodes,
  ruleProposalCode: c.ruleProposalCode,
  proposalCode: c.proposalCode,
  proposalNote: c.proposalNote,
  discussionNote: c.discussionNote,
  status: c.status,
  decisionRef: c.decisionRef,
  finalCode: c.finalCode,
  justification: c.justification,
});

export const councilDto = (o: CouncilOverview): PrimaryCouncilOverviewDto => ({
  deliberationId: o.deliberationId,
  classroomId: o.classroomId,
  periodId: o.periodId,
  heldOn: o.heldOn,
  ruleSourceKind: o.ruleSourceKind,
  counts: o.counts,
  quorum: o.quorum,
  cases: o.cases.map(caseDto),
  attendance: o.attendance.map((a) => ({ staffId: a.staffId, staffName: a.staffName, roleCode: a.roleCode, convened: a.convened, present: a.present, signedAt: iso(a.signedAt), note: a.note })),
  minutesDocumentId: o.minutesDocumentId,
});

export const reviewDto = (r: ReviewView): PrimaryAnnualReviewDto => ({
  id: r.id,
  academicYearId: r.academicYearId,
  enrollmentId: r.enrollmentId,
  studentId: r.studentId,
  studentName: r.studentName,
  classroomId: r.classroomId,
  gradeLevelCode: r.gradeLevelCode,
  version: r.version,
  status: r.status,
  yearResultRef: r.yearResultRef,
  decisionRef: r.decisionRef,
  outcomeCode: r.outcomeCode,
  competencySummary: r.competencySummary,
  attendanceSummary: r.attendanceSummary,
  ruleVersionRef: r.ruleVersionRef,
  ruleSourceKind: r.ruleSourceKind,
  contentHash: r.contentHash,
  sealedAt: iso(r.sealedAt),
  reportcardId: r.reportcardId,
  supersedesId: r.supersedesId,
  supersedeReason: r.supersedeReason,
});

export const archiveDto = (a: Omit<ArchiveView, "blockers"> & { blockers?: ArchiveView["blockers"] }): PrimaryYearArchiveDto => ({
  id: a.id,
  institutionId: a.institutionId,
  academicYearId: a.academicYearId,
  status: a.status,
  reviewsTotal: a.reviewsTotal,
  reviewsSealed: a.reviewsSealed,
  manifestHash: a.manifestHash,
  preparedAt: iso(a.preparedAt),
  frozenAt: iso(a.frozenAt),
  blockers: a.blockers ?? [],
});
