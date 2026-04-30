import { z } from "zod";
export declare const CycleTypeSchema: z.ZodEnum<["academic", "professional", "short", "certification"]>;
export declare const CycleStatusSchema: z.ZodEnum<["draft", "active", "archived"]>;
export declare const ProgrammeStatusSchema: z.ZodEnum<["draft", "review", "approved", "active", "archived"]>;
export declare const CourseStatusSchema: z.ZodEnum<["draft", "active", "inactive"]>;
export declare const DeliveryModeSchema: z.ZodEnum<["presential", "remote", "hybrid", "elearning"]>;
export declare const ContractTypeSchema: z.ZodEnum<["permanent", "temporary", "freelance"]>;
export declare const TeacherStatusSchema: z.ZodEnum<["active", "inactive", "suspended"]>;
export declare const SessionTypeSchema: z.ZodEnum<["theory", "practical", "exam", "evaluation"]>;
export declare const CycleSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    name: z.ZodString;
    code: z.ZodString;
    type: z.ZodEnum<["academic", "professional", "short", "certification"]>;
    durationMonths: z.ZodNumber;
    description: z.ZodOptional<z.ZodString>;
    certificationLevel: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<["draft", "active", "archived"]>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    code: string;
    type: "academic" | "professional" | "short" | "certification";
    status: "draft" | "active" | "archived";
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    durationMonths: number;
    description?: string | undefined;
    certificationLevel?: string | undefined;
}, {
    code: string;
    type: "academic" | "professional" | "short" | "certification";
    status: "draft" | "active" | "archived";
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    durationMonths: number;
    description?: string | undefined;
    certificationLevel?: string | undefined;
}>;
export declare const CreateCycleSchema: z.ZodObject<{
    name: z.ZodString;
    code: z.ZodString;
    type: z.ZodEnum<["academic", "professional", "short", "certification"]>;
    durationMonths: z.ZodNumber;
    description: z.ZodOptional<z.ZodString>;
    certificationLevel: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    code: string;
    type: "academic" | "professional" | "short" | "certification";
    name: string;
    durationMonths: number;
    description?: string | undefined;
    certificationLevel?: string | undefined;
}, {
    code: string;
    type: "academic" | "professional" | "short" | "certification";
    name: string;
    durationMonths: number;
    description?: string | undefined;
    certificationLevel?: string | undefined;
}>;
export declare const UpdateCycleSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    code: z.ZodOptional<z.ZodString>;
    type: z.ZodOptional<z.ZodEnum<["academic", "professional", "short", "certification"]>>;
    durationMonths: z.ZodOptional<z.ZodNumber>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    certificationLevel: z.ZodOptional<z.ZodOptional<z.ZodString>>;
} & {
    status: z.ZodOptional<z.ZodEnum<["draft", "active", "archived"]>>;
}, "strip", z.ZodTypeAny, {
    code?: string | undefined;
    type?: "academic" | "professional" | "short" | "certification" | undefined;
    status?: "draft" | "active" | "archived" | undefined;
    name?: string | undefined;
    durationMonths?: number | undefined;
    description?: string | undefined;
    certificationLevel?: string | undefined;
}, {
    code?: string | undefined;
    type?: "academic" | "professional" | "short" | "certification" | undefined;
    status?: "draft" | "active" | "archived" | undefined;
    name?: string | undefined;
    durationMonths?: number | undefined;
    description?: string | undefined;
    certificationLevel?: string | undefined;
}>;
export declare const ProgrammeSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    cycleId: z.ZodString;
    name: z.ZodString;
    code: z.ZodString;
    version: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    objectives: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    ectsCredits: z.ZodOptional<z.ZodNumber>;
    academicYear: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<["draft", "review", "approved", "active", "archived"]>;
    approvedBy: z.ZodOptional<z.ZodString>;
    approvedAt: z.ZodOptional<z.ZodDate>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    version: string;
    code: string;
    status: "draft" | "active" | "archived" | "review" | "approved";
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    cycleId: string;
    description?: string | undefined;
    objectives?: string[] | undefined;
    ectsCredits?: number | undefined;
    academicYear?: string | undefined;
    approvedBy?: string | undefined;
    approvedAt?: Date | undefined;
}, {
    version: string;
    code: string;
    status: "draft" | "active" | "archived" | "review" | "approved";
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    cycleId: string;
    description?: string | undefined;
    objectives?: string[] | undefined;
    ectsCredits?: number | undefined;
    academicYear?: string | undefined;
    approvedBy?: string | undefined;
    approvedAt?: Date | undefined;
}>;
export declare const CreateProgrammeSchema: z.ZodObject<{
    cycleId: z.ZodString;
    name: z.ZodString;
    code: z.ZodString;
    version: z.ZodDefault<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    objectives: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    ectsCredits: z.ZodOptional<z.ZodNumber>;
    academicYear: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version: string;
    code: string;
    name: string;
    cycleId: string;
    description?: string | undefined;
    objectives?: string[] | undefined;
    ectsCredits?: number | undefined;
    academicYear?: string | undefined;
}, {
    code: string;
    name: string;
    cycleId: string;
    version?: string | undefined;
    description?: string | undefined;
    objectives?: string[] | undefined;
    ectsCredits?: number | undefined;
    academicYear?: string | undefined;
}>;
export declare const UpdateProgrammeSchema: z.ZodObject<{
    cycleId: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    code: z.ZodOptional<z.ZodString>;
    version: z.ZodOptional<z.ZodDefault<z.ZodString>>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    objectives: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    ectsCredits: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    academicYear: z.ZodOptional<z.ZodOptional<z.ZodString>>;
} & {
    status: z.ZodOptional<z.ZodEnum<["draft", "review", "approved", "active", "archived"]>>;
}, "strip", z.ZodTypeAny, {
    version?: string | undefined;
    code?: string | undefined;
    status?: "draft" | "active" | "archived" | "review" | "approved" | undefined;
    name?: string | undefined;
    description?: string | undefined;
    cycleId?: string | undefined;
    objectives?: string[] | undefined;
    ectsCredits?: number | undefined;
    academicYear?: string | undefined;
}, {
    version?: string | undefined;
    code?: string | undefined;
    status?: "draft" | "active" | "archived" | "review" | "approved" | undefined;
    name?: string | undefined;
    description?: string | undefined;
    cycleId?: string | undefined;
    objectives?: string[] | undefined;
    ectsCredits?: number | undefined;
    academicYear?: string | undefined;
}>;
export declare const ApproveProgrammeSchema: z.ZodObject<{
    approvedBy: z.ZodString;
}, "strip", z.ZodTypeAny, {
    approvedBy: string;
}, {
    approvedBy: string;
}>;
export declare const CourseSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    programmeId: z.ZodString;
    name: z.ZodString;
    code: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    objectives: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    hoursTotal: z.ZodNumber;
    hoursTheory: z.ZodNumber;
    hoursPractical: z.ZodNumber;
    deliveryMode: z.ZodEnum<["presential", "remote", "hybrid", "elearning"]>;
    prerequisites: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    evaluationMethods: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    resources: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
    status: z.ZodEnum<["draft", "active", "inactive"]>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    code: string;
    status: "draft" | "active" | "inactive";
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    programmeId: string;
    hoursTotal: number;
    hoursTheory: number;
    hoursPractical: number;
    deliveryMode: "presential" | "remote" | "hybrid" | "elearning";
    description?: string | undefined;
    objectives?: string[] | undefined;
    prerequisites?: string[] | undefined;
    evaluationMethods?: string[] | undefined;
    resources?: Record<string, any> | undefined;
}, {
    code: string;
    status: "draft" | "active" | "inactive";
    id: string;
    tenantId: string;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    programmeId: string;
    hoursTotal: number;
    hoursTheory: number;
    hoursPractical: number;
    deliveryMode: "presential" | "remote" | "hybrid" | "elearning";
    description?: string | undefined;
    objectives?: string[] | undefined;
    prerequisites?: string[] | undefined;
    evaluationMethods?: string[] | undefined;
    resources?: Record<string, any> | undefined;
}>;
export declare const CreateCourseSchema: z.ZodObject<{
    programmeId: z.ZodString;
    name: z.ZodString;
    code: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    objectives: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    hoursTotal: z.ZodNumber;
    hoursTheory: z.ZodDefault<z.ZodNumber>;
    hoursPractical: z.ZodDefault<z.ZodNumber>;
    deliveryMode: z.ZodEnum<["presential", "remote", "hybrid", "elearning"]>;
    prerequisites: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    evaluationMethods: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    resources: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>;
}, "strip", z.ZodTypeAny, {
    code: string;
    name: string;
    programmeId: string;
    hoursTotal: number;
    hoursTheory: number;
    hoursPractical: number;
    deliveryMode: "presential" | "remote" | "hybrid" | "elearning";
    description?: string | undefined;
    objectives?: string[] | undefined;
    prerequisites?: string[] | undefined;
    evaluationMethods?: string[] | undefined;
    resources?: Record<string, any> | undefined;
}, {
    code: string;
    name: string;
    programmeId: string;
    hoursTotal: number;
    deliveryMode: "presential" | "remote" | "hybrid" | "elearning";
    description?: string | undefined;
    objectives?: string[] | undefined;
    hoursTheory?: number | undefined;
    hoursPractical?: number | undefined;
    prerequisites?: string[] | undefined;
    evaluationMethods?: string[] | undefined;
    resources?: Record<string, any> | undefined;
}>;
export declare const UpdateCourseSchema: z.ZodObject<{
    programmeId: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    code: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    objectives: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    hoursTotal: z.ZodOptional<z.ZodNumber>;
    hoursTheory: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    hoursPractical: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
    deliveryMode: z.ZodOptional<z.ZodEnum<["presential", "remote", "hybrid", "elearning"]>>;
    prerequisites: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    evaluationMethods: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    resources: z.ZodOptional<z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodAny>>>;
} & {
    status: z.ZodOptional<z.ZodEnum<["draft", "active", "inactive"]>>;
}, "strip", z.ZodTypeAny, {
    code?: string | undefined;
    status?: "draft" | "active" | "inactive" | undefined;
    name?: string | undefined;
    description?: string | undefined;
    objectives?: string[] | undefined;
    programmeId?: string | undefined;
    hoursTotal?: number | undefined;
    hoursTheory?: number | undefined;
    hoursPractical?: number | undefined;
    deliveryMode?: "presential" | "remote" | "hybrid" | "elearning" | undefined;
    prerequisites?: string[] | undefined;
    evaluationMethods?: string[] | undefined;
    resources?: Record<string, any> | undefined;
}, {
    code?: string | undefined;
    status?: "draft" | "active" | "inactive" | undefined;
    name?: string | undefined;
    description?: string | undefined;
    objectives?: string[] | undefined;
    programmeId?: string | undefined;
    hoursTotal?: number | undefined;
    hoursTheory?: number | undefined;
    hoursPractical?: number | undefined;
    deliveryMode?: "presential" | "remote" | "hybrid" | "elearning" | undefined;
    prerequisites?: string[] | undefined;
    evaluationMethods?: string[] | undefined;
    resources?: Record<string, any> | undefined;
}>;
export declare const TeacherSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    userId: z.ZodOptional<z.ZodString>;
    employeeNumber: z.ZodOptional<z.ZodString>;
    firstName: z.ZodString;
    lastName: z.ZodString;
    email: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    specialties: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    bio: z.ZodOptional<z.ZodString>;
    qualifications: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    hireDate: z.ZodOptional<z.ZodString>;
    contractType: z.ZodEnum<["permanent", "temporary", "freelance"]>;
    hourlyRate: z.ZodOptional<z.ZodNumber>;
    status: z.ZodEnum<["active", "inactive", "suspended"]>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    status: "active" | "inactive" | "suspended";
    id: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    contractType: "permanent" | "temporary" | "freelance";
    email?: string | undefined;
    userId?: string | undefined;
    employeeNumber?: string | undefined;
    phone?: string | undefined;
    specialties?: string[] | undefined;
    bio?: string | undefined;
    qualifications?: string[] | undefined;
    hireDate?: string | undefined;
    hourlyRate?: number | undefined;
}, {
    status: "active" | "inactive" | "suspended";
    id: string;
    firstName: string;
    lastName: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    contractType: "permanent" | "temporary" | "freelance";
    email?: string | undefined;
    userId?: string | undefined;
    employeeNumber?: string | undefined;
    phone?: string | undefined;
    specialties?: string[] | undefined;
    bio?: string | undefined;
    qualifications?: string[] | undefined;
    hireDate?: string | undefined;
    hourlyRate?: number | undefined;
}>;
export declare const CreateTeacherSchema: z.ZodObject<{
    userId: z.ZodOptional<z.ZodString>;
    employeeNumber: z.ZodOptional<z.ZodString>;
    firstName: z.ZodString;
    lastName: z.ZodString;
    email: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    specialties: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    bio: z.ZodOptional<z.ZodString>;
    qualifications: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    hireDate: z.ZodOptional<z.ZodString>;
    contractType: z.ZodEnum<["permanent", "temporary", "freelance"]>;
    hourlyRate: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    firstName: string;
    lastName: string;
    contractType: "permanent" | "temporary" | "freelance";
    email?: string | undefined;
    userId?: string | undefined;
    employeeNumber?: string | undefined;
    phone?: string | undefined;
    specialties?: string[] | undefined;
    bio?: string | undefined;
    qualifications?: string[] | undefined;
    hireDate?: string | undefined;
    hourlyRate?: number | undefined;
}, {
    firstName: string;
    lastName: string;
    contractType: "permanent" | "temporary" | "freelance";
    email?: string | undefined;
    userId?: string | undefined;
    employeeNumber?: string | undefined;
    phone?: string | undefined;
    specialties?: string[] | undefined;
    bio?: string | undefined;
    qualifications?: string[] | undefined;
    hireDate?: string | undefined;
    hourlyRate?: number | undefined;
}>;
export declare const UpdateTeacherSchema: z.ZodObject<{
    userId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    employeeNumber: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    firstName: z.ZodOptional<z.ZodString>;
    lastName: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    phone: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    specialties: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    bio: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    qualifications: z.ZodOptional<z.ZodOptional<z.ZodArray<z.ZodString, "many">>>;
    hireDate: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    contractType: z.ZodOptional<z.ZodEnum<["permanent", "temporary", "freelance"]>>;
    hourlyRate: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
} & {
    status: z.ZodOptional<z.ZodEnum<["active", "inactive", "suspended"]>>;
}, "strip", z.ZodTypeAny, {
    status?: "active" | "inactive" | "suspended" | undefined;
    email?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    userId?: string | undefined;
    employeeNumber?: string | undefined;
    phone?: string | undefined;
    specialties?: string[] | undefined;
    bio?: string | undefined;
    qualifications?: string[] | undefined;
    hireDate?: string | undefined;
    contractType?: "permanent" | "temporary" | "freelance" | undefined;
    hourlyRate?: number | undefined;
}, {
    status?: "active" | "inactive" | "suspended" | undefined;
    email?: string | undefined;
    firstName?: string | undefined;
    lastName?: string | undefined;
    userId?: string | undefined;
    employeeNumber?: string | undefined;
    phone?: string | undefined;
    specialties?: string[] | undefined;
    bio?: string | undefined;
    qualifications?: string[] | undefined;
    hireDate?: string | undefined;
    contractType?: "permanent" | "temporary" | "freelance" | undefined;
    hourlyRate?: number | undefined;
}>;
export declare const CourseAssignmentSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    courseId: z.ZodString;
    teacherId: z.ZodString;
    academicYear: z.ZodString;
    semester: z.ZodOptional<z.ZodNumber>;
    hoursAssigned: z.ZodNumber;
    startDate: z.ZodOptional<z.ZodDate>;
    endDate: z.ZodOptional<z.ZodDate>;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    academicYear: string;
    courseId: string;
    teacherId: string;
    hoursAssigned: number;
    semester?: number | undefined;
    startDate?: Date | undefined;
    endDate?: Date | undefined;
}, {
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    academicYear: string;
    courseId: string;
    teacherId: string;
    hoursAssigned: number;
    semester?: number | undefined;
    startDate?: Date | undefined;
    endDate?: Date | undefined;
}>;
export declare const CreateCourseAssignmentSchema: z.ZodObject<{
    courseId: z.ZodString;
    teacherId: z.ZodString;
    academicYear: z.ZodString;
    semester: z.ZodOptional<z.ZodNumber>;
    hoursAssigned: z.ZodNumber;
    startDate: z.ZodOptional<z.ZodDate>;
    endDate: z.ZodOptional<z.ZodDate>;
}, "strip", z.ZodTypeAny, {
    academicYear: string;
    courseId: string;
    teacherId: string;
    hoursAssigned: number;
    semester?: number | undefined;
    startDate?: Date | undefined;
    endDate?: Date | undefined;
}, {
    academicYear: string;
    courseId: string;
    teacherId: string;
    hoursAssigned: number;
    semester?: number | undefined;
    startDate?: Date | undefined;
    endDate?: Date | undefined;
}>;
export declare const UpdateCourseAssignmentSchema: z.ZodObject<{
    courseId: z.ZodOptional<z.ZodString>;
    teacherId: z.ZodOptional<z.ZodString>;
    academicYear: z.ZodOptional<z.ZodString>;
    semester: z.ZodOptional<z.ZodOptional<z.ZodNumber>>;
    hoursAssigned: z.ZodOptional<z.ZodNumber>;
    startDate: z.ZodOptional<z.ZodOptional<z.ZodDate>>;
    endDate: z.ZodOptional<z.ZodOptional<z.ZodDate>>;
}, "strip", z.ZodTypeAny, {
    academicYear?: string | undefined;
    courseId?: string | undefined;
    teacherId?: string | undefined;
    semester?: number | undefined;
    hoursAssigned?: number | undefined;
    startDate?: Date | undefined;
    endDate?: Date | undefined;
}, {
    academicYear?: string | undefined;
    courseId?: string | undefined;
    teacherId?: string | undefined;
    semester?: number | undefined;
    hoursAssigned?: number | undefined;
    startDate?: Date | undefined;
    endDate?: Date | undefined;
}>;
export declare const TeachingHourSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    assignmentId: z.ZodString;
    sessionDate: z.ZodDate;
    hoursTaught: z.ZodNumber;
    sessionType: z.ZodEnum<["theory", "practical", "exam", "evaluation"]>;
    notes: z.ZodOptional<z.ZodString>;
    validatedBy: z.ZodOptional<z.ZodString>;
    validatedAt: z.ZodOptional<z.ZodDate>;
    createdAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    createdAt: Date;
    assignmentId: string;
    sessionDate: Date;
    hoursTaught: number;
    sessionType: "theory" | "practical" | "exam" | "evaluation";
    notes?: string | undefined;
    validatedBy?: string | undefined;
    validatedAt?: Date | undefined;
}, {
    id: string;
    tenantId: string;
    createdAt: Date;
    assignmentId: string;
    sessionDate: Date;
    hoursTaught: number;
    sessionType: "theory" | "practical" | "exam" | "evaluation";
    notes?: string | undefined;
    validatedBy?: string | undefined;
    validatedAt?: Date | undefined;
}>;
export declare const CreateTeachingHourSchema: z.ZodObject<{
    assignmentId: z.ZodString;
    sessionDate: z.ZodDate;
    hoursTaught: z.ZodNumber;
    sessionType: z.ZodEnum<["theory", "practical", "exam", "evaluation"]>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    assignmentId: string;
    sessionDate: Date;
    hoursTaught: number;
    sessionType: "theory" | "practical" | "exam" | "evaluation";
    notes?: string | undefined;
}, {
    assignmentId: string;
    sessionDate: Date;
    hoursTaught: number;
    sessionType: "theory" | "practical" | "exam" | "evaluation";
    notes?: string | undefined;
}>;
export declare const ValidateTeachingHourSchema: z.ZodObject<{
    validatedBy: z.ZodString;
}, "strip", z.ZodTypeAny, {
    validatedBy: string;
}, {
    validatedBy: string;
}>;
export type CycleType = z.infer<typeof CycleTypeSchema>;
export type CycleStatus = z.infer<typeof CycleStatusSchema>;
export type ProgrammeStatus = z.infer<typeof ProgrammeStatusSchema>;
export type CourseStatus = z.infer<typeof CourseStatusSchema>;
export type DeliveryMode = z.infer<typeof DeliveryModeSchema>;
export type ContractType = z.infer<typeof ContractTypeSchema>;
export type TeacherStatus = z.infer<typeof TeacherStatusSchema>;
export type SessionType = z.infer<typeof SessionTypeSchema>;
export type Cycle = z.infer<typeof CycleSchema>;
export type CreateCycle = z.infer<typeof CreateCycleSchema>;
export type UpdateCycle = z.infer<typeof UpdateCycleSchema>;
export type Programme = z.infer<typeof ProgrammeSchema>;
export type CreateProgramme = z.infer<typeof CreateProgrammeSchema>;
export type UpdateProgramme = z.infer<typeof UpdateProgrammeSchema>;
export type ApproveProgramme = z.infer<typeof ApproveProgrammeSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type CreateCourse = z.infer<typeof CreateCourseSchema>;
export type UpdateCourse = z.infer<typeof UpdateCourseSchema>;
export type Teacher = z.infer<typeof TeacherSchema>;
export type CreateTeacher = z.infer<typeof CreateTeacherSchema>;
export type UpdateTeacher = z.infer<typeof UpdateTeacherSchema>;
export type CourseAssignment = z.infer<typeof CourseAssignmentSchema>;
export type CreateCourseAssignment = z.infer<typeof CreateCourseAssignmentSchema>;
export type UpdateCourseAssignment = z.infer<typeof UpdateCourseAssignmentSchema>;
export type TeachingHour = z.infer<typeof TeachingHourSchema>;
export type CreateTeachingHour = z.infer<typeof CreateTeachingHourSchema>;
export type ValidateTeachingHour = z.infer<typeof ValidateTeachingHourSchema>;
export declare const CycleQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["draft", "active", "archived"]>>;
    type: z.ZodOptional<z.ZodEnum<["academic", "professional", "short", "certification"]>>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    type?: "academic" | "professional" | "short" | "certification" | undefined;
    status?: "draft" | "active" | "archived" | undefined;
}, {
    type?: "academic" | "professional" | "short" | "certification" | undefined;
    status?: "draft" | "active" | "archived" | undefined;
    page?: number | undefined;
    limit?: number | undefined;
}>;
export declare const ProgrammeQuerySchema: z.ZodObject<{
    cycleId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["draft", "review", "approved", "active", "archived"]>>;
    academicYear: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    status?: "draft" | "active" | "archived" | "review" | "approved" | undefined;
    cycleId?: string | undefined;
    academicYear?: string | undefined;
}, {
    status?: "draft" | "active" | "archived" | "review" | "approved" | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    cycleId?: string | undefined;
    academicYear?: string | undefined;
}>;
export declare const CourseQuerySchema: z.ZodObject<{
    programmeId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["draft", "active", "inactive"]>>;
    deliveryMode: z.ZodOptional<z.ZodEnum<["presential", "remote", "hybrid", "elearning"]>>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    status?: "draft" | "active" | "inactive" | undefined;
    programmeId?: string | undefined;
    deliveryMode?: "presential" | "remote" | "hybrid" | "elearning" | undefined;
}, {
    status?: "draft" | "active" | "inactive" | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    programmeId?: string | undefined;
    deliveryMode?: "presential" | "remote" | "hybrid" | "elearning" | undefined;
}>;
export declare const TeacherQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["active", "inactive", "suspended"]>>;
    contractType: z.ZodOptional<z.ZodEnum<["permanent", "temporary", "freelance"]>>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    status?: "active" | "inactive" | "suspended" | undefined;
    contractType?: "permanent" | "temporary" | "freelance" | undefined;
}, {
    status?: "active" | "inactive" | "suspended" | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    contractType?: "permanent" | "temporary" | "freelance" | undefined;
}>;
export declare const CourseAssignmentQuerySchema: z.ZodObject<{
    courseId: z.ZodOptional<z.ZodString>;
    teacherId: z.ZodOptional<z.ZodString>;
    academicYear: z.ZodOptional<z.ZodString>;
    semester: z.ZodOptional<z.ZodNumber>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    academicYear?: string | undefined;
    courseId?: string | undefined;
    teacherId?: string | undefined;
    semester?: number | undefined;
}, {
    page?: number | undefined;
    limit?: number | undefined;
    academicYear?: string | undefined;
    courseId?: string | undefined;
    teacherId?: string | undefined;
    semester?: number | undefined;
}>;
export declare const TeachingHourQuerySchema: z.ZodObject<{
    assignmentId: z.ZodOptional<z.ZodString>;
    teacherId: z.ZodOptional<z.ZodString>;
    startDate: z.ZodOptional<z.ZodDate>;
    endDate: z.ZodOptional<z.ZodDate>;
    validated: z.ZodOptional<z.ZodBoolean>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    teacherId?: string | undefined;
    startDate?: Date | undefined;
    endDate?: Date | undefined;
    assignmentId?: string | undefined;
    validated?: boolean | undefined;
}, {
    page?: number | undefined;
    limit?: number | undefined;
    teacherId?: string | undefined;
    startDate?: Date | undefined;
    endDate?: Date | undefined;
    assignmentId?: string | undefined;
    validated?: boolean | undefined;
}>;
export type CycleQuery = z.infer<typeof CycleQuerySchema>;
export type ProgrammeQuery = z.infer<typeof ProgrammeQuerySchema>;
export type CourseQuery = z.infer<typeof CourseQuerySchema>;
export type TeacherQuery = z.infer<typeof TeacherQuerySchema>;
export type CourseAssignmentQuery = z.infer<typeof CourseAssignmentQuerySchema>;
export type TeachingHourQuery = z.infer<typeof TeachingHourQuerySchema>;
//# sourceMappingURL=academic.d.ts.map