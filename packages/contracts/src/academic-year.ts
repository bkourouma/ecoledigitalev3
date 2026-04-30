import { z } from "zod";

// Enrollment Status Enum
export const EnrollmentStatusSchema = z.enum([
  'active',
  'suspended', 
  'completed',
  'dropped',
  'transferred'
]);

export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;

// Fee Structure Schema
export const FeeStructureSchema = z.object({
  inscription: z.number().nonnegative(),
  scolarite: z.number().nonnegative(),
  annexes: z.number().nonnegative(),
  autres: z.number().nonnegative(),
  total: z.number().nonnegative(),
  currency: z.string().default('XOF'),
});

export type FeeStructure = z.infer<typeof FeeStructureSchema>;

// Academic Year Schemas
export const AcademicYearSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(255),
  startDate: z.date(),
  endDate: z.date(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const BaseAcademicYearSchema = z.object({
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)"),
});

export const CreateAcademicYearSchema = BaseAcademicYearSchema.refine(
  (data) => new Date(data.endDate) > new Date(data.startDate),
  {
    message: "La date de fin doit être postérieure à la date de début",
    path: ["endDate"],
  }
);

export const UpdateAcademicYearSchema = BaseAcademicYearSchema.partial().refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.endDate) > new Date(data.startDate);
    }
    return true;
  },
  {
    message: "La date de fin doit être postérieure à la date de début",
    path: ["endDate"],
  }
);

export const SetActiveAcademicYearSchema = z.object({
  academicYearId: z.string().uuid(),
});

// Class Schemas
export const ClassSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  programmeId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  maxStudents: z.number().int().positive(),
  classroomId: z.string().uuid().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateClassSchema = z.object({
  programmeId: z.string().uuid("Le programme est requis"),
  academicYearId: z.string().uuid("L'année académique est requise"),
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long"),
  code: z.string().min(1, "Le code est requis").max(50, "Le code est trop long"),
  maxStudents: z.number().int().positive("Le nombre maximum d'étudiants doit être positif").default(30),
  courseIds: z.array(z.string().uuid()).default([]),
  classroomId: z.string().uuid().optional(),
});

export const UpdateClassSchema = z.object({
  name: z.string().min(1, "Le nom est requis").max(255, "Le nom est trop long").optional(),
  code: z.string().min(1, "Le code est requis").max(50, "Le code est trop long").optional(),
  maxStudents: z.number().int().positive("Le nombre maximum d'étudiants doit être positif").optional(),
  courseIds: z.array(z.string().uuid()).optional(),
  classroomId: z.string().uuid().optional(),
});

// Class Course Schemas
export const ClassCourseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  classId: z.string().uuid(),
  courseId: z.string().uuid(),
  isRequired: z.boolean(),
  createdAt: z.date(),
});

// Student Enrollment Schemas
export const StudentEnrollmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  classId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  fees: FeeStructureSchema,
  originSchool: z.string().max(255).optional(),
  lv2: z.string().max(100).optional(),
  scholarshipLevel: z.string().max(100).optional(),
  isRepeating: z.boolean().optional(),
  isTransfer: z.boolean().optional(),
  isInscribed: z.boolean().optional(),
  transferDecision: z.string().max(255).optional(),
  affectationStatus: z.enum(['affecte', 'non_affecte', 'prise_en_charge']).optional(),
  affectationDecision: z.string().max(255).optional(),
  cepeCode: z.string().max(100).optional(),
  enrollmentDate: z.date(),
  status: EnrollmentStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateStudentEnrollmentSchema = z.object({
  studentId: z.string().uuid("L'étudiant est requis"),
  classId: z.string().uuid("La classe est requise"),
  academicYearId: z.string().uuid("L'année académique est requise"),
  originSchool: z.string().max(255).optional(),
  lv2: z.string().max(100).optional(),
  scholarshipLevel: z.enum(['oui', 'non']).optional(),
  isRepeating: z.boolean().optional(),
  isTransfer: z.boolean().optional(),
  isInscribed: z.boolean().optional(),
  transferDecision: z.string().max(255).optional(),
  affectationStatus: z.enum(['affecte', 'non_affecte', 'prise_en_charge']).optional(),
  affectationDecision: z.string().max(255).optional(),
  cepeCode: z.string().max(100).optional(),
  fees: z.object({
    inscription: z.number().nonnegative("Les frais d'inscription doivent être positifs").default(0),
    scolarite: z.number().nonnegative("Les frais de scolarité doivent être positifs").default(0),
    annexes: z.number().nonnegative("Les frais annexes doivent être positifs").default(0),
    autres: z.number().nonnegative("Les autres frais doivent être positifs").default(0),
    currency: z.string().default('XOF'),
  }),
  enrollmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)").optional(),
  status: EnrollmentStatusSchema.default('active'),
});

export const UpdateStudentEnrollmentSchema = z.object({
  classId: z.string().uuid().optional(),
  originSchool: z.string().max(255).optional(),
  lv2: z.string().max(100).optional(),
  scholarshipLevel: z.enum(['oui', 'non']).optional(),
  isRepeating: z.boolean().optional(),
  isTransfer: z.boolean().optional(),
  isInscribed: z.boolean().optional(),
  transferDecision: z.string().max(255).optional(),
  affectationStatus: z.enum(['affecte', 'non_affecte', 'prise_en_charge']).optional(),
  affectationDecision: z.string().max(255).optional(),
  cepeCode: z.string().max(100).optional(),
  enrollmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date invalide (YYYY-MM-DD)").optional(),
  fees: z.object({
    inscription: z.number().nonnegative("Les frais d'inscription doivent être positifs").optional(),
    scolarite: z.number().nonnegative("Les frais de scolarité doivent être positifs").optional(),
    annexes: z.number().nonnegative("Les frais annexes doivent être positifs").optional(),
    autres: z.number().nonnegative("Les autres frais doivent être positifs").optional(),
    currency: z.string().optional(),
  }).optional(),
  status: EnrollmentStatusSchema.optional(),
});

export const BulkEnrollmentSchema = z.object({
  studentIds: z.array(z.string().uuid()).min(1, "Au moins un étudiant doit être sélectionné"),
  classId: z.string().uuid("La classe est requise"),
  academicYearId: z.string().uuid("L'année académique est requise"),
  fees: z.object({
    inscription: z.number().nonnegative("Les frais d'inscription doivent être positifs").default(0),
    scolarite: z.number().nonnegative("Les frais de scolarité doivent être positifs").default(0),
    annexes: z.number().nonnegative("Les frais annexes doivent être positifs").default(0),
    autres: z.number().nonnegative("Les autres frais doivent être positifs").default(0),
    currency: z.string().default('XOF'),
  }),
});

// Response Types with Relations
export const AcademicYearWithStatsSchema = AcademicYearSchema.extend({
  classCount: z.number().int().nonnegative(),
  studentCount: z.number().int().nonnegative(),
});

export const ClassWithDetailsSchema = ClassSchema.extend({
  programme: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
  }),
  academicYear: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
  classroom: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
    capacity: z.number().int().positive().optional(),
  }).nullable().optional(),
  courseCount: z.number().int().nonnegative(),
  studentCount: z.number().int().nonnegative(),
  courses: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
    isRequired: z.boolean(),
  })).optional(),
});

export const StudentEnrollmentWithDetailsSchema = StudentEnrollmentSchema.extend({
  student: z.object({
    id: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    studentNumber: z.string().nullable(),
  }),
  class: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
    programme: z.object({
      name: z.string(),
      code: z.string(),
    }),
  }),
  academicYear: z.object({
    id: z.string().uuid(),
    name: z.string(),
  }),
});

// Export types
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
