import { z } from "zod";

// ENUM schemas
export const StudentStatusSchema = z.enum(['active', 'graduated', 'suspended', 'dropped', 'transfer']);
export const ParentRelationshipSchema = z.enum(['parent', 'guardian', 'emergency_contact']);
export const GenderSchema = z.enum(['masculin', 'feminin']);

// Student Profile Schema
export const StudentProfileSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  studentNumber: z.string().max(50),
  currentYear: z.number().int().min(1).max(10),
  status: StudentStatusSchema,
  bio: z.string().optional(),
  dateOfBirth: z.date().optional(),
  placeOfBirth: z.string().max(255).optional(),
  nationality: z.string().max(100).optional(),
  address: z.string().optional(),
  phone: z.string().max(20).optional(),
  emergencyPhone: z.string().max(20).optional(),
  gender: GenderSchema,
  fatherName: z.string().max(255).optional(),
  motherName: z.string().max(255).optional(),
  birthCertificateNumber: z.string().max(100).optional(),
  birthCertificateDate: z.date().optional(),
  civilRegistryOffice: z.string().max(255).optional(),
  subPrefecture: z.string().max(255).optional(),
  originSchool: z.string().max(255).optional(),
  isRepeating: z.boolean().optional(),
  lv2: z.string().max(100).optional(),
  scholarshipLevel: z.string().max(100).optional(),
  isTransfer: z.boolean().optional(),
  transferDecision: z.string().max(255).optional(),
  affectationStatus: z.enum(['affecte', 'non_affecte', 'prise_en_charge']).optional(),
  affectationDecision: z.string().max(255).optional(),
  cepeCode: z.string().max(100).optional(),
  isInscribed: z.boolean().optional(),
  inscriptionDate: z.date().optional(),
  residence: z.string().max(255).optional(),
  establishmentMatricule: z.string().max(100).optional(),
  dspsMatricule: z.string().max(100).optional(),
  dspsPreviousMatricule: z.string().max(100).optional(),
  classId: z.string().uuid().optional(),
  className: z.string().max(255).optional(),
  programmeName: z.string().max(255).optional(),
  academicYearId: z.string().uuid().optional(),
  academicYearName: z.string().max(255).optional(),
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Create Student Profile Schema
export const CreateStudentProfileSchema = z.object({
  userId: z.string().uuid(),
  studentNumber: z.string().max(50).optional(), // Auto-generated if not provided
  currentYear: z.number().int().min(1).max(10).default(1),
  status: StudentStatusSchema.default('active'),
  bio: z.string().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD format
  placeOfBirth: z.string().max(255).optional(),
  nationality: z.string().max(100).optional(),
  address: z.string().optional(),
  phone: z.string().max(20).optional(),
  emergencyPhone: z.string().max(20).optional(),
  gender: GenderSchema,
  fatherName: z.string().max(255).optional(),
  motherName: z.string().max(255).optional(),
  birthCertificateNumber: z.string().max(100).optional(),
  birthCertificateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  civilRegistryOffice: z.string().max(255).optional(),
  subPrefecture: z.string().max(255).optional(),
  residence: z.string().max(255).optional(),
  establishmentMatricule: z.string().max(100).optional(),
  dspsMatricule: z.string().max(100).optional(),
  dspsPreviousMatricule: z.string().max(100).optional(),
});

// Create Student with User Schema (creates both user and student profile)
export const CreateStudentWithUserSchema = z.object({
  // User fields
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8),

  // Student profile fields
  matricule: z.string().max(50).optional(), // Auto-generated if not provided
  currentYear: z.number().int().min(1).max(10).default(1),
  status: StudentStatusSchema.default('active'),
  bio: z.string().optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD format
  placeOfBirth: z.string().max(255).optional(),
  nationality: z.string().max(100).optional(),
  address: z.string().optional(),
  phone: z.string().max(20).optional(),
  emergencyPhone: z.string().max(20).optional(),
  gender: GenderSchema,
  fatherName: z.string().max(255).optional(),
  motherName: z.string().max(255).optional(),
  birthCertificateNumber: z.string().max(100).optional(),
  birthCertificateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  civilRegistryOffice: z.string().max(255).optional(),
  subPrefecture: z.string().max(255).optional(),
  residence: z.string().max(255).optional(),
  establishmentMatricule: z.string().max(100).optional(),
  dspsMatricule: z.string().max(100).optional(),
  dspsPreviousMatricule: z.string().max(100).optional(),
});

// Update Student Profile Schema
export const UpdateStudentProfileSchema = CreateStudentProfileSchema.partial().extend({
  status: StudentStatusSchema.optional(),
  currentYear: z.number().int().min(1).max(10).optional(),
});

// Student Parent Relationship Schema
export const StudentParentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  studentId: z.string().uuid(),
  parentId: z.string().uuid(),
  relationshipType: ParentRelationshipSchema,
  isPrimaryContact: z.boolean(),
  emergencyContact: z.boolean(),
  canPickup: z.boolean(),
  notes: z.string().optional(),
  createdAt: z.date(),
});

// Create Student Parent Relationship Schema
export const CreateStudentParentSchema = z.object({
  parentId: z.string().uuid(),
  relationshipType: ParentRelationshipSchema.default('parent'),
  isPrimaryContact: z.boolean().default(false),
  emergencyContact: z.boolean().default(false),
  canPickup: z.boolean().default(true),
  notes: z.string().optional(),
});

// Update Student Parent Relationship Schema
export const UpdateStudentParentSchema = CreateStudentParentSchema.partial();

// Student with User Info Schema (for display purposes)
export const StudentWithUserSchema = StudentProfileSchema.extend({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
  }),
});

// Student Parent with User Info Schema
export const StudentParentWithUserSchema = StudentParentSchema.extend({
  parent: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
  }),
});

// Query schemas
export const StudentQuerySchema = z.object({
  status: StudentStatusSchema.optional(),
  currentYear: z.coerce.number().int().min(1).max(10).optional(),
  academicYearId: z.string().uuid().optional(),
  search: z.string().optional(), // Search by name, email, or student number
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(20),
});

export const StudentParentQuerySchema = z.object({
  relationshipType: ParentRelationshipSchema.optional(),
  isPrimaryContact: z.boolean().optional(),
  emergencyContact: z.boolean().optional(),
});

// Response schemas
export const StudentListResponseSchema = z.object({
  students: z.array(StudentWithUserSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

export const StudentParentListResponseSchema = z.object({
  parents: z.array(StudentParentWithUserSchema),
  total: z.number(),
});

// Type exports
export type StudentStatus = z.infer<typeof StudentStatusSchema>;
export type ParentRelationship = z.infer<typeof ParentRelationshipSchema>;
export type Gender = z.infer<typeof GenderSchema>;
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
