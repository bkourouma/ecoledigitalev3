/** Présentation : domaine -> DTO de réponse (schémas Zod de `packages/contracts/src/v2/higher.ts`). */
import type { DiplomaCandidate, DiplomaDetail, DiplomaProgressView, SyncReport } from "../application/diplomas";
import type { RecomputeReport } from "../application/awards";
import type { AttestationRosterRow, IssuedDocument } from "../application/documents";
import type { CreditSummary } from "../application/ledger";
import type { PrerequisiteWarning } from "../application/prerequisites";
import type { StudentResitView } from "../application/resit";
import type { StudentDiplomaView, StudentPathway } from "../application/student-view";
import type { DiplomaProgress, RequirementState } from "../domain/diploma";
import type {
  DiplomaAward,
  DiplomaDefinition,
  DiplomaRequirement,
  DocumentSlot,
  LedgerEntry,
  OfficialDocument,
  Prerequisite,
  PrerequisiteCheck,
  ResitRegistration,
  ResitWindow,
  UeDebt,
} from "../domain/types";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export const diplomaDto = (d: DiplomaDefinition) => ({
  id: d.id, institutionId: d.institutionId, code: d.code, label: d.label, gradeCode: d.gradeCode, curriculumNodeId: d.curriculumNodeId, uvRequired: d.uvRequired,
  autoAward: d.autoAward, status: d.status, description: d.description, lastSyncedAt: iso(d.lastSyncedAt), createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
});

export const requirementDto = (r: DiplomaRequirement) => ({
  id: r.id, ueNodeId: r.ueNodeId, ueCode: r.ueCode, ueLabel: r.ueLabel, credits: r.credits, mandatory: r.mandatory, position: r.position, removedFromCurriculum: r.removedFromCurriculum,
});

export const diplomaDetailDto = (d: DiplomaDetail) => ({
  diploma: diplomaDto(d.definition), requirements: d.requirements.map(requirementDto), requirementsCredits: d.requirementsCredits, awardCounts: d.awardCounts,
});

export const syncReportDto = (r: SyncReport) => ({ ...r });

const stateDto = (s: RequirementState) => ({
  ueNodeId: s.ueNodeId, code: s.code, label: s.label, credits: s.credits, mandatory: s.mandatory, validated: s.validated, ledgerId: s.ledgerId, removedFromCurriculum: s.removedFromCurriculum,
});

export const progressDto = (p: DiplomaProgress) => ({
  uvValidated: p.uvValidated, uvRequired: p.uvRequired, percent: p.percent, validated: p.validated.map(stateDto), remaining: p.remaining.map(stateDto), missingMandatory: p.missingMandatory.map(stateDto),
});

export const awardDto = (a: DiplomaAward) => ({
  id: a.id, definitionId: a.definitionId, studentId: a.studentId, lastEnrollmentId: a.lastEnrollmentId, academicYearId: a.academicYearId, reference: a.reference,
  status: a.status, awardedVia: a.awardedVia, forcedReason: a.forcedReason, creditsTotal: a.creditsTotal, requirements: a.requirementsSnapshot.requirements.map((r) => ({ ...r })),
  cycleAverage: a.cycleAverage, mentionCode: a.mentionCode,
  rule: { ruleSetCode: a.ruleSetCode, ruleVersionId: a.ruleVersionId, versionNo: a.ruleVersionNo, definitionHash: a.definitionHash },
  awardedAt: a.awardedAt.toISOString(), awardedBy: a.awardedBy, awardedByName: a.awardedByName, acquiredDate: a.acquiredDate, revokedAt: iso(a.revokedAt),
  revokedByName: a.revokedByName, revokeReason: a.revokeReason, predecessorAwardId: a.predecessorAwardId, reawardDecision: a.reawardDecision,
});

export const recomputeDto = (r: RecomputeReport) => ({ evaluated: r.evaluated, awarded: r.awarded, skipped: { ...r.skipped }, failed: r.failed });

export const candidateDto = (c: DiplomaCandidate) => ({ ...c });

export const progressViewDto = (v: DiplomaProgressView) => ({
  diploma: diplomaDto(v.definition),
  progress: progressDto(v.progress),
  eligibility: v.eligibility ? { eligible: v.eligibility.eligible, rule: { ...v.eligibility.rule } } : null,
  award: v.award ? awardDto(v.award) : null,
});

export const studentDiplomasDto = (v: StudentDiplomaView) => ({
  studentId: v.studentId,
  awards: v.awards.map(awardDto),
  progress: v.progress.map((p) => ({ diploma: diplomaDto(p.definition), progress: progressDto(p.progress), eligible: p.eligible })),
});

export const ledgerEntryDto = (e: LedgerEntry) => ({
  id: e.id, studentId: e.studentId, enrollmentId: e.enrollmentId, ueNodeId: e.ueNodeId, academicYearId: e.academicYearId, academicPeriodId: e.academicPeriodId,
  credits: e.credits, averageExact: e.averageExact, acquiredVia: e.acquiredVia, sessionObtained: e.sessionObtained, status: e.status, compensatedEcueCount: e.compensatedEcueCount,
  overrideId: e.overrideId, sourceResultId: e.sourceResultId, sourceResultsVersion: e.sourceResultsVersion, validUntil: e.validUntil, acquiredAt: e.acquiredAt.toISOString(),
  revokedAt: iso(e.revokedAt), revokeReason: e.revokeReason, expiredAt: iso(e.expiredAt),
});

export const debtDto = (d: UeDebt) => ({
  id: d.id, studentId: d.studentId, enrollmentId: d.enrollmentId, ueNodeId: d.ueNodeId, academicYearId: d.academicYearId, academicPeriodId: d.academicPeriodId,
  status: d.status, detectedAt: d.detectedAt.toISOString(), clearedAt: iso(d.clearedAt),
});

export const creditSummaryDto = (s: CreditSummary) => ({
  studentId: s.studentId, totalCredits: s.totalCredits, acquiredUeCount: s.acquiredUeCount, byYear: s.byYear.map((y) => ({ ...y })), byPeriod: s.byPeriod.map((p) => ({ ...p })), openDebtCount: s.openDebtCount,
});

export const prerequisiteDto = (p: Prerequisite) => ({ id: p.id, ueNodeId: p.ueNodeId, prerequisiteNodeId: p.prerequisiteNodeId, mode: p.mode, minAverage: p.minAverage });
export const prerequisiteCheckDto = (c: PrerequisiteCheck) => ({ satisfied: c.satisfied, missing: c.missing.map((m) => ({ ...m })) });
export const prerequisiteWarningDto = (w: PrerequisiteWarning) => ({ studentId: w.studentId, missing: w.missing.map((m) => ({ ...m })) });

export const resitWindowDto = (w: ResitWindow) => ({
  id: w.id, classroomId: w.classroomId, academicPeriodId: w.academicPeriodId, resultsStateId: w.resultsStateId, opensOn: w.opensOn, closesOn: w.closesOn,
  nodeIds: w.nodeIds ? [...w.nodeIds] : null, status: w.status, openedBy: w.openedBy, openedAt: w.openedAt.toISOString(), closedBy: w.closedBy, closedAt: iso(w.closedAt),
});
export const resitRegistrationDto = (r: ResitRegistration) => ({
  id: r.id, windowId: r.windowId, enrollmentId: r.enrollmentId, studentId: r.studentId, academicPeriodId: r.academicPeriodId, ecueNodeId: r.ecueNodeId, ueNodeId: r.ueNodeId,
  session1Average: r.session1Average, status: r.status, outcome: r.outcome,
});
export const studentResitDto = (r: StudentResitView) => ({ ...resitRegistrationDto(r), opensOn: r.opensOn, closesOn: r.closesOn, windowStatus: r.windowStatus, phase: r.phase });

export const documentDto = (d: OfficialDocument) => ({
  id: d.id, documentKind: d.documentKind, awardId: d.awardId, studentId: d.studentId, programNodeId: d.programNodeId, reference: d.reference, version: d.version,
  supersedesId: d.supersedesId, status: d.status, snapshotSchema: d.snapshotSchema, snapshotHash: d.snapshotHash, verificationCode: d.verificationCode,
  sealed: d.signature !== null, renderStatus: d.renderStatus, issuedAt: d.issuedAt.toISOString(), issuedByName: d.issuedByName, publishedAt: iso(d.publishedAt),
  revokedAt: iso(d.revokedAt), revokeReason: d.revokeReason,
});
export const documentDetailDto = (d: OfficialDocument) => ({ ...documentDto(d), snapshot: d.snapshot });
export const issuedDocumentDto = (r: IssuedDocument) => ({ document: documentDetailDto(r.document), created: r.created });

export const rosterRowDto = (r: AttestationRosterRow) => ({ ...r, missingUeNodeIds: [...r.missingUeNodeIds] });

export const slotDto = (s: DocumentSlot) => ({ id: s.id, slotKey: s.slotKey, signatoryId: s.signatoryId, validFrom: s.validFrom, validTo: s.validTo, createdAt: s.createdAt.toISOString() });

export const pathwayDto = (p: StudentPathway) => ({
  studentId: p.studentId,
  summary: creditSummaryDto(p.summary),
  acquired: p.acquired.map(ledgerEntryDto),
  debts: p.debts.map(debtDto),
  resits: p.resits.map(studentResitDto),
  diplomas: studentDiplomasDto(p.diplomas),
});
