"use client";

/**
 * Hooks typés du module `attendance` (`/api/v1/attendance/*`). Schémas Zod de `packages/contracts/src/v2/attendance.ts`.
 * AUCUNE règle métier côté client : statuts, fenêtres de correction, couverture des justificatifs, recalcul des
 * récapitulatifs, détection des conflits de synchronisation sont décidés par l'API ; l'écran affiche ce qui revient.
 */

import { z } from "zod";
import { platformApi, platformHooks as hooks } from "@/platform/api/default-client";
import {
  attendanceAbsencesPageDtoSchema,
  attendanceAttachmentDtoSchema,
  attendanceCallPolicyDtoSchema,
  attendanceCertificateDtoSchema,
  attendanceClassroomSummaryDtoSchema,
  attendanceComplianceDtoSchema,
  attendanceJustificationDtoSchema,
  attendanceLeaveDtoSchema,
  attendanceLeaveTypeDtoSchema,
  attendanceMarkResultDtoSchema,
  attendanceOpenSessionResultDtoSchema,
  attendancePortalDtoSchema,
  attendanceReasonDtoSchema,
  attendanceRecordDtoSchema,
  attendanceRecordHistoryDtoSchema,
  attendanceSessionDetailDtoSchema,
  attendanceSessionDtoSchema,
  attendanceSettingsDtoSchema,
  attendanceSignedUrlDtoSchema,
  attendanceStaffRecordDtoSchema,
  attendanceStaffSummaryDtoSchema,
  attendanceStatusDefinitionDtoSchema,
  attendanceSummaryDtoSchema,
  attendanceSyncConflictDtoSchema,
  attendanceUpsertSettingsBodySchema,
  type AttendanceMarkEntry,
  type AttendanceOpenSessionBody,
} from "@ecoledigitale/contracts/v2/attendance";
import { useApiAction } from "./actions";
import { omit } from "./omit";

export const ATTENDANCE_BASE = "/api/v1/attendance";

type Query = Record<string, string | number | boolean | undefined>;
const cursorPage = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });
const itemsOf = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });
const pickItems = <T>(d: { items: T[] }) => d.items;

const KEY = ["attendance"] as const;

// ---------------------------------------------------------------------------
// Référentiels (statuts, motifs, types de congé, politiques, paramètres)
// ---------------------------------------------------------------------------

export function useStatusDefinitions(enabled = true) {
  return hooks.useApiQuery([...KEY, "ref", "statuses"], `${ATTENDANCE_BASE}/reference/status-definitions`, {
    schema: itemsOf(attendanceStatusDefinitionDtoSchema),
    select: pickItems,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useJustificationReasons(enabled = true) {
  return hooks.useApiQuery([...KEY, "ref", "reasons"], `${ATTENDANCE_BASE}/reference/justification-reasons`, { schema: itemsOf(attendanceReasonDtoSchema), select: pickItems, enabled, staleTime: 5 * 60_000, retry: false });
}

export function useLeaveTypes(enabled = true) {
  return hooks.useApiQuery([...KEY, "ref", "leave-types"], `${ATTENDANCE_BASE}/reference/leave-types`, { schema: itemsOf(attendanceLeaveTypeDtoSchema), select: pickItems, enabled, staleTime: 5 * 60_000, retry: false });
}

export function useCallPolicies(enabled = true) {
  return hooks.useApiQuery([...KEY, "ref", "call-policies"], `${ATTENDANCE_BASE}/reference/call-policies`, { schema: itemsOf(attendanceCallPolicyDtoSchema), select: pickItems, enabled, retry: false });
}

export function useAttendanceSettings(enabled = true) {
  return hooks.useApiQuery([...KEY, "ref", "settings"], `${ATTENDANCE_BASE}/reference/settings`, { schema: attendanceSettingsDtoSchema, enabled, retry: false });
}

export function useUpsertAttendanceSettings() {
  return useApiAction({
    method: "PUT",
    path: `${ATTENDANCE_BASE}/reference/settings`,
    body: (v: z.input<typeof attendanceUpsertSettingsBodySchema>) => v,
    schema: attendanceSettingsDtoSchema,
    invalidate: [[...KEY, "ref", "settings"]],
  });
}

// ---------------------------------------------------------------------------
// Séances d'appel
// ---------------------------------------------------------------------------

export interface SessionsQuery {
  classroomId?: string;
  date?: string;
  from?: string;
  to?: string;
  status?: "OPEN" | "SUBMITTED" | "VALIDATED" | "CANCELLED";
  staffId?: string;
  occurrenceId?: string;
  limit?: number;
  cursor?: string;
}

export function useAttendanceSessions(query: SessionsQuery, options: { enabled?: boolean } = {}) {
  return hooks.useApiQuery([...KEY, "sessions", "list"], `${ATTENDANCE_BASE}/sessions`, { schema: cursorPage(attendanceSessionDtoSchema), query: query as Query, enabled: options.enabled, retry: false });
}

/** Liste paginée par curseur (suivi des appels) : « Afficher plus » accumule les pages. */
export function useAttendanceSessionsInfinite(query: SessionsQuery, enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "sessions", "list"], `${ATTENDANCE_BASE}/sessions`, {
    query: query as Query,
    schema: cursorPage(attendanceSessionDtoSchema),
    getNextCursor: (p) => p.nextCursor,
    enabled,
    retry: false,
  });
}

export function useAttendanceSession(id: string | null) {
  return hooks.useApiQuery([...KEY, "sessions", "one", id], `${ATTENDANCE_BASE}/sessions/${id}`, { schema: attendanceSessionDetailDtoSchema, enabled: id !== null, retry: false });
}

export function useOpenAttendanceSession() {
  return useApiAction({
    path: `${ATTENDANCE_BASE}/sessions`,
    body: (v: AttendanceOpenSessionBody) => v,
    schema: attendanceOpenSessionResultDtoSchema,
    invalidate: [[...KEY, "sessions"]],
  });
}

export function useMarkRecords() {
  return useApiAction({
    method: "PUT",
    path: (v: { sessionId: string; entries: AttendanceMarkEntry[] }) => `${ATTENDANCE_BASE}/sessions/${v.sessionId}/records`,
    body: (v) => ({ entries: v.entries }),
    schema: attendanceMarkResultDtoSchema,
    invalidate: [[...KEY, "sessions"]],
  });
}

export function useMarkWithJustification() {
  return useApiAction({
    path: (v: { sessionId: string; studentId: string; reasonCode: string; comment?: string }) => `${ATTENDANCE_BASE}/sessions/${v.sessionId}/records/with-justification`,
    body: (v) => omit(v, "sessionId"),
    schema: z.object({ record: attendanceRecordDtoSchema, justification: attendanceJustificationDtoSchema }),
    invalidate: [[...KEY, "sessions"], [...KEY, "justifications"]],
  });
}

const submitResultSchema = z.object({ session: attendanceSessionDtoSchema, alreadySubmitted: z.boolean(), filledByDefault: z.number().int(), absentCount: z.number().int(), lateCount: z.number().int() });
export type SubmitSessionResult = z.infer<typeof submitResultSchema>;

export function useSubmitAttendanceSession() {
  return useApiAction({
    path: (v: { sessionId: string; defaultStatus?: string; allPresent?: boolean }) => `${ATTENDANCE_BASE}/sessions/${v.sessionId}/submit`,
    body: (v) => omit(v, "sessionId"),
    schema: submitResultSchema,
    invalidate: [[...KEY, "sessions"]],
  });
}

export function useValidateAttendanceSession() {
  return useApiAction({ path: (v: { sessionId: string }) => `${ATTENDANCE_BASE}/sessions/${v.sessionId}/validate`, body: () => ({}), schema: attendanceSessionDtoSchema, invalidate: [[...KEY, "sessions"]] });
}

export function useReopenAttendanceSession() {
  return useApiAction({
    path: (v: { sessionId: string; reason: string }) => `${ATTENDANCE_BASE}/sessions/${v.sessionId}/reopen`,
    body: (v) => ({ reason: v.reason }),
    schema: attendanceSessionDtoSchema,
    invalidate: [[...KEY, "sessions"]],
  });
}

export function useCancelAttendanceSession() {
  return useApiAction({
    path: (v: { sessionId: string; reason: string }) => `${ATTENDANCE_BASE}/sessions/${v.sessionId}/cancel`,
    body: (v) => ({ reason: v.reason }),
    schema: attendanceSessionDtoSchema,
    invalidate: [[...KEY, "sessions"]],
  });
}

export function useRecordHistory(sessionId: string | null, recordId: string | null) {
  return hooks.useApiQuery([...KEY, "history", sessionId, recordId], `${ATTENDANCE_BASE}/sessions/${sessionId}/records/${recordId}/history`, {
    schema: attendanceRecordHistoryDtoSchema,
    select: (d) => d.items,
    enabled: sessionId !== null && recordId !== null,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Conflits de synchronisation (arbitrage)
// ---------------------------------------------------------------------------

export function useSyncConflicts(query: { status?: "OPEN" | "RESOLVED"; sessionId?: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "conflicts"], `${ATTENDANCE_BASE}/sync/conflicts`, { schema: cursorPage(attendanceSyncConflictDtoSchema), query: query as Query, enabled, retry: false });
}

export function useResolveSyncConflict() {
  return useApiAction({
    path: (v: { id: string; resolution: "ACCEPT_INCOMING" | "KEEP_EXISTING"; note?: string }) => `${ATTENDANCE_BASE}/sync/conflicts/${v.id}/resolve`,
    body: (v) => omit(v, "id"),
    schema: attendanceSyncConflictDtoSchema,
    invalidate: [[...KEY, "conflicts"], [...KEY, "sessions"]],
  });
}

// ---------------------------------------------------------------------------
// Justificatifs
// ---------------------------------------------------------------------------

export interface JustificationsQuery {
  studentId?: string;
  status?: "PENDING" | "ACCEPTED" | "REJECTED" | "WITHDRAWN" | "REVOKED";
  from?: string;
  to?: string;
  limit?: number;
}

export function useJustifications(query: JustificationsQuery, enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "justifications", "list"], `${ATTENDANCE_BASE}/justifications`, {
    query: query as Query,
    schema: cursorPage(attendanceJustificationDtoSchema),
    getNextCursor: (p) => p.nextCursor,
    enabled,
    retry: false,
  });
}

export function useJustification(id: string | null) {
  return hooks.useApiQuery([...KEY, "justifications", "one", id], `${ATTENDANCE_BASE}/justifications/${id}`, { schema: attendanceJustificationDtoSchema, enabled: id !== null, retry: false });
}

const JUSTIF_KEYS = [[...KEY, "justifications"], [...KEY, "absences"], [...KEY, "portal"], [...KEY, "summary"]] as const;

export function useSubmitJustification() {
  return useApiAction({
    path: `${ATTENDANCE_BASE}/justifications`,
    body: (v: { studentId: string; fromDate: string; toDate: string; reasonCode: string; comment?: string }) => v,
    schema: attendanceJustificationDtoSchema,
    invalidate: JUSTIF_KEYS,
  });
}

export function useAcceptJustification() {
  return useApiAction({
    path: (v: { id: string; note?: string }) => `${ATTENDANCE_BASE}/justifications/${v.id}/accept`,
    body: (v) => (v.note ? { note: v.note } : {}),
    schema: attendanceJustificationDtoSchema,
    invalidate: JUSTIF_KEYS,
  });
}

export function useRejectJustification() {
  return useApiAction({ path: (v: { id: string; note: string }) => `${ATTENDANCE_BASE}/justifications/${v.id}/reject`, body: (v) => ({ note: v.note }), schema: attendanceJustificationDtoSchema, invalidate: JUSTIF_KEYS });
}

export function useRevokeJustification() {
  return useApiAction({ path: (v: { id: string; reason: string }) => `${ATTENDANCE_BASE}/justifications/${v.id}/revoke`, body: (v) => ({ reason: v.reason }), schema: attendanceJustificationDtoSchema, invalidate: JUSTIF_KEYS });
}

export function useWithdrawJustification() {
  return useApiAction({ path: (v: { id: string }) => `${ATTENDANCE_BASE}/justifications/${v.id}/withdraw`, body: () => ({}), schema: attendanceJustificationDtoSchema, invalidate: JUSTIF_KEYS });
}

export function useAttachJustificationDocument() {
  return useApiAction({
    path: (v: { id: string; fileName: string; contentBase64: string }) => `${ATTENDANCE_BASE}/justifications/${v.id}/attachments`,
    body: (v) => omit(v, "id"),
    schema: attendanceAttachmentDtoSchema,
    invalidate: [[...KEY, "justifications"]],
  });
}

export function useRemoveJustificationAttachment() {
  return useApiAction({
    method: "DELETE",
    path: (v: { id: string; attachmentId: string }) => `${ATTENDANCE_BASE}/justifications/${v.id}/attachments/${v.attachmentId}`,
    invalidate: [[...KEY, "justifications"]],
  });
}

/** Lien signé court vers une pièce (lecture auditée côté serveur) : appelé à la demande, jamais préchargé. */
export function fetchAttachmentUrl(justificationId: string, attachmentId: string) {
  return platformApi.get(`${ATTENDANCE_BASE}/justifications/${justificationId}/attachments/${attachmentId}`, { schema: attendanceSignedUrlDtoSchema });
}

/** Lit un fichier choisi par l'utilisateur en base64 (le type réel est contrôlé par le serveur, octets magiques). */
export function readFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Lecture du fichier impossible."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// Récapitulatifs, surcharge, rapports
// ---------------------------------------------------------------------------

export function useClassroomSummary(classroomId: string | null, periodId: string | null) {
  return hooks.useApiQuery([...KEY, "summary", "classroom", classroomId, periodId], `${ATTENDANCE_BASE}/classrooms/${classroomId}/summary`, {
    schema: attendanceClassroomSummaryDtoSchema,
    query: { periodId: periodId ?? undefined },
    enabled: classroomId !== null && periodId !== null,
    retry: false,
  });
}

export function useSetSummaryOverride() {
  return useApiAction({
    method: "PUT",
    path: `${ATTENDANCE_BASE}/summary-overrides`,
    body: (v: { enrollmentId: string; periodId: string; absentMinutes: number; excusedMinutes: number; reason: string }) => v,
    schema: attendanceSummaryDtoSchema,
    invalidate: [[...KEY, "summary"], [...KEY, "portal"]],
  });
}

export function useRemoveSummaryOverride() {
  return useApiAction({
    method: "DELETE",
    path: `${ATTENDANCE_BASE}/summary-overrides`,
    query: (v: { enrollmentId: string; periodId: string; reason?: string }) => ({ enrollmentId: v.enrollmentId, periodId: v.periodId, reason: v.reason }),
    schema: attendanceSummaryDtoSchema,
    invalidate: [[...KEY, "summary"], [...KEY, "portal"]],
  });
}

export function useRecomputeSummaries() {
  return useApiAction({
    path: `${ATTENDANCE_BASE}/summaries/recompute`,
    body: (v: { enrollmentId?: string; periodId?: string }) => v,
    invalidate: [[...KEY, "summary"]],
  });
}

export interface AbsencesQuery {
  studentId?: string;
  classroomId?: string;
  periodId?: string;
  from?: string;
  to?: string;
  statusCode?: string;
  excused?: boolean;
  limit?: number;
}

export function useAbsencesReport(query: AbsencesQuery, enabled = true) {
  return hooks.useApiInfiniteQuery([...KEY, "absences"], `${ATTENDANCE_BASE}/reports/absences`, {
    query: { ...query, excused: query.excused === undefined ? undefined : String(query.excused) } as Query,
    schema: attendanceAbsencesPageDtoSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled,
    retry: false,
  });
}

/** Export CSV (audité côté serveur, 5 000 lignes au plus) : renvoie le texte du fichier. */
export function fetchAbsencesCsv(query: AbsencesQuery): Promise<string> {
  return platformApi.get<string>(`${ATTENDANCE_BASE}/reports/absences`, {
    query: { ...query, excused: query.excused === undefined ? undefined : String(query.excused), format: "csv" } as Query,
    responseType: "text",
  });
}

export function useCallCompliance(query: { from: string; to: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "compliance"], `${ATTENDANCE_BASE}/reports/call-compliance`, { schema: attendanceComplianceDtoSchema, query, enabled, retry: false });
}

export function useCertificateData(studentId: string | null, periodId: string | null) {
  return hooks.useApiQuery([...KEY, "certificate", studentId, periodId], `${ATTENDANCE_BASE}/students/${studentId}/certificate-data`, {
    schema: attendanceCertificateDtoSchema,
    query: { periodId: periodId ?? undefined },
    enabled: studentId !== null && periodId !== null,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Portails (élève, parent)
// ---------------------------------------------------------------------------

export function useMyAttendance(query: { periodId?: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "portal", "me"], `${ATTENDANCE_BASE}/me/attendance`, { schema: attendancePortalDtoSchema, query, enabled, retry: false });
}

export function useChildAttendance(studentId: string | null, query: { periodId?: string }) {
  return hooks.useApiQuery([...KEY, "portal", "child", studentId], `${ATTENDANCE_BASE}/children/${studentId}/attendance`, { schema: attendancePortalDtoSchema, query, enabled: studentId !== null, retry: false });
}

/** Pointages d'un élève (fiche d'absences). */
export function useStudentRecords(studentId: string | null, query: { from?: string; to?: string } = {}) {
  return hooks.useApiInfiniteQuery([...KEY, "student-records", studentId], `${ATTENDANCE_BASE}/students/${studentId}/records`, {
    query: query as Query,
    schema: attendanceAbsencesPageDtoSchema,
    getNextCursor: (p) => p.nextCursor,
    enabled: studentId !== null,
    retry: false,
  });
}

export function useStudentSummary(studentId: string | null, periodId: string | null) {
  return hooks.useApiQuery([...KEY, "summary", "student", studentId, periodId], `${ATTENDANCE_BASE}/students/${studentId}/summary`, {
    schema: attendanceSummaryDtoSchema,
    query: { periodId: periodId ?? undefined },
    enabled: studentId !== null && periodId !== null,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Personnel : présence et congés (fonction `attendance.staff`)
// ---------------------------------------------------------------------------

export function useMyStaffAttendance(enabled = true) {
  return hooks.useApiQuery([...KEY, "staff", "me"], `${ATTENDANCE_BASE}/me/staff-attendance`, {
    schema: z.object({ records: z.array(attendanceStaffRecordDtoSchema), leaves: z.array(attendanceLeaveDtoSchema), nextCursor: z.string().nullable() }),
    enabled,
    retry: false,
  });
}

export function useStaffRecords(query: { from: string; to: string; staffId?: string; statusCode?: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "staff", "records"], `${ATTENDANCE_BASE}/staff/records`, { schema: cursorPage(attendanceStaffRecordDtoSchema), query: query as Query, enabled, retry: false });
}

export function useStaffAttendanceSummary(query: { from: string; to: string; staffId?: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "staff", "summary"], `${ATTENDANCE_BASE}/reports/staff-summary`, { schema: attendanceStaffSummaryDtoSchema, query: query as Query, enabled, retry: false });
}

export function useStaffLeaves(query: { staffId?: string; status?: "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED"; from?: string; to?: string }, enabled = true) {
  return hooks.useApiQuery([...KEY, "staff", "leaves"], `${ATTENDANCE_BASE}/staff/leaves`, { schema: cursorPage(attendanceLeaveDtoSchema), query: query as Query, enabled, retry: false });
}

const staffRecordResult = z.object({ record: attendanceStaffRecordDtoSchema, replayed: z.boolean() });

export function useMarkStaffAttendance() {
  return useApiAction({
    method: "PUT",
    path: `${ATTENDANCE_BASE}/staff/records`,
    body: (v: { staffId: string; workDate: string; statusCode: string; minutesLate?: number; note?: string; overrideLeave?: boolean }) => v,
    schema: staffRecordResult,
    invalidate: [[...KEY, "staff"]],
  });
}

export function useStaffCheckIn() {
  return useApiAction({ path: `${ATTENDANCE_BASE}/staff/check-in`, body: (v: { staffId?: string; statusCode?: "PRESENT" | "LATE"; minutesLate?: number } | void) => v ?? {}, schema: staffRecordResult, invalidate: [[...KEY, "staff"]] });
}

export function useStaffCheckOut() {
  return useApiAction({ path: `${ATTENDANCE_BASE}/staff/check-out`, body: (v: { staffId?: string } | void) => v ?? {}, schema: staffRecordResult, invalidate: [[...KEY, "staff"]] });
}

export function useRequestLeave() {
  return useApiAction({
    path: `${ATTENDANCE_BASE}/staff/leaves`,
    body: (v: { staffId?: string; leaveTypeCode: string; startsOn: string; endsOn: string; halfDayStart?: boolean; halfDayEnd?: boolean; reason?: string }) => v,
    schema: attendanceLeaveDtoSchema,
    invalidate: [[...KEY, "staff"]],
  });
}

export function useLeaveDecision(action: "approve" | "cancel") {
  return useApiAction({
    path: (v: { id: string; note?: string }) => `${ATTENDANCE_BASE}/staff/leaves/${v.id}/${action}`,
    body: (v) => (v.note ? { note: v.note } : {}),
    schema: attendanceLeaveDtoSchema,
    invalidate: [[...KEY, "staff"]],
  });
}

export function useRejectLeave() {
  return useApiAction({
    path: (v: { id: string; note: string }) => `${ATTENDANCE_BASE}/staff/leaves/${v.id}/reject`,
    body: (v) => ({ note: v.note }),
    schema: attendanceLeaveDtoSchema,
    invalidate: [[...KEY, "staff"]],
  });
}
