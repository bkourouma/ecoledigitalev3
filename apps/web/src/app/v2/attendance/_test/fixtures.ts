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
