import type { AttendanceSyncBatch, AttendanceSyncResultDto } from "@ecoledigitale/contracts/v2/attendance";

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  session: uuid(5000),
  occurrence: uuid(5100),
  classroom: uuid(300),
  period: uuid(400),
  year: uuid(100),
};

export function sessionDto(over: Record<string, unknown> = {}) {
  return {
    id: IDS.session,
    institutionId: uuid(1),
    academicYearId: IDS.year,
    classroomId: IDS.classroom,
    curriculumNodeId: null,
    offeringId: null,
    occurrenceId: IDS.occurrence,
    scope: "SESSION",
    sessionDate: "2026-10-01",
    startsAt: "2026-10-01T08:00:00.000Z",
    endsAt: "2026-10-01T09:00:00.000Z",
    durationMinutes: 60,
    takenByStaffId: uuid(4000),
    takenByUserId: uuid(9),
    status: "OPEN",
    source: "MANUAL",
    clientId: null,
    submittedAt: null,
    validatedAt: null,
    validatedBy: null,
    reopenedCount: 0,
    note: null,
    createdAt: "2026-10-01T07:50:00.000Z",
    updatedAt: "2026-10-01T07:50:00.000Z",
    ...over,
  };
}

export const STUDENTS = [
  { id: uuid(11), name: "KOUASSI Awa" },
  { id: uuid(12), name: "TRAORE Moussa" },
  { id: uuid(13), name: "DIALLO Fanta" },
];

export function recordDto(studentId: string, statusCode: string, over: Record<string, unknown> = {}) {
  return {
    id: uuid(8000 + Number(studentId.slice(-2))),
    sessionId: IDS.session,
    enrollmentId: uuid(600 + Number(studentId.slice(-2))),
    studentId,
    statusCode,
    originalStatusCode: null,
    excused: false,
    minutesLate: null,
    countedMinutes: null,
    arrivedAt: null,
    leftAt: null,
    justificationId: null,
    note: null,
    markedBy: uuid(9),
    markedAt: "2026-10-01T08:05:00.000Z",
    clientMarkedAt: null,
    sourceDetail: null,
    ...over,
  };
}

export function sessionDetail(over: { session?: Record<string, unknown>; records?: Record<string, ReturnType<typeof recordDto>>; editable?: boolean } = {}) {
  const students = STUDENTS.map((s) => ({ enrollmentId: uuid(600 + Number(s.id.slice(-2))), studentId: s.id, displayName: s.name, inRoster: true, record: over.records?.[s.id] ?? null }));
  const marked = students.filter((s) => s.record).length;
  return {
    session: sessionDto(over.session),
    students,
    counts: { rosterSize: students.length, marked, unmarked: students.length - marked, absent: 0, late: 0 },
    editable: over.editable ?? true,
  };
}

/** Réponse de `POST /sync` construite à partir du lot reçu. */
export function syncAnswer(
  batch: AttendanceSyncBatch,
  decide: (record: { clientId: string; studentId: string }) => "APPLIED" | "UNCHANGED" | "REPLAYED" | "CONFLICT" | "REJECTED" = () => "APPLIED",
  session: Partial<AttendanceSyncResultDto["sessions"][number]> = {},
): AttendanceSyncResultDto {
  const sessions = batch.sessions.map((s) => ({
    clientId: s.clientId,
    outcome: "OPENED" as const,
    sessionId: IDS.session,
    sessionStatus: s.submit ? ("SUBMITTED" as const) : ("OPEN" as const),
    submitted: Boolean(s.submit),
    errorCode: null,
    records: s.records.map((r) => {
      const outcome = decide(r);
      return { clientId: r.clientId, outcome, recordId: outcome === "CONFLICT" ? null : uuid(8100), conflictId: outcome === "CONFLICT" ? uuid(9100) : null, errorCode: outcome === "REJECTED" ? "attendance.invalid_status" : null };
    }),
    ...session,
  }));
  const all = sessions.flatMap((s) => s.records);
  const count = (o: string) => all.filter((r) => r.outcome === o).length;
  return {
    batchId: batch.batchId ?? null,
    receivedAt: batch.clientSentAt,
    sessions,
    totals: { applied: count("APPLIED"), unchanged: count("UNCHANGED"), replayed: count("REPLAYED"), conflicts: count("CONFLICT"), rejected: count("REJECTED") },
  };
}

const counts = (over: Record<string, number> = {}) => ({
  sessionsTotal: 40,
  presentCount: 36,
  absentCount: 3,
  excusedCount: 1,
  lateCount: 2,
  excusedLateCount: 0,
  earlyLeaveCount: 0,
  unmarkedCount: 0,
  absentMinutes: 360,
  excusedMinutes: 120,
  lateMinutes: 25,
  ...over,
});

export function summaryDto(studentId: string, over: Record<string, unknown> = {}) {
  return {
    enrollmentId: uuid(600 + Number(studentId.slice(-2))),
    periodId: IDS.period,
    studentId,
    windowFrom: "2026-09-01",
    windowTo: "2027-01-31",
    derived: counts(),
    override: null,
    effective: counts(),
    overridden: false,
    computedAt: "2026-10-01T02:50:00.000Z",
    ...over,
  };
}

export function justificationDto(over: Record<string, unknown> = {}) {
  return {
    id: uuid(7000),
    studentId: STUDENTS[0]!.id,
    enrollmentId: uuid(611),
    fromDate: "2026-09-28",
    toDate: "2026-09-29",
    reasonCode: "ILLNESS",
    comment: "Fièvre, certificat joint.",
    submittedByKind: "GUARDIAN",
    submittedByUser: uuid(9),
    submittedAt: "2026-09-29T07:00:00.000Z",
    status: "PENDING",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    revokedBy: null,
    revokedAt: null,
    revocationReason: null,
    attachments: [{ id: uuid(7100), justificationId: uuid(7000), fileName: "certificat.pdf", detectedMime: "application/pdf", sizeBytes: 20480, sha256: "a".repeat(64), uploadedBy: uuid(9), uploadedAt: "2026-09-29T07:01:00.000Z" }],
    coveredRecordCount: 0,
    ...over,
  };
}

export function absenceRow(studentId: string, over: Record<string, unknown> = {}) {
  return {
    recordId: uuid(8200 + Number(studentId.slice(-2))),
    sessionId: IDS.session,
    studentId,
    enrollmentId: uuid(600 + Number(studentId.slice(-2))),
    classroomId: IDS.classroom,
    sessionDate: "2026-09-28",
    statusCode: "ABSENT",
    excused: false,
    countedMinutes: 60,
    minutesLate: null,
    justificationId: null,
    ...over,
  };
}

export function conflictDto(over: Record<string, unknown> = {}) {
  return {
    id: uuid(9100),
    kind: "SESSION_LOCKED",
    sessionId: IDS.session,
    enrollmentId: uuid(612),
    studentId: STUDENTS[1]!.id,
    clientOpId: uuid(9200),
    incoming: { statusCode: "ABSENT", clientMarkedAt: "2026-10-01T08:10:00.000Z" },
    existing: { statusCode: "PRESENT", markedAt: "2026-10-01T08:20:00.000Z" },
    deviceId: "web-1",
    submittedBy: uuid(9),
    clientMarkedAt: "2026-10-01T08:10:00.000Z",
    receivedAt: "2026-10-01T10:00:00.000Z",
    status: "OPEN",
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    ...over,
  };
}

export function leaveDto(over: Record<string, unknown> = {}) {
  return {
    id: uuid(9300),
    staffId: uuid(4000),
    leaveTypeCode: "ANNUAL",
    startsOn: "2026-10-12",
    endsOn: "2026-10-16",
    halfDayStart: false,
    halfDayEnd: false,
    reason: "Vacances",
    status: "REQUESTED",
    requestedBy: uuid(9),
    requestedAt: "2026-10-01T09:00:00.000Z",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    documentRef: null,
    ...over,
  };
}
