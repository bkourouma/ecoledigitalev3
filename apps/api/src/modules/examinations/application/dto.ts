/**
 * Correspondance lignes -> DTO des contrats (`packages/contracts/src/v2/examinations.ts`). Fonctions pures.
 * Les instants sortent en ISO 8601 ; les décimaux en chaînes canoniques ; aucun champ interne (hash, versions de ligne) en plus.
 */
import type {
  ExamAssignmentDto,
  ExamBatchDto,
  ExamCandidateDto,
  ExamCenterDto,
  ExamEligibilityCheckDto,
  ExamExternalProfileDto,
  ExamExportFormatDto,
  ExamExportRunDto,
  ExamHistoryDto,
  ExamIdentifierDto,
  ExamImportFormatDto,
  ExamIssuedDocumentDto,
  ExamPaperDto,
  ExamPieceDto,
  ExamRequirementDto,
  ExamResultDto,
  ExamRevisionRequestDto,
  ExamRoomDto,
  ExamScoreDto,
  ExamSessionDto,
  ExamTrackDto,
  ExamTypeDto,
} from "@ecoledigitale/contracts/src/v2/examinations";
import { normalizeDecimal } from "../domain/decimal";
import { sessionProgress } from "../domain/lifecycle";
import type {
  AssignmentRow,
  BatchRow,
  CandidatePieceRow,
  CandidateRow,
  CenterRow,
  DocumentRequirementRow,
  EligibilityCheckRow,
  ExamPaperRow,
  ExternalProfileRow,
  ExamTrackRow,
  ExamTypeRow,
  ExportFormatRow,
  ExportRunRow,
  HistoryRow,
  IdentifierRow,
  ImportFormatRow,
  IssuedDocumentRow,
  ResultRow,
  RevisionRequestRow,
  RoomRow,
  ScoreRow,
  SessionRow,
} from "../domain/types";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const dec = (v: string | null): string | null => (v === null ? null : normalizeDecimal(v));

export const isPlaceholder = (...kinds: Array<string | null | undefined>): boolean => kinds.some((k) => k === "placeholder");

export const toTypeDto = (t: ExamTypeRow): ExamTypeDto => ({
  id: t.id, code: t.code, label: t.label, educationLevelCode: t.educationLevelCode, gradeLevelCode: t.gradeLevelCode, resultContractId: t.resultContractId,
  candidateNumberPattern: t.candidateNumberPattern, transmitsToAdmission: t.transmitsToAdmission, sourceKind: t.sourceKind, sourceReference: t.sourceReference, status: t.status, placeholder: t.sourceKind === "placeholder",
});
export const toTrackDto = (t: ExamTrackRow): ExamTrackDto => ({ id: t.id, code: t.code, label: t.label, sourceKind: t.sourceKind, active: t.active });
export const toPaperDto = (p: ExamPaperRow): ExamPaperDto => ({
  id: p.id, trackCode: p.trackCode, code: p.code, label: p.label, coefficient: normalizeDecimal(p.coefficient), scaleMax: normalizeDecimal(p.scaleMax), isOptional: p.isOptional, ordinal: p.ordinal, sourceKind: p.sourceKind, active: p.active,
});
export const toRequirementDto = (r: DocumentRequirementRow): ExamRequirementDto => ({ id: r.id, code: r.code, label: r.label, required: r.required, sortOrder: r.sortOrder, sourceKind: r.sourceKind, active: r.active });

export const toRoomDto = (r: RoomRow): ExamRoomDto => ({ id: r.id, centerId: r.centerId, code: r.code, label: r.label, capacity: r.capacity, active: r.active });
export const toCenterDto = (c: CenterRow, rooms?: RoomRow[]): ExamCenterDto => ({ id: c.id, code: c.code, name: c.name, kind: c.kind, authorityCode: c.authorityCode, locality: c.locality, status: c.status, ...(rooms ? { rooms: rooms.map(toRoomDto) } : {}) });

export function toSessionDto(s: SessionRow, type: Pick<ExamTypeRow, "code" | "label" | "sourceKind">, extra: { demoRulePin?: boolean } = {}): ExamSessionDto {
  const progress = sessionProgress(s.status);
  return {
    id: s.id, examTypeId: s.examTypeId, examTypeCode: type.code, examTypeLabel: type.label, institutionId: s.institutionId, academicYearId: s.academicYearId, code: s.code, label: s.label,
    sessionKind: s.sessionKind, attemptKind: s.attemptKind, sessionYear: s.sessionYear, mockOfSessionId: s.mockOfSessionId, registrationOpensOn: s.registrationOpensOn, registrationClosesOn: s.registrationClosesOn,
    startsOn: s.startsOn, endsOn: s.endsOn, status: s.status, definitionLockedAt: iso(s.definitionLockedAt), ruleVersionRef: s.ruleVersionRef, sourceKind: s.sourceKind,
    demoRules: isPlaceholder(type.sourceKind, s.sourceKind) || Boolean(extra.demoRulePin),
    progress: { index: progress.index, total: progress.total, percent: progress.percent, next: progress.next, allowedNext: [...progress.allowedNext] },
    createdAt: s.createdAt.toISOString(),
  };
}

export const displayNameOf = (c: Pick<CandidateRow, "lastName" | "firstName">, fallback: string | null = null): string | null =>
  c.lastName || c.firstName ? [c.lastName?.toLocaleUpperCase("fr-FR"), c.firstName].filter(Boolean).join(" ") : fallback;

export function toCandidateDto(c: CandidateRow, extra: { officialNumber?: string | null; missingPieces?: string[]; fallbackName?: string | null } = {}): ExamCandidateDto {
  return {
    id: c.id, sessionId: c.sessionId, studentId: c.studentId, candidateKind: c.candidateKind, anonymized: c.anonymizedAt !== null, enrollmentId: c.enrollmentId, gradeLevelCode: c.gradeLevelCode, trackCode: c.trackCode, lastName: c.lastName, firstName: c.firstName,
    birthDate: c.birthDate, birthPlace: c.birthPlace, sex: c.sex, registrationStatus: c.registrationStatus, eligibilityStatus: c.eligibilityStatus, outcome: c.outcome, candidateNumber: c.candidateNumber,
    officialNumber: extra.officialNumber ?? null, registeredAt: iso(c.registeredAt), withdrawnReason: c.withdrawnReason, missingPieces: extra.missingPieces ?? [],
    displayName: displayNameOf(c, extra.fallbackName ?? null), rowVersion: c.rowVersion,
  };
}

export const toCheckDto = (c: EligibilityCheckRow): ExamEligibilityCheckDto => ({
  id: c.id, result: c.result, reasons: c.reasons, ruleVersionRef: c.ruleVersionRef, evaluatedBy: c.evaluatedBy, evaluatedAt: c.evaluatedAt.toISOString(), overridden: c.overriddenBy !== null, overrideReason: c.overrideReason,
});
export const toPieceDto = (p: CandidatePieceRow): ExamPieceDto => ({ requirementId: p.requirementId, code: p.requirementCode, label: p.requirementLabel, required: p.required, status: p.status, documentRef: p.documentRef, presentationKind: p.presentationKind, sightedNote: p.sightedNote, rejectionReason: p.rejectionReason, reviewedAt: iso(p.reviewedAt) });

/** Profil restreint d'un candidat libre. Le numéro de la pièce d'identité n'est rendu entier qu'à `reveal` (sinon masqué : 3 derniers caractères). */
export function toExternalProfileDto(p: ExternalProfileRow, options: { reveal: boolean }): ExamExternalProfileDto {
  const masked = (v: string | null): string | null => (v === null || options.reveal ? v : v.length <= 3 ? "***" : `${"*".repeat(v.length - 3)}${v.slice(-3)}`);
  return {
    candidateId: p.candidateId, contactPhone: p.contactPhone, contactEmail: p.contactEmail, addressLine: p.addressLine, idPieceKind: p.idPieceKind, idPieceNumber: masked(p.idPieceNumber),
    guardianName: p.guardianName, guardianRelation: p.guardianRelation, guardianPhone: p.guardianPhone, guardianEmail: p.guardianEmail, declaredInExamGrade: p.declaredInExamGrade,
    declaredPriorAttempts: p.declaredPriorAttempts, dataSource: p.dataSource, anonymizedAt: iso(p.anonymizedAt),
  };
}
export const toIdentifierDto = (i: IdentifierRow): ExamIdentifierDto => ({ id: i.id, kind: i.kind, value: i.value, source: i.source });
export const toHistoryDto = (h: HistoryRow): ExamHistoryDto => ({ id: h.id, kind: h.kind, fromValue: h.fromValue, toValue: h.toValue, reason: h.reason, actorId: h.actorId, occurredAt: h.occurredAt.toISOString() });
export const toScoreDto = (s: ScoreRow): ExamScoreDto => ({ id: s.id, candidateId: s.candidateId, paperId: s.paperId, status: s.status, score: dec(s.score), source: s.source });

export function toAssignmentDto(a: AssignmentRow & { candidateNumber: string | null; lastName: string | null; firstName: string | null; centerCode: string; centerName: string; roomCode: string }): ExamAssignmentDto {
  return {
    candidateId: a.candidateId, candidateNumber: a.candidateNumber, displayName: displayNameOf({ lastName: a.lastName, firstName: a.firstName }), centerId: a.centerId, centerCode: a.centerCode, centerName: a.centerName,
    roomId: a.roomId, roomCode: a.roomCode, seatNumber: a.seatNumber, tableNumber: a.tableNumber,
  };
}

export function toResultDto(r: ResultRow, c?: { candidateNumber: string | null; lastName: string | null; firstName: string | null }): ExamResultDto {
  return {
    id: r.id, sessionId: r.sessionId, candidateId: r.candidateId, candidateNumber: c?.candidateNumber ?? null, displayName: c ? displayNameOf({ lastName: c.lastName, firstName: c.firstName }) : null, resultCode: r.resultCode,
    average: dec(r.average), totalPoints: dec(r.totalPoints), rank: r.rank, mentionCode: r.mentionCode, source: r.source, ruleVersionRef: r.ruleVersionRef, status: r.status, publishedAt: iso(r.publishedAt),
  };
}

export const toDocumentDto = (d: IssuedDocumentRow, candidateNumber: string | null = null): ExamIssuedDocumentDto => ({
  id: d.id, sessionId: d.sessionId, candidateId: d.candidateId, candidateNumber, kind: d.kind, version: d.version, status: d.status, officialDocumentId: d.officialDocumentId, issuedAt: iso(d.issuedAt), revokedReason: d.revokedReason, createdAt: d.createdAt.toISOString(),
});

export const toBatchDto = (b: BatchRow): ExamBatchDto => ({
  id: b.id, sessionId: b.sessionId, kind: b.kind, fileName: b.fileName, sha256: b.sha256, formatCode: b.formatCode, rowCount: b.rowCount, okCount: b.okCount, errorCount: b.errorCount, status: b.status, uploadedBy: b.uploadedBy, appliedAt: iso(b.appliedAt), createdAt: b.createdAt.toISOString(),
});

export const toExportFormatDto = (f: ExportFormatRow): ExamExportFormatDto => ({
  id: f.id, code: f.code, version: f.version, label: f.label, examTypeId: f.examTypeId, kind: f.kind, fileFormat: f.fileFormat, encoding: f.encoding, delimiter: f.delimiter,
  columns: f.columns as ExamExportFormatDto["columns"], status: f.status, sourceKind: f.sourceKind, sourceReference: f.sourceReference, placeholder: f.sourceKind === "placeholder",
});
export const toImportFormatDto = (f: ImportFormatRow): ExamImportFormatDto => ({
  id: f.id, code: f.code, version: f.version, label: f.label, examTypeId: f.examTypeId, kind: f.kind, encoding: f.encoding, delimiter: f.delimiter, decimalSeparator: f.decimalSeparator, hasHeader: f.hasHeader,
  columns: f.columns, valueMap: f.valueMap, status: f.status, sourceKind: f.sourceKind, sourceReference: f.sourceReference, placeholder: f.sourceKind === "placeholder",
});
export const toRunDto = (r: ExportRunRow, formatCode: string | null = null): ExamExportRunDto => ({
  id: r.id, sessionId: r.sessionId, formatId: r.formatId, formatCode, formatVersion: r.formatVersion, status: r.status, rowCount: r.rowCount, fileSha256: r.fileSha256, errorCode: r.errorCode, requestedBy: r.requestedBy, createdAt: r.createdAt.toISOString(), completedAt: iso(r.completedAt),
});

export function toRevisionRequestDto(q: RevisionRequestRow, extra: { candidateId: string | null; candidateNumber: string | null; current: Record<string, unknown> }): ExamRevisionRequestDto {
  return {
    id: q.id, sessionId: q.sessionId, targetKind: q.targetKind, scoreId: q.scoreId, resultId: q.resultId, candidateId: extra.candidateId, candidateNumber: extra.candidateNumber, proposed: q.proposed, current: extra.current,
    reason: q.reason, requestedBy: q.requestedBy, requestedAt: q.requestedAt.toISOString(), status: q.status, decidedBy: q.decidedBy, decidedAt: iso(q.decidedAt), decisionNote: q.decisionNote,
  };
}
