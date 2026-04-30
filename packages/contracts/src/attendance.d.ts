import { z } from "zod";
export declare const AttendanceStatusSchema: z.ZodEnum<["present", "absent", "late", "excused", "medical_leave"]>;
export declare const SessionTypeSchema: z.ZodEnum<["theory", "practical", "exam", "evaluation", "regular", "makeup", "field_trip", "lab"]>;
export declare const SessionStatusSchema: z.ZodEnum<["scheduled", "in_progress", "completed", "cancelled"]>;
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;
export type SessionType = z.infer<typeof SessionTypeSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export declare const AttendanceSessionSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    classCourseId: z.ZodString;
    teacherId: z.ZodString;
    sessionDate: z.ZodDate;
    sessionTime: z.ZodString;
    durationMinutes: z.ZodDefault<z.ZodNumber>;
    sessionType: z.ZodDefault<z.ZodEnum<["theory", "practical", "exam", "evaluation", "regular", "makeup", "field_trip", "lab"]>>;
    location: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["scheduled", "in_progress", "completed", "cancelled"]>>;
    startedAt: z.ZodOptional<z.ZodDate>;
    completedAt: z.ZodOptional<z.ZodDate>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    status: "completed" | "cancelled" | "scheduled" | "in_progress";
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    teacherId: string;
    sessionDate: Date;
    sessionType: "theory" | "practical" | "exam" | "evaluation" | "regular" | "makeup" | "field_trip" | "lab";
    classCourseId: string;
    sessionTime: string;
    durationMinutes: number;
    location?: string | undefined;
    notes?: string | undefined;
    startedAt?: Date | undefined;
    completedAt?: Date | undefined;
}, {
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    teacherId: string;
    sessionDate: Date;
    classCourseId: string;
    sessionTime: string;
    location?: string | undefined;
    status?: "completed" | "cancelled" | "scheduled" | "in_progress" | undefined;
    sessionType?: "theory" | "practical" | "exam" | "evaluation" | "regular" | "makeup" | "field_trip" | "lab" | undefined;
    notes?: string | undefined;
    durationMinutes?: number | undefined;
    startedAt?: Date | undefined;
    completedAt?: Date | undefined;
}>;
export declare const CreateAttendanceSessionSchema: z.ZodObject<{
    classCourseId: z.ZodString;
    teacherId: z.ZodString;
    sessionDate: z.ZodString;
    sessionTime: z.ZodString;
    durationMinutes: z.ZodDefault<z.ZodNumber>;
    sessionType: z.ZodDefault<z.ZodEnum<["theory", "practical", "exam", "evaluation", "regular", "makeup", "field_trip", "lab"]>>;
    location: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    teacherId: string;
    sessionDate: string;
    sessionType: "theory" | "practical" | "exam" | "evaluation" | "regular" | "makeup" | "field_trip" | "lab";
    classCourseId: string;
    sessionTime: string;
    durationMinutes: number;
    location?: string | undefined;
    notes?: string | undefined;
}, {
    teacherId: string;
    sessionDate: string;
    classCourseId: string;
    sessionTime: string;
    location?: string | undefined;
    sessionType?: "theory" | "practical" | "exam" | "evaluation" | "regular" | "makeup" | "field_trip" | "lab" | undefined;
    notes?: string | undefined;
    durationMinutes?: number | undefined;
}>;
export declare const UpdateAttendanceSessionSchema: z.ZodObject<{
    sessionDate: z.ZodOptional<z.ZodString>;
    sessionTime: z.ZodOptional<z.ZodString>;
    durationMinutes: z.ZodOptional<z.ZodNumber>;
    sessionType: z.ZodOptional<z.ZodEnum<["theory", "practical", "exam", "evaluation", "regular", "makeup", "field_trip", "lab"]>>;
    location: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["scheduled", "in_progress", "completed", "cancelled"]>>;
}, "strip", z.ZodTypeAny, {
    location?: string | undefined;
    status?: "completed" | "cancelled" | "scheduled" | "in_progress" | undefined;
    sessionDate?: string | undefined;
    sessionType?: "theory" | "practical" | "exam" | "evaluation" | "regular" | "makeup" | "field_trip" | "lab" | undefined;
    notes?: string | undefined;
    sessionTime?: string | undefined;
    durationMinutes?: number | undefined;
}, {
    location?: string | undefined;
    status?: "completed" | "cancelled" | "scheduled" | "in_progress" | undefined;
    sessionDate?: string | undefined;
    sessionType?: "theory" | "practical" | "exam" | "evaluation" | "regular" | "makeup" | "field_trip" | "lab" | undefined;
    notes?: string | undefined;
    sessionTime?: string | undefined;
    durationMinutes?: number | undefined;
}>;
export declare const StudentAttendanceSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    sessionId: z.ZodString;
    studentId: z.ZodString;
    attendanceStatus: z.ZodEnum<["present", "absent", "late", "excused", "medical_leave"]>;
    arrivalTime: z.ZodOptional<z.ZodString>;
    departureTime: z.ZodOptional<z.ZodString>;
    excuseReason: z.ZodOptional<z.ZodString>;
    excuseDocumentUrl: z.ZodOptional<z.ZodString>;
    markedBy: z.ZodString;
    markedAt: z.ZodDate;
    isMakeup: z.ZodDefault<z.ZodBoolean>;
    notes: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    studentId: string;
    sessionId: string;
    attendanceStatus: "present" | "absent" | "late" | "excused" | "medical_leave";
    markedBy: string;
    markedAt: Date;
    isMakeup: boolean;
    notes?: string | undefined;
    arrivalTime?: string | undefined;
    departureTime?: string | undefined;
    excuseReason?: string | undefined;
    excuseDocumentUrl?: string | undefined;
}, {
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    studentId: string;
    sessionId: string;
    attendanceStatus: "present" | "absent" | "late" | "excused" | "medical_leave";
    markedBy: string;
    markedAt: Date;
    notes?: string | undefined;
    arrivalTime?: string | undefined;
    departureTime?: string | undefined;
    excuseReason?: string | undefined;
    excuseDocumentUrl?: string | undefined;
    isMakeup?: boolean | undefined;
}>;
export declare const CreateStudentAttendanceSchema: z.ZodObject<{
    studentId: z.ZodString;
    attendanceStatus: z.ZodEnum<["present", "absent", "late", "excused", "medical_leave"]>;
    arrivalTime: z.ZodOptional<z.ZodString>;
    departureTime: z.ZodOptional<z.ZodString>;
    excuseReason: z.ZodOptional<z.ZodString>;
    excuseDocumentUrl: z.ZodOptional<z.ZodString>;
    isMakeup: z.ZodDefault<z.ZodBoolean>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    studentId: string;
    attendanceStatus: "present" | "absent" | "late" | "excused" | "medical_leave";
    isMakeup: boolean;
    notes?: string | undefined;
    arrivalTime?: string | undefined;
    departureTime?: string | undefined;
    excuseReason?: string | undefined;
    excuseDocumentUrl?: string | undefined;
}, {
    studentId: string;
    attendanceStatus: "present" | "absent" | "late" | "excused" | "medical_leave";
    notes?: string | undefined;
    arrivalTime?: string | undefined;
    departureTime?: string | undefined;
    excuseReason?: string | undefined;
    excuseDocumentUrl?: string | undefined;
    isMakeup?: boolean | undefined;
}>;
export declare const UpdateStudentAttendanceSchema: z.ZodObject<{
    attendanceStatus: z.ZodOptional<z.ZodEnum<["present", "absent", "late", "excused", "medical_leave"]>>;
    arrivalTime: z.ZodOptional<z.ZodString>;
    departureTime: z.ZodOptional<z.ZodString>;
    excuseReason: z.ZodOptional<z.ZodString>;
    excuseDocumentUrl: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    notes?: string | undefined;
    attendanceStatus?: "present" | "absent" | "late" | "excused" | "medical_leave" | undefined;
    arrivalTime?: string | undefined;
    departureTime?: string | undefined;
    excuseReason?: string | undefined;
    excuseDocumentUrl?: string | undefined;
}, {
    notes?: string | undefined;
    attendanceStatus?: "present" | "absent" | "late" | "excused" | "medical_leave" | undefined;
    arrivalTime?: string | undefined;
    departureTime?: string | undefined;
    excuseReason?: string | undefined;
    excuseDocumentUrl?: string | undefined;
}>;
export declare const BatchAttendanceRecordSchema: z.ZodObject<{
    studentId: z.ZodString;
    attendanceStatus: z.ZodEnum<["present", "absent", "late", "excused", "medical_leave"]>;
    arrivalTime: z.ZodOptional<z.ZodString>;
    departureTime: z.ZodOptional<z.ZodString>;
    excuseReason: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    studentId: string;
    attendanceStatus: "present" | "absent" | "late" | "excused" | "medical_leave";
    notes?: string | undefined;
    arrivalTime?: string | undefined;
    departureTime?: string | undefined;
    excuseReason?: string | undefined;
}, {
    studentId: string;
    attendanceStatus: "present" | "absent" | "late" | "excused" | "medical_leave";
    notes?: string | undefined;
    arrivalTime?: string | undefined;
    departureTime?: string | undefined;
    excuseReason?: string | undefined;
}>;
export declare const BatchAttendanceSchema: z.ZodObject<{
    attendanceRecords: z.ZodArray<z.ZodObject<{
        studentId: z.ZodString;
        attendanceStatus: z.ZodEnum<["present", "absent", "late", "excused", "medical_leave"]>;
        arrivalTime: z.ZodOptional<z.ZodString>;
        departureTime: z.ZodOptional<z.ZodString>;
        excuseReason: z.ZodOptional<z.ZodString>;
        notes: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        studentId: string;
        attendanceStatus: "present" | "absent" | "late" | "excused" | "medical_leave";
        notes?: string | undefined;
        arrivalTime?: string | undefined;
        departureTime?: string | undefined;
        excuseReason?: string | undefined;
    }, {
        studentId: string;
        attendanceStatus: "present" | "absent" | "late" | "excused" | "medical_leave";
        notes?: string | undefined;
        arrivalTime?: string | undefined;
        departureTime?: string | undefined;
        excuseReason?: string | undefined;
    }>, "many">;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    attendanceRecords: {
        studentId: string;
        attendanceStatus: "present" | "absent" | "late" | "excused" | "medical_leave";
        notes?: string | undefined;
        arrivalTime?: string | undefined;
        departureTime?: string | undefined;
        excuseReason?: string | undefined;
    }[];
    notes?: string | undefined;
}, {
    attendanceRecords: {
        studentId: string;
        attendanceStatus: "present" | "absent" | "late" | "excused" | "medical_leave";
        notes?: string | undefined;
        arrivalTime?: string | undefined;
        departureTime?: string | undefined;
        excuseReason?: string | undefined;
    }[];
    notes?: string | undefined;
}>;
export declare const AttendanceSummarySchema: z.ZodObject<{
    studentId: z.ZodString;
    totalSessions: z.ZodNumber;
    presentCount: z.ZodNumber;
    absentCount: z.ZodNumber;
    lateCount: z.ZodNumber;
    excusedCount: z.ZodNumber;
    medicalLeaveCount: z.ZodNumber;
    attendancePercentage: z.ZodNumber;
    consecutiveAbsences: z.ZodNumber;
    lastSessionDate: z.ZodOptional<z.ZodDate>;
}, "strip", z.ZodTypeAny, {
    studentId: string;
    totalSessions: number;
    presentCount: number;
    absentCount: number;
    lateCount: number;
    excusedCount: number;
    medicalLeaveCount: number;
    attendancePercentage: number;
    consecutiveAbsences: number;
    lastSessionDate?: Date | undefined;
}, {
    studentId: string;
    totalSessions: number;
    presentCount: number;
    absentCount: number;
    lateCount: number;
    excusedCount: number;
    medicalLeaveCount: number;
    attendancePercentage: number;
    consecutiveAbsences: number;
    lastSessionDate?: Date | undefined;
}>;
export declare const ClassAttendanceSummarySchema: z.ZodObject<{
    classCourseId: z.ZodString;
    sessionId: z.ZodString;
    sessionDate: z.ZodDate;
    totalStudents: z.ZodNumber;
    presentCount: z.ZodNumber;
    absentCount: z.ZodNumber;
    lateCount: z.ZodNumber;
    excusedCount: z.ZodNumber;
    attendanceRate: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    sessionDate: Date;
    classCourseId: string;
    sessionId: string;
    presentCount: number;
    absentCount: number;
    lateCount: number;
    excusedCount: number;
    totalStudents: number;
    attendanceRate: number;
}, {
    sessionDate: Date;
    classCourseId: string;
    sessionId: string;
    presentCount: number;
    absentCount: number;
    lateCount: number;
    excusedCount: number;
    totalStudents: number;
    attendanceRate: number;
}>;
export declare const AttendancePatternSchema: z.ZodObject<{
    studentId: z.ZodString;
    weeklyPattern: z.ZodArray<z.ZodObject<{
        dayOfWeek: z.ZodNumber;
        attendanceRate: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        attendanceRate: number;
        dayOfWeek: number;
    }, {
        attendanceRate: number;
        dayOfWeek: number;
    }>, "many">;
    monthlyTrend: z.ZodArray<z.ZodObject<{
        month: z.ZodString;
        attendanceRate: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        attendanceRate: number;
        month: string;
    }, {
        attendanceRate: number;
        month: string;
    }>, "many">;
    riskLevel: z.ZodEnum<["low", "medium", "high"]>;
    recommendations: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    studentId: string;
    weeklyPattern: {
        attendanceRate: number;
        dayOfWeek: number;
    }[];
    monthlyTrend: {
        attendanceRate: number;
        month: string;
    }[];
    riskLevel: "low" | "medium" | "high";
    recommendations: string[];
}, {
    studentId: string;
    weeklyPattern: {
        attendanceRate: number;
        dayOfWeek: number;
    }[];
    monthlyTrend: {
        attendanceRate: number;
        month: string;
    }[];
    riskLevel: "low" | "medium" | "high";
    recommendations: string[];
}>;
export declare const AttendanceSessionQuerySchema: z.ZodObject<{
    classCourseId: z.ZodOptional<z.ZodString>;
    teacherId: z.ZodOptional<z.ZodString>;
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["scheduled", "in_progress", "completed", "cancelled"]>>;
    sessionType: z.ZodOptional<z.ZodEnum<["theory", "practical", "exam", "evaluation", "regular", "makeup", "field_trip", "lab"]>>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    status?: "completed" | "cancelled" | "scheduled" | "in_progress" | undefined;
    teacherId?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
    sessionType?: "theory" | "practical" | "exam" | "evaluation" | "regular" | "makeup" | "field_trip" | "lab" | undefined;
    classCourseId?: string | undefined;
}, {
    status?: "completed" | "cancelled" | "scheduled" | "in_progress" | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    teacherId?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
    sessionType?: "theory" | "practical" | "exam" | "evaluation" | "regular" | "makeup" | "field_trip" | "lab" | undefined;
    classCourseId?: string | undefined;
}>;
export declare const StudentAttendanceQuerySchema: z.ZodObject<{
    sessionId: z.ZodOptional<z.ZodString>;
    studentId: z.ZodOptional<z.ZodString>;
    attendanceStatus: z.ZodOptional<z.ZodEnum<["present", "absent", "late", "excused", "medical_leave"]>>;
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    startDate?: string | undefined;
    endDate?: string | undefined;
    studentId?: string | undefined;
    sessionId?: string | undefined;
    attendanceStatus?: "present" | "absent" | "late" | "excused" | "medical_leave" | undefined;
}, {
    page?: number | undefined;
    limit?: number | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
    studentId?: string | undefined;
    sessionId?: string | undefined;
    attendanceStatus?: "present" | "absent" | "late" | "excused" | "medical_leave" | undefined;
}>;
export type AttendanceSession = z.infer<typeof AttendanceSessionSchema>;
export type CreateAttendanceSession = z.infer<typeof CreateAttendanceSessionSchema>;
export type UpdateAttendanceSession = z.infer<typeof UpdateAttendanceSessionSchema>;
export type StudentAttendance = z.infer<typeof StudentAttendanceSchema>;
export type CreateStudentAttendance = z.infer<typeof CreateStudentAttendanceSchema>;
export type UpdateStudentAttendance = z.infer<typeof UpdateStudentAttendanceSchema>;
export type BatchAttendanceRecord = z.infer<typeof BatchAttendanceRecordSchema>;
export type BatchAttendance = z.infer<typeof BatchAttendanceSchema>;
export type AttendanceSummary = z.infer<typeof AttendanceSummarySchema>;
export type ClassAttendanceSummary = z.infer<typeof ClassAttendanceSummarySchema>;
export type AttendancePattern = z.infer<typeof AttendancePatternSchema>;
export type AttendanceSessionQuery = z.infer<typeof AttendanceSessionQuerySchema>;
export type StudentAttendanceQuery = z.infer<typeof StudentAttendanceQuerySchema>;
//# sourceMappingURL=attendance.d.ts.map