import { z } from "zod";
export declare const StudentStatusSchema: z.ZodEnum<["active", "graduated", "suspended", "dropped", "transfer"]>;
export declare const ParentRelationshipSchema: z.ZodEnum<["parent", "guardian", "emergency_contact"]>;
export declare const StudentProfileSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    userId: z.ZodString;
    studentNumber: z.ZodString;
    currentYear: z.ZodNumber;
    status: z.ZodEnum<["active", "graduated", "suspended", "dropped", "transfer"]>;
    bio: z.ZodOptional<z.ZodString>;
    dateOfBirth: z.ZodOptional<z.ZodDate>;
    placeOfBirth: z.ZodOptional<z.ZodString>;
    nationality: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    emergencyPhone: z.ZodOptional<z.ZodString>;
    isActive: z.ZodBoolean;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    status: "active" | "suspended" | "dropped" | "graduated" | "transfer";
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    isActive: boolean;
    studentNumber: string;
    currentYear: number;
    phone?: string | undefined;
    bio?: string | undefined;
    dateOfBirth?: Date | undefined;
    placeOfBirth?: string | undefined;
    nationality?: string | undefined;
    address?: string | undefined;
    emergencyPhone?: string | undefined;
}, {
    status: "active" | "suspended" | "dropped" | "graduated" | "transfer";
    id: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    isActive: boolean;
    studentNumber: string;
    currentYear: number;
    phone?: string | undefined;
    bio?: string | undefined;
    dateOfBirth?: Date | undefined;
    placeOfBirth?: string | undefined;
    nationality?: string | undefined;
    address?: string | undefined;
    emergencyPhone?: string | undefined;
}>;
export declare const CreateStudentProfileSchema: z.ZodObject<{
    userId: z.ZodString;
    studentNumber: z.ZodOptional<z.ZodString>;
    currentYear: z.ZodDefault<z.ZodNumber>;
    status: z.ZodDefault<z.ZodEnum<["active", "graduated", "suspended", "dropped", "transfer"]>>;
    bio: z.ZodOptional<z.ZodString>;
    dateOfBirth: z.ZodOptional<z.ZodString>;
    placeOfBirth: z.ZodOptional<z.ZodString>;
    nationality: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    emergencyPhone: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "active" | "suspended" | "dropped" | "graduated" | "transfer";
    userId: string;
    currentYear: number;
    phone?: string | undefined;
    bio?: string | undefined;
    studentNumber?: string | undefined;
    dateOfBirth?: string | undefined;
    placeOfBirth?: string | undefined;
    nationality?: string | undefined;
    address?: string | undefined;
    emergencyPhone?: string | undefined;
}, {
    userId: string;
    status?: "active" | "suspended" | "dropped" | "graduated" | "transfer" | undefined;
    phone?: string | undefined;
    bio?: string | undefined;
    studentNumber?: string | undefined;
    currentYear?: number | undefined;
    dateOfBirth?: string | undefined;
    placeOfBirth?: string | undefined;
    nationality?: string | undefined;
    address?: string | undefined;
    emergencyPhone?: string | undefined;
}>;
export declare const CreateStudentWithUserSchema: z.ZodObject<{
    firstName: z.ZodString;
    lastName: z.ZodString;
    email: z.ZodString;
    password: z.ZodString;
    matricule: z.ZodOptional<z.ZodString>;
    currentYear: z.ZodDefault<z.ZodNumber>;
    status: z.ZodDefault<z.ZodEnum<["active", "graduated", "suspended", "dropped", "transfer"]>>;
    bio: z.ZodOptional<z.ZodString>;
    dateOfBirth: z.ZodOptional<z.ZodString>;
    placeOfBirth: z.ZodOptional<z.ZodString>;
    nationality: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    emergencyPhone: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "active" | "suspended" | "dropped" | "graduated" | "transfer";
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    currentYear: number;
    phone?: string | undefined;
    bio?: string | undefined;
    dateOfBirth?: string | undefined;
    placeOfBirth?: string | undefined;
    nationality?: string | undefined;
    address?: string | undefined;
    emergencyPhone?: string | undefined;
    matricule?: string | undefined;
}, {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    status?: "active" | "suspended" | "dropped" | "graduated" | "transfer" | undefined;
    phone?: string | undefined;
    bio?: string | undefined;
    currentYear?: number | undefined;
    dateOfBirth?: string | undefined;
    placeOfBirth?: string | undefined;
    nationality?: string | undefined;
    address?: string | undefined;
    emergencyPhone?: string | undefined;
    matricule?: string | undefined;
}>;
export declare const UpdateStudentProfileSchema: z.ZodObject<{
    userId: z.ZodOptional<z.ZodString>;
    studentNumber: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    bio: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    dateOfBirth: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    placeOfBirth: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    nationality: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    address: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    phone: z.ZodOptional<z.ZodOptional<z.ZodString>>;
    emergencyPhone: z.ZodOptional<z.ZodOptional<z.ZodString>>;
} & {
    status: z.ZodOptional<z.ZodEnum<["active", "graduated", "suspended", "dropped", "transfer"]>>;
    currentYear: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    status?: "active" | "suspended" | "dropped" | "graduated" | "transfer" | undefined;
    userId?: string | undefined;
    phone?: string | undefined;
    bio?: string | undefined;
    studentNumber?: string | undefined;
    currentYear?: number | undefined;
    dateOfBirth?: string | undefined;
    placeOfBirth?: string | undefined;
    nationality?: string | undefined;
    address?: string | undefined;
    emergencyPhone?: string | undefined;
}, {
    status?: "active" | "suspended" | "dropped" | "graduated" | "transfer" | undefined;
    userId?: string | undefined;
    phone?: string | undefined;
    bio?: string | undefined;
    studentNumber?: string | undefined;
    currentYear?: number | undefined;
    dateOfBirth?: string | undefined;
    placeOfBirth?: string | undefined;
    nationality?: string | undefined;
    address?: string | undefined;
    emergencyPhone?: string | undefined;
}>;
export declare const StudentParentSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    studentId: z.ZodString;
    parentId: z.ZodString;
    relationshipType: z.ZodEnum<["parent", "guardian", "emergency_contact"]>;
    isPrimaryContact: z.ZodBoolean;
    emergencyContact: z.ZodBoolean;
    canPickup: z.ZodBoolean;
    notes: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodDate;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    createdAt: Date;
    studentId: string;
    parentId: string;
    relationshipType: "parent" | "guardian" | "emergency_contact";
    isPrimaryContact: boolean;
    emergencyContact: boolean;
    canPickup: boolean;
    notes?: string | undefined;
}, {
    id: string;
    tenantId: string;
    createdAt: Date;
    studentId: string;
    parentId: string;
    relationshipType: "parent" | "guardian" | "emergency_contact";
    isPrimaryContact: boolean;
    emergencyContact: boolean;
    canPickup: boolean;
    notes?: string | undefined;
}>;
export declare const CreateStudentParentSchema: z.ZodObject<{
    parentId: z.ZodString;
    relationshipType: z.ZodDefault<z.ZodEnum<["parent", "guardian", "emergency_contact"]>>;
    isPrimaryContact: z.ZodDefault<z.ZodBoolean>;
    emergencyContact: z.ZodDefault<z.ZodBoolean>;
    canPickup: z.ZodDefault<z.ZodBoolean>;
    notes: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    parentId: string;
    relationshipType: "parent" | "guardian" | "emergency_contact";
    isPrimaryContact: boolean;
    emergencyContact: boolean;
    canPickup: boolean;
    notes?: string | undefined;
}, {
    parentId: string;
    notes?: string | undefined;
    relationshipType?: "parent" | "guardian" | "emergency_contact" | undefined;
    isPrimaryContact?: boolean | undefined;
    emergencyContact?: boolean | undefined;
    canPickup?: boolean | undefined;
}>;
export declare const UpdateStudentParentSchema: z.ZodObject<{
    parentId: z.ZodOptional<z.ZodString>;
    relationshipType: z.ZodOptional<z.ZodDefault<z.ZodEnum<["parent", "guardian", "emergency_contact"]>>>;
    isPrimaryContact: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    emergencyContact: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    canPickup: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    notes: z.ZodOptional<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    notes?: string | undefined;
    parentId?: string | undefined;
    relationshipType?: "parent" | "guardian" | "emergency_contact" | undefined;
    isPrimaryContact?: boolean | undefined;
    emergencyContact?: boolean | undefined;
    canPickup?: boolean | undefined;
}, {
    notes?: string | undefined;
    parentId?: string | undefined;
    relationshipType?: "parent" | "guardian" | "emergency_contact" | undefined;
    isPrimaryContact?: boolean | undefined;
    emergencyContact?: boolean | undefined;
    canPickup?: boolean | undefined;
}>;
export declare const StudentWithUserSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    userId: z.ZodString;
    studentNumber: z.ZodString;
    currentYear: z.ZodNumber;
    status: z.ZodEnum<["active", "graduated", "suspended", "dropped", "transfer"]>;
    bio: z.ZodOptional<z.ZodString>;
    dateOfBirth: z.ZodOptional<z.ZodDate>;
    placeOfBirth: z.ZodOptional<z.ZodString>;
    nationality: z.ZodOptional<z.ZodString>;
    address: z.ZodOptional<z.ZodString>;
    phone: z.ZodOptional<z.ZodString>;
    emergencyPhone: z.ZodOptional<z.ZodString>;
    isActive: z.ZodBoolean;
    createdAt: z.ZodDate;
    updatedAt: z.ZodDate;
} & {
    user: z.ZodObject<{
        id: z.ZodString;
        email: z.ZodString;
        firstName: z.ZodString;
        lastName: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        email: string;
        id: string;
        firstName: string;
        lastName: string;
    }, {
        email: string;
        id: string;
        firstName: string;
        lastName: string;
    }>;
}, "strip", z.ZodTypeAny, {
    status: "active" | "suspended" | "dropped" | "graduated" | "transfer";
    id: string;
    tenantId: string;
    user: {
        email: string;
        id: string;
        firstName: string;
        lastName: string;
    };
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    isActive: boolean;
    studentNumber: string;
    currentYear: number;
    phone?: string | undefined;
    bio?: string | undefined;
    dateOfBirth?: Date | undefined;
    placeOfBirth?: string | undefined;
    nationality?: string | undefined;
    address?: string | undefined;
    emergencyPhone?: string | undefined;
}, {
    status: "active" | "suspended" | "dropped" | "graduated" | "transfer";
    id: string;
    tenantId: string;
    user: {
        email: string;
        id: string;
        firstName: string;
        lastName: string;
    };
    createdAt: Date;
    updatedAt: Date;
    userId: string;
    isActive: boolean;
    studentNumber: string;
    currentYear: number;
    phone?: string | undefined;
    bio?: string | undefined;
    dateOfBirth?: Date | undefined;
    placeOfBirth?: string | undefined;
    nationality?: string | undefined;
    address?: string | undefined;
    emergencyPhone?: string | undefined;
}>;
export declare const StudentParentWithUserSchema: z.ZodObject<{
    id: z.ZodString;
    tenantId: z.ZodString;
    studentId: z.ZodString;
    parentId: z.ZodString;
    relationshipType: z.ZodEnum<["parent", "guardian", "emergency_contact"]>;
    isPrimaryContact: z.ZodBoolean;
    emergencyContact: z.ZodBoolean;
    canPickup: z.ZodBoolean;
    notes: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodDate;
} & {
    parent: z.ZodObject<{
        id: z.ZodString;
        email: z.ZodString;
        name: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        email: string;
        id: string;
        name: string;
    }, {
        email: string;
        id: string;
        name: string;
    }>;
}, "strip", z.ZodTypeAny, {
    id: string;
    tenantId: string;
    createdAt: Date;
    studentId: string;
    parent: {
        email: string;
        id: string;
        name: string;
    };
    parentId: string;
    relationshipType: "parent" | "guardian" | "emergency_contact";
    isPrimaryContact: boolean;
    emergencyContact: boolean;
    canPickup: boolean;
    notes?: string | undefined;
}, {
    id: string;
    tenantId: string;
    createdAt: Date;
    studentId: string;
    parent: {
        email: string;
        id: string;
        name: string;
    };
    parentId: string;
    relationshipType: "parent" | "guardian" | "emergency_contact";
    isPrimaryContact: boolean;
    emergencyContact: boolean;
    canPickup: boolean;
    notes?: string | undefined;
}>;
export declare const StudentQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<["active", "graduated", "suspended", "dropped", "transfer"]>>;
    currentYear: z.ZodOptional<z.ZodNumber>;
    search: z.ZodOptional<z.ZodString>;
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    search?: string | undefined;
    status?: "active" | "suspended" | "dropped" | "graduated" | "transfer" | undefined;
    currentYear?: number | undefined;
}, {
    search?: string | undefined;
    status?: "active" | "suspended" | "dropped" | "graduated" | "transfer" | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    currentYear?: number | undefined;
}>;
export declare const StudentParentQuerySchema: z.ZodObject<{
    relationshipType: z.ZodOptional<z.ZodEnum<["parent", "guardian", "emergency_contact"]>>;
    isPrimaryContact: z.ZodOptional<z.ZodBoolean>;
    emergencyContact: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    relationshipType?: "parent" | "guardian" | "emergency_contact" | undefined;
    isPrimaryContact?: boolean | undefined;
    emergencyContact?: boolean | undefined;
}, {
    relationshipType?: "parent" | "guardian" | "emergency_contact" | undefined;
    isPrimaryContact?: boolean | undefined;
    emergencyContact?: boolean | undefined;
}>;
export declare const StudentListResponseSchema: z.ZodObject<{
    students: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        tenantId: z.ZodString;
        userId: z.ZodString;
        studentNumber: z.ZodString;
        currentYear: z.ZodNumber;
        status: z.ZodEnum<["active", "graduated", "suspended", "dropped", "transfer"]>;
        bio: z.ZodOptional<z.ZodString>;
        dateOfBirth: z.ZodOptional<z.ZodDate>;
        placeOfBirth: z.ZodOptional<z.ZodString>;
        nationality: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodString>;
        phone: z.ZodOptional<z.ZodString>;
        emergencyPhone: z.ZodOptional<z.ZodString>;
        isActive: z.ZodBoolean;
        createdAt: z.ZodDate;
        updatedAt: z.ZodDate;
    } & {
        user: z.ZodObject<{
            id: z.ZodString;
            email: z.ZodString;
            firstName: z.ZodString;
            lastName: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            email: string;
            id: string;
            firstName: string;
            lastName: string;
        }, {
            email: string;
            id: string;
            firstName: string;
            lastName: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        status: "active" | "suspended" | "dropped" | "graduated" | "transfer";
        id: string;
        tenantId: string;
        user: {
            email: string;
            id: string;
            firstName: string;
            lastName: string;
        };
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        isActive: boolean;
        studentNumber: string;
        currentYear: number;
        phone?: string | undefined;
        bio?: string | undefined;
        dateOfBirth?: Date | undefined;
        placeOfBirth?: string | undefined;
        nationality?: string | undefined;
        address?: string | undefined;
        emergencyPhone?: string | undefined;
    }, {
        status: "active" | "suspended" | "dropped" | "graduated" | "transfer";
        id: string;
        tenantId: string;
        user: {
            email: string;
            id: string;
            firstName: string;
            lastName: string;
        };
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        isActive: boolean;
        studentNumber: string;
        currentYear: number;
        phone?: string | undefined;
        bio?: string | undefined;
        dateOfBirth?: Date | undefined;
        placeOfBirth?: string | undefined;
        nationality?: string | undefined;
        address?: string | undefined;
        emergencyPhone?: string | undefined;
    }>, "many">;
    total: z.ZodNumber;
    page: z.ZodNumber;
    limit: z.ZodNumber;
    totalPages: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    students: {
        status: "active" | "suspended" | "dropped" | "graduated" | "transfer";
        id: string;
        tenantId: string;
        user: {
            email: string;
            id: string;
            firstName: string;
            lastName: string;
        };
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        isActive: boolean;
        studentNumber: string;
        currentYear: number;
        phone?: string | undefined;
        bio?: string | undefined;
        dateOfBirth?: Date | undefined;
        placeOfBirth?: string | undefined;
        nationality?: string | undefined;
        address?: string | undefined;
        emergencyPhone?: string | undefined;
    }[];
}, {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    students: {
        status: "active" | "suspended" | "dropped" | "graduated" | "transfer";
        id: string;
        tenantId: string;
        user: {
            email: string;
            id: string;
            firstName: string;
            lastName: string;
        };
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        isActive: boolean;
        studentNumber: string;
        currentYear: number;
        phone?: string | undefined;
        bio?: string | undefined;
        dateOfBirth?: Date | undefined;
        placeOfBirth?: string | undefined;
        nationality?: string | undefined;
        address?: string | undefined;
        emergencyPhone?: string | undefined;
    }[];
}>;
export declare const StudentParentListResponseSchema: z.ZodObject<{
    parents: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        tenantId: z.ZodString;
        studentId: z.ZodString;
        parentId: z.ZodString;
        relationshipType: z.ZodEnum<["parent", "guardian", "emergency_contact"]>;
        isPrimaryContact: z.ZodBoolean;
        emergencyContact: z.ZodBoolean;
        canPickup: z.ZodBoolean;
        notes: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodDate;
    } & {
        parent: z.ZodObject<{
            id: z.ZodString;
            email: z.ZodString;
            name: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            email: string;
            id: string;
            name: string;
        }, {
            email: string;
            id: string;
            name: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        tenantId: string;
        createdAt: Date;
        studentId: string;
        parent: {
            email: string;
            id: string;
            name: string;
        };
        parentId: string;
        relationshipType: "parent" | "guardian" | "emergency_contact";
        isPrimaryContact: boolean;
        emergencyContact: boolean;
        canPickup: boolean;
        notes?: string | undefined;
    }, {
        id: string;
        tenantId: string;
        createdAt: Date;
        studentId: string;
        parent: {
            email: string;
            id: string;
            name: string;
        };
        parentId: string;
        relationshipType: "parent" | "guardian" | "emergency_contact";
        isPrimaryContact: boolean;
        emergencyContact: boolean;
        canPickup: boolean;
        notes?: string | undefined;
    }>, "many">;
    total: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    total: number;
    parents: {
        id: string;
        tenantId: string;
        createdAt: Date;
        studentId: string;
        parent: {
            email: string;
            id: string;
            name: string;
        };
        parentId: string;
        relationshipType: "parent" | "guardian" | "emergency_contact";
        isPrimaryContact: boolean;
        emergencyContact: boolean;
        canPickup: boolean;
        notes?: string | undefined;
    }[];
}, {
    total: number;
    parents: {
        id: string;
        tenantId: string;
        createdAt: Date;
        studentId: string;
        parent: {
            email: string;
            id: string;
            name: string;
        };
        parentId: string;
        relationshipType: "parent" | "guardian" | "emergency_contact";
        isPrimaryContact: boolean;
        emergencyContact: boolean;
        canPickup: boolean;
        notes?: string | undefined;
    }[];
}>;
export type StudentStatus = z.infer<typeof StudentStatusSchema>;
export type ParentRelationship = z.infer<typeof ParentRelationshipSchema>;
export type StudentProfile = z.infer<typeof StudentProfileSchema>;
export type CreateStudentProfile = z.infer<typeof CreateStudentProfileSchema>;
export type CreateStudentWithUser = z.infer<typeof CreateStudentWithUserSchema>;
export type UpdateStudentProfile = z.infer<typeof UpdateStudentProfileSchema>;
export type StudentParent = z.infer<typeof StudentParentSchema>;
export type CreateStudentParent = z.infer<typeof CreateStudentParentSchema>;
export type UpdateStudentParent = z.infer<typeof UpdateStudentParentSchema>;
export type StudentWithUser = z.infer<typeof StudentWithUserSchema>;
export type StudentParentWithUser = z.infer<typeof StudentParentWithUserSchema>;
export type StudentQuery = z.infer<typeof StudentQuerySchema>;
export type StudentParentQuery = z.infer<typeof StudentParentQuerySchema>;
export type StudentListResponse = z.infer<typeof StudentListResponseSchema>;
export type StudentParentListResponse = z.infer<typeof StudentParentListResponseSchema>;
//# sourceMappingURL=student.d.ts.map