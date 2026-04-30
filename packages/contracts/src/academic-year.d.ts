import { z } from "zod";
export declare const EnrollmentStatusSchema: z.ZodEnum<["active", "suspended", "completed", "dropped", "transferred"]>;
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;
export declare const FeeStructureSchema: z.ZodObject<{
    inscription: z.ZodNumber;
    scolarite: z.ZodNumber;
    annexes: z.ZodNumber;
    autres: z.ZodNumber;
    total: z.ZodNumber;
    currency: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    total: number;
    inscription: number;
    scolarite: number;
    annexes: number;
    autres: number;
    currency: string;
}, {
    total: number;
    inscription: number;
    scolarite: number;
    annexes: number;
    autres: number;
    currency?: string | undefined;
}>;
export type FeeStructure = z.infer<typeof FeeStructureSchema>;
export declare const AcademicYearSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    name: z.ZodString;
    startDate: z.ZodDate;
    endDate: z.ZodDate;
    isActive: z.ZodBoolean;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
}, {
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
}>;
export declare const CreateAcademicYearSchema: z.ZodEffects<z.ZodObject<{
    name: z.ZodString;
    startDate: z.ZodString;
    endDate: z.ZodString;
}, "strip", z.ZodTypeAny, {
    name: string;
    startDate: string;
    endDate: string;
}, {
    name: string;
    startDate: string;
    endDate: string;
}>, {
    name: string;
    startDate: string;
    endDate: string;
}, {
    name: string;
    startDate: string;
    endDate: string;
}>;
export declare const UpdateAcademicYearSchema: z.ZodEffects<z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    startDate: z.ZodOptional<z.ZodString>;
    endDate: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
}, {
    name?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
}>, {
    name?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
}, {
    name?: string | undefined;
    startDate?: string | undefined;
    endDate?: string | undefined;
}>;
export declare const SetActiveAcademicYearSchema: z.ZodObject<{
    academicYearId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    academicYearId: string;
}, {
    academicYearId: string;
}>;
export declare const ClassSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    programmeId: z.ZodString;
    academicYearId: z.ZodString;
    name: z.ZodString;
    code: z.ZodString;
    maxStudents: z.ZodNumber;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    code: string;
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    programmeId: string;
    academicYearId: string;
    maxStudents: number;
}, {
    code: string;
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    programmeId: string;
    academicYearId: string;
    maxStudents: number;
}>;
export declare const CreateClassSchema: z.ZodObject<{
    programmeId: z.ZodString;
    academicYearId: z.ZodString;
    name: z.ZodString;
    code: z.ZodString;
    maxStudents: z.ZodDefault<z.ZodNumber>;
    courseIds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    code: string;
    name: string;
    programmeId: string;
    academicYearId: string;
    maxStudents: number;
    courseIds: string[];
}, {
    code: string;
    name: string;
    programmeId: string;
    academicYearId: string;
    maxStudents?: number | undefined;
    courseIds?: string[] | undefined;
}>;
export declare const UpdateClassSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    code: z.ZodOptional<z.ZodString>;
    maxStudents: z.ZodOptional<z.ZodNumber>;
    courseIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    code?: string | undefined;
    name?: string | undefined;
    maxStudents?: number | undefined;
    courseIds?: string[] | undefined;
}, {
    code?: string | undefined;
    name?: string | undefined;
    maxStudents?: number | undefined;
    courseIds?: string[] | undefined;
}>;
export declare const ClassCourseSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    classId: z.ZodString;
    courseId: z.ZodString;
    isRequired: z.ZodBoolean;
    createdAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    createdAt: Date;
    courseId: string;
    classId: string;
    isRequired: boolean;
}, {
    id: string;
    tenantId: string;
    createdAt: Date;
    courseId: string;
    classId: string;
    isRequired: boolean;
}>;
export declare const StudentEnrollmentSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    studentId: z.ZodString;
    classId: z.ZodString;
    academicYearId: z.ZodString;
    fees: z.ZodObject<{
        inscription: z.ZodNumber;
        scolarite: z.ZodNumber;
        annexes: z.ZodNumber;
        autres: z.ZodNumber;
        total: z.ZodNumber;
        currency: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        total: number;
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency: string;
    }, {
        total: number;
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency?: string | undefined;
    }>;
    enrollmentDate: z.ZodDate;
    status: z.ZodEnum<["active", "suspended", "completed", "dropped", "transferred"]>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    status: "active" | "suspended" | "completed" | "dropped" | "transferred";
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    academicYearId: string;
    classId: string;
    studentId: string;
    fees: {
        total: number;
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency: string;
    };
    enrollmentDate: Date;
}, {
    status: "active" | "suspended" | "completed" | "dropped" | "transferred";
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    academicYearId: string;
    classId: string;
    studentId: string;
    fees: {
        total: number;
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency?: string | undefined;
    };
    enrollmentDate: Date;
}>;
export declare const CreateStudentEnrollmentSchema: z.ZodObject<{
    studentId: z.ZodString;
    classId: z.ZodString;
    academicYearId: z.ZodString;
    fees: z.ZodObject<{
        inscription: z.ZodDefault<z.ZodNumber>;
        scolarite: z.ZodDefault<z.ZodNumber>;
        annexes: z.ZodDefault<z.ZodNumber>;
        autres: z.ZodDefault<z.ZodNumber>;
        currency: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency: string;
    }, {
        inscription?: number | undefined;
        scolarite?: number | undefined;
        annexes?: number | undefined;
        autres?: number | undefined;
        currency?: string | undefined;
    }>;
    enrollmentDate: z.ZodOptional<z.ZodString>;
    status: z.ZodDefault<z.ZodEnum<["active", "suspended", "completed", "dropped", "transferred"]>>;
}, "strip", z.ZodTypeAny, {
    status: "active" | "suspended" | "completed" | "dropped" | "transferred";
    academicYearId: string;
    classId: string;
    studentId: string;
    fees: {
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency: string;
    };
    enrollmentDate?: string | undefined;
}, {
    academicYearId: string;
    classId: string;
    studentId: string;
    fees: {
        inscription?: number | undefined;
        scolarite?: number | undefined;
        annexes?: number | undefined;
        autres?: number | undefined;
        currency?: string | undefined;
    };
    status?: "active" | "suspended" | "completed" | "dropped" | "transferred" | undefined;
    enrollmentDate?: string | undefined;
}>;
export declare const UpdateStudentEnrollmentSchema: z.ZodObject<{
    fees: z.ZodOptional<z.ZodObject<{
        inscription: z.ZodOptional<z.ZodNumber>;
        scolarite: z.ZodOptional<z.ZodNumber>;
        annexes: z.ZodOptional<z.ZodNumber>;
        autres: z.ZodOptional<z.ZodNumber>;
        currency: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        inscription?: number | undefined;
        scolarite?: number | undefined;
        annexes?: number | undefined;
        autres?: number | undefined;
        currency?: string | undefined;
    }, {
        inscription?: number | undefined;
        scolarite?: number | undefined;
        annexes?: number | undefined;
        autres?: number | undefined;
        currency?: string | undefined;
    }>>;
    status: z.ZodOptional<z.ZodEnum<["active", "suspended", "completed", "dropped", "transferred"]>>;
}, "strip", z.ZodTypeAny, {
    status?: "active" | "suspended" | "completed" | "dropped" | "transferred" | undefined;
    fees?: {
        inscription?: number | undefined;
        scolarite?: number | undefined;
        annexes?: number | undefined;
        autres?: number | undefined;
        currency?: string | undefined;
    } | undefined;
}, {
    status?: "active" | "suspended" | "completed" | "dropped" | "transferred" | undefined;
    fees?: {
        inscription?: number | undefined;
        scolarite?: number | undefined;
        annexes?: number | undefined;
        autres?: number | undefined;
        currency?: string | undefined;
    } | undefined;
}>;
export declare const BulkEnrollmentSchema: z.ZodObject<{
    studentIds: z.ZodArray<z.ZodString, "many">;
    classId: z.ZodString;
    academicYearId: z.ZodString;
    fees: z.ZodObject<{
        inscription: z.ZodDefault<z.ZodNumber>;
        scolarite: z.ZodDefault<z.ZodNumber>;
        annexes: z.ZodDefault<z.ZodNumber>;
        autres: z.ZodDefault<z.ZodNumber>;
        currency: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency: string;
    }, {
        inscription?: number | undefined;
        scolarite?: number | undefined;
        annexes?: number | undefined;
        autres?: number | undefined;
        currency?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    academicYearId: string;
    classId: string;
    fees: {
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency: string;
    };
    studentIds: string[];
}, {
    academicYearId: string;
    classId: string;
    fees: {
        inscription?: number | undefined;
        scolarite?: number | undefined;
        annexes?: number | undefined;
        autres?: number | undefined;
        currency?: string | undefined;
    };
    studentIds: string[];
}>;
export declare const AcademicYearWithStatsSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    name: z.ZodString;
    startDate: z.ZodDate;
    endDate: z.ZodDate;
    isActive: z.ZodBoolean;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
} & {
    classCount: z.ZodNumber;
    studentCount: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    classCount: number;
    studentCount: number;
}, {
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    classCount: number;
    studentCount: number;
}>;
export declare const ClassWithDetailsSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    programmeId: z.ZodString;
    academicYearId: z.ZodString;
    name: z.ZodString;
    code: z.ZodString;
    maxStudents: z.ZodNumber;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
} & {
    programme: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        code: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: string;
        id: string;
        name: string;
    }, {
        code: string;
        id: string;
        name: string;
    }>;
    academicYear: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
    }, {
        id: string;
        name: string;
    }>;
    courseCount: z.ZodNumber;
    studentCount: z.ZodNumber;
    courses: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        code: z.ZodString;
        isRequired: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        code: string;
        id: string;
        name: string;
        isRequired: boolean;
    }, {
        code: string;
        id: string;
        name: string;
        isRequired: boolean;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    code: string;
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    academicYear: {
        id: string;
        name: string;
    };
    programmeId: string;
    academicYearId: string;
    maxStudents: number;
    studentCount: number;
    programme: {
        code: string;
        id: string;
        name: string;
    };
    courseCount: number;
    courses?: {
        code: string;
        id: string;
        name: string;
        isRequired: boolean;
    }[] | undefined;
}, {
    code: string;
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    academicYear: {
        id: string;
        name: string;
    };
    programmeId: string;
    academicYearId: string;
    maxStudents: number;
    studentCount: number;
    programme: {
        code: string;
        id: string;
        name: string;
    };
    courseCount: number;
    courses?: {
        code: string;
        id: string;
        name: string;
        isRequired: boolean;
    }[] | undefined;
}>;
export declare const StudentEnrollmentWithDetailsSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    studentId: z.ZodString;
    classId: z.ZodString;
    academicYearId: z.ZodString;
    fees: z.ZodObject<{
        inscription: z.ZodNumber;
        scolarite: z.ZodNumber;
        annexes: z.ZodNumber;
        autres: z.ZodNumber;
        total: z.ZodNumber;
        currency: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        total: number;
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency: string;
    }, {
        total: number;
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency?: string | undefined;
    }>;
    enrollmentDate: z.ZodDate;
    status: z.ZodEnum<["active", "suspended", "completed", "dropped", "transferred"]>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
} & {
    student: z.ZodObject<{
        id: z.ZodString;
        firstName: z.ZodString;
        lastName: z.ZodString;
        email: z.ZodString;
        studentNumber: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        email: string;
        id: string;
        firstName: string;
        lastName: string;
        studentNumber: string | null;
    }, {
        email: string;
        id: string;
        firstName: string;
        lastName: string;
        studentNumber: string | null;
    }>;
    class: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        code: z.ZodString;
        programme: z.ZodObject<{
            name: z.ZodString;
            code: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            code: string;
            name: string;
        }, {
            code: string;
            name: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        code: string;
        id: string;
        name: string;
        programme: {
            code: string;
            name: string;
        };
    }, {
        code: string;
        id: string;
        name: string;
        programme: {
            code: string;
            name: string;
        };
    }>;
    academicYear: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
    }, {
        id: string;
        name: string;
    }>;
}, "strip", z.ZodTypeAny, {
    status: "active" | "suspended" | "completed" | "dropped" | "transferred";
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    academicYear: {
        id: string;
        name: string;
    };
    academicYearId: string;
    classId: string;
    studentId: string;
    fees: {
        total: number;
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency: string;
    };
    enrollmentDate: Date;
    student: {
        email: string;
        id: string;
        firstName: string;
        lastName: string;
        studentNumber: string | null;
    };
    class: {
        code: string;
        id: string;
        name: string;
        programme: {
            code: string;
            name: string;
        };
    };
}, {
    status: "active" | "suspended" | "completed" | "dropped" | "transferred";
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    academicYear: {
        id: string;
        name: string;
    };
    academicYearId: string;
    classId: string;
    studentId: string;
    fees: {
        total: number;
        inscription: number;
        scolarite: number;
        annexes: number;
        autres: number;
        currency?: string | undefined;
    };
    enrollmentDate: Date;
    student: {
        email: string;
        id: string;
        firstName: string;
        lastName: string;
        studentNumber: string | null;
    };
    class: {
        code: string;
        id: string;
        name: string;
        programme: {
            code: string;
            name: string;
        };
    };
}>;
export type AcademicYear = z.infer<typeof AcademicYearSchema>;
export type CreateAcademicYear = z.infer<typeof CreateAcademicYearSchema>;
export type UpdateAcademicYear = z.infer<typeof UpdateAcademicYearSchema>;
export type SetActiveAcademicYear = z.infer<typeof SetActiveAcademicYearSchema>;
export type Class = z.infer<typeof ClassSchema>;
export type CreateClass = z.infer<typeof CreateClassSchema>;
export type UpdateClass = z.infer<typeof UpdateClassSchema>;
export type ClassCourse = z.infer<typeof ClassCourseSchema>;
export type StudentEnrollment = z.infer<typeof StudentEnrollmentSchema>;
export type CreateStudentEnrollment = z.infer<typeof CreateStudentEnrollmentSchema>;
export type UpdateStudentEnrollment = z.infer<typeof UpdateStudentEnrollmentSchema>;
export type BulkEnrollment = z.infer<typeof BulkEnrollmentSchema>;
export type AcademicYearWithStats = z.infer<typeof AcademicYearWithStatsSchema>;
export type ClassWithDetails = z.infer<typeof ClassWithDetailsSchema>;
export type StudentEnrollmentWithDetails = z.infer<typeof StudentEnrollmentWithDetailsSchema>;
//# sourceMappingURL=academic-year.d.ts.map