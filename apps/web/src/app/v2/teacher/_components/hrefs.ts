/** Adresses du portail enseignant (un seul endroit : les écrans partagés reçoivent ces liens en propriétés). */
export const TEACHER_ROOT = "/v2/teacher";
export const TEACHER_CALL_BASE = `${TEACHER_ROOT}/attendance/call`;

export const teacherHref = {
  call: (occurrenceId: string) => `${TEACHER_CALL_BASE}/occurrence/${occurrenceId}`,
  dailyCall: (classroomId: string, date: string) => `${TEACHER_CALL_BASE}/daily/${classroomId}?date=${date}`,
  classroom: (classroomId: string) => `${TEACHER_ROOT}/classes/${classroomId}`,
  assessments: (classroomId?: string) => (classroomId ? `${TEACHER_ROOT}/assessments?classroom=${classroomId}` : `${TEACHER_ROOT}/assessments`),
  assessment: (id: string) => `${TEACHER_ROOT}/assessments/${id}`,
  grades: (id: string) => `${TEACHER_ROOT}/assessments/${id}/grades`,
  payslip: (id: string) => `${TEACHER_ROOT}/payslips/${id}`,
} as const;
