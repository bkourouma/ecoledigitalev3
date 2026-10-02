"use client";

/**
 * Hooks typés du module `examinations` (`/api/v1/examinations/*`). Schémas Zod de `packages/contracts/src/v2/examinations.ts`.
 *
 * AUCUNE règle d'examen côté client : éligibilité, moyenne et issue d'un examen blanc, taux de réussite, numéro de candidat,
 * transitions autorisées et leurs manques sont décidés par l'API (règles `exam-national@1`, gardes de la base). L'écran affiche ce qui
 * revient et envoie des actions ; `usePermission` / `useFeature` servent seulement à AFFICHER ou masquer. Les nombres exacts sont des
 * chaînes décimales (jamais convertis en flottant pour décider).
 */

import { platformHooks as hooks } from "@/platform/api/default-client";
import {
  examAssignmentDtoSchema,
  examAssignmentsOverviewSchema,
  examAutoAssignReportSchema,
  examBatchDetailDtoSchema,
  examBatchDtoSchema,
  examBulkResultsReportSchema,
  examBulkScoresReportSchema,
  examCandidateDetailDtoSchema,
  examCandidateDtoSchema,
  examCenterDtoSchema,
  examComputeMockReportSchema,
  examEvaluateAllReportSchema,
  examEvaluateOneResultSchema,
  examExportDownloadDtoSchema,
  examExportFormatDtoSchema,
  examExportRunDtoSchema,
  examFamilyExamDtoSchema,
  examFromClassroomReportSchema,
  examImportFormatDtoSchema,
  examImportFromAssessReportSchema,
  examIssueBatchReportSchema,
  examIssuedDocumentDtoSchema,
  examItemsSchema,
  examLinkDtoSchema,
  examPackReportSchema,
  examPageSchema,
  examPaperDtoSchema,
  examPiecesDtoSchema,
  examRegisterBatchReportSchema,
  examRequirementDtoSchema,
  examResultDtoSchema,
  examRevisionRequestDtoSchema,
  examRoomDtoSchema,
  examScoreMatrixSchema,
  examSessionDetailDtoSchema,
  examSessionDtoSchema,
  examSessionInstantiateSchema,
  examStatisticsDtoSchema,
  examTrackDtoSchema,
  examTypeDetailDtoSchema,
  examTypeDtoSchema,
  examValidateReportDtoSchema,
  examIdentifierDtoSchema,
  type ExamBulkResultsBody,
  type ExamBulkScoresBody,
  type ExamCountGroup,
  type ExamCreateExportFormatBody,
  type ExamCreateImportBody,
  type ExamCreateImportFormatBody,
  type ExamCreateSessionBody,
  type ExamCreateTypeBody,
  type ExamDocumentKind,
  type ExamEligibilityBody,
  type ExamPieceActionBody,
  type ExamSessionStatus,
} from "@ecoledigitale/contracts/v2/examinations";
import { useApiAction } from "./actions";

export const EXAMINATIONS_BASE = "/api/v1/examinations";
const KEY = ["examinations"] as const;
type Query = Record<string, string | number | boolean | undefined>;

const SESSIONS = [...KEY, "sessions"] as const;
const CANDIDATES = [...KEY, "candidates"] as const;
const RESULTS = [...KEY, "results"] as const;

// ---------------------------------------------------------------------------
// Types d'examens et données de référence
// ---------------------------------------------------------------------------

export function useExamTypes(enabled = true) {
  return hooks.useApiQuery([...KEY, "types"], `${EXAMINATIONS_BASE}/exam-types`, { schema: examItemsSchema(examTypeDtoSchema), select: (d) => d.items, enabled, retry: false });
}

export function useExamType(id: string | null) {
  return hooks.useApiQuery([...KEY, "types", id], `${EXAMINATIONS_BASE}/exam-types/${id}`, { schema: examTypeDetailDtoSchema, enabled: id !== null, retry: false });
}

export function useInstantiatePack() {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/exam-types/instantiate-pack`, body: (v: { pack: "PRIMARY" }) => v, schema: examPackReportSchema, invalidate: [[...KEY, "types"], [...KEY, "export-formats"], [...KEY, "import-formats"]] });
}

export function useCreateExamType() {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/exam-types`, body: (v: ExamCreateTypeBody) => v, schema: examTypeDtoSchema, invalidate: [[...KEY, "types"]] });
}

export function useCreateTrack(typeId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/exam-types/${typeId}/tracks`, body: (v: { code: string; label: string; sourceKind: "regulation" | "institution" | "platform" | "placeholder" }) => v, schema: examTrackDtoSchema, invalidate: [[...KEY, "types"]] });
}

export function useCreatePaper(typeId: string) {
  return useApiAction({
    path: `${EXAMINATIONS_BASE}/exam-types/${typeId}/papers`,
    body: (v: { trackCode?: string | null; code: string; label: string; coefficient: string; scaleMax: string; isOptional: boolean; ordinal: number; sourceKind: "regulation" | "institution" | "platform" | "placeholder" }) => v,
    schema: examPaperDtoSchema,
    invalidate: [[...KEY, "types"]],
  });
}

export function useCreateRequirement(typeId: string) {
  return useApiAction({
    path: `${EXAMINATIONS_BASE}/exam-types/${typeId}/document-requirements`,
    body: (v: { code: string; label: string; required: boolean; sortOrder: number; sourceKind: "regulation" | "institution" | "platform" | "placeholder" }) => v,
    schema: examRequirementDtoSchema,
    invalidate: [[...KEY, "types"]],
  });
}

// ---------------------------------------------------------------------------
// Centres et salles
// ---------------------------------------------------------------------------

export function useExamCenters(enabled = true) {
  return hooks.useApiQuery([...KEY, "centers"], `${EXAMINATIONS_BASE}/centers`, { schema: examItemsSchema(examCenterDtoSchema), select: (d) => d.items, enabled, retry: false });
}

export function useCreateCenter() {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/centers`, body: (v: { code: string; name: string; kind: "OWN" | "HOST"; authorityCode?: string | null; locality?: string | null }) => v, schema: examCenterDtoSchema, invalidate: [[...KEY, "centers"]] });
}

export function useUpdateCenter(id: string) {
  return useApiAction({ method: "PATCH", path: `${EXAMINATIONS_BASE}/centers/${id}`, body: (v: { name?: string; status?: "ACTIVE" | "INACTIVE" }) => v, schema: examCenterDtoSchema, invalidate: [[...KEY, "centers"]] });
}

export function useCreateRoom(centerId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/centers/${centerId}/rooms`, body: (v: { code: string; label?: string | null; capacity: number }) => v, schema: examRoomDtoSchema, invalidate: [[...KEY, "centers"], [...KEY, "assignments"]] });
}

export function useUpdateRoom(centerId: string, roomId: string) {
  return useApiAction({ method: "PATCH", path: `${EXAMINATIONS_BASE}/centers/${centerId}/rooms/${roomId}`, body: (v: { capacity?: number; active?: boolean }) => v, schema: examRoomDtoSchema, invalidate: [[...KEY, "centers"], [...KEY, "assignments"]] });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionFilters {
  status?: ExamSessionStatus | undefined;
  sessionKind?: "OFFICIAL" | "MOCK" | undefined;
  examTypeId?: string | undefined;
  sessionYear?: number | undefined;
  page?: number;
  pageSize?: number;
}

export function useExamSessions(filters: SessionFilters = {}, enabled = true) {
  return hooks.useApiQuery([...SESSIONS, "list", filters], `${EXAMINATIONS_BASE}/sessions`, {
    query: { ...filters, pageSize: filters.pageSize ?? 50 } as Query,
    schema: examPageSchema(examSessionDtoSchema),
    enabled,
    retry: false,
  });
}

export function useExamSession(id: string | null) {
  return hooks.useApiQuery([...SESSIONS, "one", id], `${EXAMINATIONS_BASE}/sessions/${id}`, { schema: examSessionDetailDtoSchema, enabled: id !== null, retry: false });
}

export function useCreateSession() {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions`, body: (v: ExamCreateSessionBody) => v, schema: examSessionDtoSchema, invalidate: [SESSIONS] });
}

export function useInstantiateSession(id: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${id}/instantiate`, schema: examSessionInstantiateSchema, invalidate: [SESSIONS] });
}

export function useTransitionSession(id: string) {
  return useApiAction({
    path: `${EXAMINATIONS_BASE}/sessions/${id}/transition`,
    body: (v: { to: ExamSessionStatus }) => v,
    schema: examSessionDtoSchema,
    invalidate: [SESSIONS, CANDIDATES, RESULTS, [...KEY, "assignments"], [...KEY, "statistics"]],
  });
}

// ---------------------------------------------------------------------------
// Candidats, éligibilité, pièces, inscription
// ---------------------------------------------------------------------------

export interface CandidateFilters {
  registrationStatus?: string | undefined;
  eligibilityStatus?: string | undefined;
  outcome?: string | undefined;
  q?: string | undefined;
  page?: number;
  pageSize?: number;
}

export function useExamCandidates(sessionId: string | null, filters: CandidateFilters = {}) {
  return hooks.useApiQuery([...CANDIDATES, "list", sessionId, filters], `${EXAMINATIONS_BASE}/sessions/${sessionId}/candidates`, {
    query: { ...filters, pageSize: filters.pageSize ?? 50 } as Query,
    schema: examPageSchema(examCandidateDtoSchema),
    enabled: sessionId !== null,
    keepPreviousData: true,
    retry: false,
  });
}

export function useExamCandidate(id: string | null) {
  return hooks.useApiQuery([...CANDIDATES, "one", id], `${EXAMINATIONS_BASE}/candidates/${id}`, { schema: examCandidateDetailDtoSchema, enabled: id !== null, retry: false });
}

export function useCandidatesFromClassroom(sessionId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/candidates/from-classroom`, body: (v: { classroomId: string }) => v, schema: examFromClassroomReportSchema, invalidate: [CANDIDATES, SESSIONS] });
}

export function useEvaluateAll(sessionId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/eligibility/evaluate-all`, schema: examEvaluateAllReportSchema, invalidate: [CANDIDATES, SESSIONS] });
}

export function useRegisterBatch(sessionId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/candidates/register-batch`, body: (v: { candidateIds: string[] }) => v, schema: examRegisterBatchReportSchema, invalidate: [CANDIDATES, SESSIONS] });
}

export function useRegisterCandidate() {
  return useApiAction({ path: (id: string) => `${EXAMINATIONS_BASE}/candidates/${id}/register`, schema: examCandidateDtoSchema, invalidate: [CANDIDATES, SESSIONS] });
}

export function useWithdrawCandidate() {
  return useApiAction({ path: (v: { id: string; reason: string }) => `${EXAMINATIONS_BASE}/candidates/${v.id}/withdraw`, body: (v: { id: string; reason: string }) => ({ reason: v.reason }), schema: examCandidateDtoSchema, invalidate: [CANDIDATES, SESSIONS] });
}

export function useEligibility() {
  return useApiAction({
    path: (v: { id: string; body: ExamEligibilityBody }) => `${EXAMINATIONS_BASE}/candidates/${v.id}/eligibility`,
    body: (v: { id: string; body: ExamEligibilityBody }) => v.body,
    schema: examEvaluateOneResultSchema,
    invalidate: [CANDIDATES, SESSIONS],
  });
}

export function useCandidatePieceAction() {
  return useApiAction({
    method: "PUT",
    path: (v: { candidateId: string; requirementId: string; body: ExamPieceActionBody }) => `${EXAMINATIONS_BASE}/candidates/${v.candidateId}/documents/${v.requirementId}`,
    body: (v) => v.body,
    schema: examPiecesDtoSchema,
    invalidate: [CANDIDATES],
  });
}

export function useSetIdentifier() {
  return useApiAction({
    method: "PUT",
    path: (v: { candidateId: string; kind: string; value: string }) => `${EXAMINATIONS_BASE}/candidates/${v.candidateId}/identifiers`,
    body: (v: { candidateId: string; kind: string; value: string }) => ({ kind: v.kind, value: v.value }),
    schema: examIdentifierDtoSchema,
    invalidate: [CANDIDATES],
  });
}

// ---------------------------------------------------------------------------
// Centres de la session et répartition
// ---------------------------------------------------------------------------

export function useAssignments(sessionId: string | null) {
  return hooks.useApiQuery([...KEY, "assignments", sessionId], `${EXAMINATIONS_BASE}/sessions/${sessionId}/centers`, { schema: examAssignmentsOverviewSchema, enabled: sessionId !== null, retry: false });
}

export function useSetSessionCenters(sessionId: string) {
  return useApiAction({ method: "PUT", path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/centers`, body: (v: { centerIds: string[] }) => v, invalidate: [[...KEY, "assignments"]] });
}

export function useAutoAssign(sessionId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/assignments/auto`, body: (v: { reassign: boolean }) => v, schema: examAutoAssignReportSchema, invalidate: [[...KEY, "assignments"], SESSIONS] });
}

export function useAssignCandidate() {
  return useApiAction({
    method: "PUT",
    path: (v: { candidateId: string; centerId: string; roomId: string; seatNumber?: number }) => `${EXAMINATIONS_BASE}/assignments/${v.candidateId}`,
    body: (v: { candidateId: string; centerId: string; roomId: string; seatNumber?: number }) => ({ centerId: v.centerId, roomId: v.roomId, ...(v.seatNumber ? { seatNumber: v.seatNumber } : {}) }),
    schema: examAssignmentDtoSchema,
    invalidate: [[...KEY, "assignments"], CANDIDATES],
  });
}

export function useUnassignCandidate() {
  return useApiAction({ method: "DELETE", path: (candidateId: string) => `${EXAMINATIONS_BASE}/assignments/${candidateId}`, invalidate: [[...KEY, "assignments"], CANDIDATES] });
}

// ---------------------------------------------------------------------------
// Notes, résultats, publication
// ---------------------------------------------------------------------------

export function useScoreMatrix(sessionId: string | null) {
  return hooks.useApiQuery([...KEY, "scores", sessionId], `${EXAMINATIONS_BASE}/sessions/${sessionId}/scores`, { schema: examScoreMatrixSchema, enabled: sessionId !== null, retry: false });
}

export function useSaveScores(sessionId: string) {
  return useApiAction({
    method: "PUT",
    path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/scores/bulk`,
    body: (v: ExamBulkScoresBody) => v,
    schema: examBulkScoresReportSchema,
    invalidate: [[...KEY, "scores"], RESULTS],
  });
}

export interface ResultFilters {
  resultCode?: string | undefined;
  status?: "DRAFT" | "PUBLISHED" | undefined;
  q?: string | undefined;
  page?: number;
  pageSize?: number;
}

export function useExamResults(sessionId: string | null, filters: ResultFilters = {}) {
  return hooks.useApiQuery([...RESULTS, "list", sessionId, filters], `${EXAMINATIONS_BASE}/sessions/${sessionId}/results`, {
    query: { ...filters, pageSize: filters.pageSize ?? 50 } as Query,
    schema: examPageSchema(examResultDtoSchema),
    enabled: sessionId !== null,
    keepPreviousData: true,
    retry: false,
  });
}

export function useSaveResults(sessionId: string) {
  return useApiAction({ method: "PUT", path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/results`, body: (v: ExamBulkResultsBody) => v, schema: examBulkResultsReportSchema, invalidate: [RESULTS, CANDIDATES, SESSIONS] });
}

export function usePublishResult() {
  return useApiAction({ path: (id: string) => `${EXAMINATIONS_BASE}/results/${id}/publish`, schema: examResultDtoSchema, invalidate: [RESULTS, SESSIONS] });
}

// ---------------------------------------------------------------------------
// Révisions (quatre yeux)
// ---------------------------------------------------------------------------

export function useRevisionRequests(sessionId: string | null, status?: "PENDING" | "APPROVED" | "REJECTED") {
  return hooks.useApiQuery([...KEY, "revisions", sessionId, status ?? "all"], `${EXAMINATIONS_BASE}/sessions/${sessionId}/revision-requests`, {
    query: { status, pageSize: 100 } as Query,
    schema: examPageSchema(examRevisionRequestDtoSchema),
    enabled: sessionId !== null,
    retry: false,
  });
}

export function useRequestResultRevision() {
  return useApiAction({
    path: (v: { resultId: string; resultCode: string; average: string | null; reason: string }) => `${EXAMINATIONS_BASE}/results/${v.resultId}/revisions`,
    body: (v: { resultId: string; resultCode: string; average: string | null; reason: string }) => ({ resultCode: v.resultCode, average: v.average, reason: v.reason }),
    schema: examRevisionRequestDtoSchema,
    invalidate: [[...KEY, "revisions"]],
  });
}

export function useRequestScoreRevision() {
  return useApiAction({
    path: (v: { scoreId: string; status: string; score: string | null; reason: string }) => `${EXAMINATIONS_BASE}/scores/${v.scoreId}/revisions`,
    body: (v: { scoreId: string; status: string; score: string | null; reason: string }) => ({ status: v.status, score: v.score, reason: v.reason }),
    schema: examRevisionRequestDtoSchema,
    invalidate: [[...KEY, "revisions"]],
  });
}

export function useApproveRevision() {
  return useApiAction({ path: (id: string) => `${EXAMINATIONS_BASE}/revision-requests/${id}/approve`, schema: examRevisionRequestDtoSchema, invalidate: [[...KEY, "revisions"], RESULTS, CANDIDATES, [...KEY, "scores"]] });
}

export function useRejectRevision() {
  return useApiAction({ path: (v: { id: string; note: string }) => `${EXAMINATIONS_BASE}/revision-requests/${v.id}/reject`, body: (v: { id: string; note: string }) => ({ note: v.note }), schema: examRevisionRequestDtoSchema, invalidate: [[...KEY, "revisions"]] });
}

// ---------------------------------------------------------------------------
// Imports de l'autorité
// ---------------------------------------------------------------------------

export function useImportFormats(kind?: "OFFICIAL_NUMBERS" | "SCORES" | "RESULTS", status: "DRAFT" | "PUBLISHED" | "RETIRED" | undefined = "PUBLISHED") {
  return hooks.useApiQuery([...KEY, "import-formats", kind ?? "all", status ?? "all"], `${EXAMINATIONS_BASE}/import-formats`, { query: { kind, status } as Query, schema: examItemsSchema(examImportFormatDtoSchema), select: (d) => d.items, retry: false });
}

export function useCreateImportFormat() {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/import-formats`, body: (v: ExamCreateImportFormatBody) => v, schema: examImportFormatDtoSchema, invalidate: [[...KEY, "import-formats"]] });
}

export function usePublishImportFormat() {
  return useApiAction({ path: (id: string) => `${EXAMINATIONS_BASE}/import-formats/${id}/publish`, schema: examImportFormatDtoSchema, invalidate: [[...KEY, "import-formats"]] });
}

export function useImportBatches(sessionId: string | null) {
  return hooks.useApiQuery([...KEY, "imports", sessionId], `${EXAMINATIONS_BASE}/sessions/${sessionId}/imports`, { schema: examItemsSchema(examBatchDtoSchema), select: (d) => d.items, enabled: sessionId !== null, retry: false });
}

export function useImportBatch(id: string | null, status?: "OK" | "ERROR") {
  return hooks.useApiQuery([...KEY, "imports", "one", id, status ?? "all"], `${EXAMINATIONS_BASE}/imports/${id}`, { query: { status, pageSize: 200 } as Query, schema: examBatchDetailDtoSchema, enabled: id !== null, retry: false });
}

export function useCreateImport(sessionId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/imports`, body: (v: ExamCreateImportBody) => v, schema: examBatchDtoSchema, invalidate: [[...KEY, "imports"]], timeoutMs: 120_000 });
}

export function useValidateImport() {
  return useApiAction({ path: (id: string) => `${EXAMINATIONS_BASE}/imports/${id}/validate`, schema: examValidateReportDtoSchema, invalidate: [[...KEY, "imports"]], timeoutMs: 120_000 });
}

export function useApplyImport() {
  return useApiAction({ path: (id: string) => `${EXAMINATIONS_BASE}/imports/${id}/apply`, schema: examBatchDtoSchema, invalidate: [[...KEY, "imports"], RESULTS, [...KEY, "scores"], CANDIDATES, SESSIONS], timeoutMs: 120_000 });
}

// ---------------------------------------------------------------------------
// Examens blancs
// ---------------------------------------------------------------------------

export function useMockLinks(sessionId: string | null) {
  return hooks.useApiQuery([...KEY, "mock", "links", sessionId], `${EXAMINATIONS_BASE}/sessions/${sessionId}/mock/links`, { schema: examItemsSchema(examLinkDtoSchema), select: (d) => d.items, enabled: sessionId !== null, retry: false });
}

export function useLinkAssessment(sessionId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/mock/link`, body: (v: { paperId: string; classroomId: string; assessmentId: string }) => v, schema: examLinkDtoSchema, invalidate: [[...KEY, "mock"]] });
}

export function useUnlinkAssessment(sessionId: string) {
  return useApiAction({ method: "DELETE", path: (linkId: string) => `${EXAMINATIONS_BASE}/sessions/${sessionId}/mock/links/${linkId}`, invalidate: [[...KEY, "mock"]] });
}

export function useImportFromAssess(sessionId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/mock/import-from-assess`, schema: examImportFromAssessReportSchema, invalidate: [[...KEY, "scores"], RESULTS] });
}

export function useComputeMock(sessionId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/mock/compute`, schema: examComputeMockReportSchema, invalidate: [RESULTS, CANDIDATES, [...KEY, "statistics"]] });
}

// ---------------------------------------------------------------------------
// Statistiques, exports, documents
// ---------------------------------------------------------------------------

export function useExamStatistics(sessionId: string | null, groupBy: ExamCountGroup, compare?: "previous_year" | "mock") {
  return hooks.useApiQuery([...KEY, "statistics", sessionId, groupBy, compare ?? "none"], `${EXAMINATIONS_BASE}/sessions/${sessionId}/statistics`, {
    query: { groupBy, compare } as Query,
    schema: examStatisticsDtoSchema,
    enabled: sessionId !== null,
    retry: false,
  });
}

export function useExportFormats(status: "DRAFT" | "PUBLISHED" | "RETIRED" | undefined = "PUBLISHED") {
  return hooks.useApiQuery([...KEY, "export-formats", status ?? "all"], `${EXAMINATIONS_BASE}/export-formats`, { query: { status } as Query, schema: examItemsSchema(examExportFormatDtoSchema), select: (d) => d.items, retry: false });
}

export function useCreateExportFormat() {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/export-formats`, body: (v: ExamCreateExportFormatBody) => v, schema: examExportFormatDtoSchema, invalidate: [[...KEY, "export-formats"]] });
}

export function usePublishExportFormat() {
  return useApiAction({ path: (id: string) => `${EXAMINATIONS_BASE}/export-formats/${id}/publish`, schema: examExportFormatDtoSchema, invalidate: [[...KEY, "export-formats"]] });
}

export function useExportRuns(sessionId: string | null) {
  return hooks.useApiQuery([...KEY, "exports", sessionId], `${EXAMINATIONS_BASE}/sessions/${sessionId}/exports`, { schema: examItemsSchema(examExportRunDtoSchema), select: (d) => d.items, enabled: sessionId !== null, retry: false });
}

export function useRunExport(sessionId: string) {
  return useApiAction({
    path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/exports`,
    body: (v: { formatId: string; filters?: { groupBy?: ExamCountGroup } }) => ({ formatId: v.formatId, filters: v.filters ?? {} }),
    schema: examExportRunDtoSchema,
    invalidate: [[...KEY, "exports"]],
    timeoutMs: 120_000,
  });
}

/** URL signée COURTE d'un export terminé (la demande est journalisée par l'API) : suivie aussitôt, jamais conservée ni affichée. */
export function fetchExportDownload(id: string) {
  return hooks.client.request("GET", `${EXAMINATIONS_BASE}/exports/${id}/download`, { schema: examExportDownloadDtoSchema });
}

export function useIssuedDocuments(sessionId: string | null, kind?: ExamDocumentKind) {
  return hooks.useApiQuery([...KEY, "documents", sessionId, kind ?? "all"], `${EXAMINATIONS_BASE}/sessions/${sessionId}/issued-documents`, {
    query: { kind, pageSize: 200 } as Query,
    schema: examPageSchema(examIssuedDocumentDtoSchema),
    enabled: sessionId !== null,
    retry: false,
  });
}

export function useIssueBatch(sessionId: string) {
  return useApiAction({ path: `${EXAMINATIONS_BASE}/sessions/${sessionId}/documents/issue-batch`, body: (v: { kind: ExamDocumentKind; candidateIds?: string[] }) => v, schema: examIssueBatchReportSchema, invalidate: [[...KEY, "documents"], CANDIDATES] });
}

export function useIssueDocument() {
  return useApiAction({ path: (v: { candidateId: string; kind: ExamDocumentKind }) => `${EXAMINATIONS_BASE}/candidates/${v.candidateId}/documents/issue`, body: (v: { candidateId: string; kind: ExamDocumentKind }) => ({ kind: v.kind }), schema: examIssuedDocumentDtoSchema, invalidate: [[...KEY, "documents"], CANDIDATES] });
}

export function useRevokeDocument() {
  return useApiAction({ path: (v: { id: string; reason: string }) => `${EXAMINATIONS_BASE}/issued-documents/${v.id}/revoke`, body: (v: { id: string; reason: string }) => ({ reason: v.reason }), schema: examIssuedDocumentDtoSchema, invalidate: [[...KEY, "documents"], CANDIDATES] });
}

/** Chemin du PDF scellé d'un document : le client le télécharge avec le jeton (jamais d'URL publique). */
export const issuedDocumentFilePath = (id: string): string => `${EXAMINATIONS_BASE}/issued-documents/${id}/file`;
export const familyDocumentFilePath = (id: string): string => `${EXAMINATIONS_BASE}/family/exam-documents/${id}/file`;

// ---------------------------------------------------------------------------
// Famille
// ---------------------------------------------------------------------------

export function useMyExams(enabled = true) {
  return hooks.useApiQuery([...KEY, "me", "exams"], `${EXAMINATIONS_BASE}/me/exams`, { schema: examItemsSchema(examFamilyExamDtoSchema), select: (d) => d.items, enabled, retry: false });
}

export function useChildrenExams(enabled = true) {
  return hooks.useApiQuery([...KEY, "family", "exams"], `${EXAMINATIONS_BASE}/family/exams`, { schema: examItemsSchema(examFamilyExamDtoSchema), select: (d) => d.items, enabled, retry: false });
}
