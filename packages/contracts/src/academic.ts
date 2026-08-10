import { z } from "zod";

// Enum schemas
export const CycleTypeSchema = z.enum(['academic', 'professional', 'short', 'certification']);
export const CycleStatusSchema = z.enum(['draft', 'active', 'archived']);
export const ProgrammeStatusSchema = z.enum(['draft', 'review', 'approved', 'active', 'archived']);
export const CourseStatusSchema = z.enum(['draft', 'active', 'inactive']);
export const DeliveryModeSchema = z.enum(['presential', 'remote', 'hybrid', 'elearning']);
export const ContractTypeSchema = z.enum(['permanent', 'temporary', 'freelance']);
export const TeacherStatusSchema = z.enum(['active', 'inactive', 'suspended']);
export const SessionTypeSchema = z.enum(['theory', 'practical', 'exam', 'evaluation']);

// Base schemas
export const CycleSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(20),
  type: CycleTypeSchema,
  durationMonths: z.number().int().positive(),
  description: z.string().optional(),
  certificationLevel: z.string().max(50).optional(),
  status: CycleStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateCycleSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(20).optional(),
  type: CycleTypeSchema,
  durationMonths: z.number().int().positive().optional(),
  description: z.string().optional(),
  certificationLevel: z.string().max(50).optional(),
  status: CycleStatusSchema.default('active'),
});

export const UpdateCycleSchema = CreateCycleSchema.partial().extend({
  status: CycleStatusSchema.optional(),
});

export const ProgrammeSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  cycleId: z.string().uuid(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(20),
  version: z.string().max(10),
  description: z.string().optional(),
  objectives: z.array(z.string()).optional(),
  ectsCredits: z.number().int().nonnegative().optional(),
  academicYear: z.string().regex(/^\d{4}-\d{4}$/).optional(),
  status: ProgrammeStatusSchema,
  approvedBy: z.string().uuid().optional(),
  approvedAt: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateProgrammeSchema = z.object({
  cycleId: z.string().uuid(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(20),
  version: z.string().max(10).default('1.0'),
  description: z.string().optional(),
  domaine: z.string().max(255).optional(),
  objectives: z.array(z.string()).optional(),
  ectsCredits: z.number().int().nonnegative().optional(),
  academicYear: z.string().regex(/^\d{4}-\d{4}$/).optional(),
  status: ProgrammeStatusSchema.default('active'),
});

export const UpdateProgrammeSchema = CreateProgrammeSchema.partial().extend({
  status: ProgrammeStatusSchema.optional(),
});

export const ApproveProgrammeSchema = z.object({
  approvedBy: z.string().uuid(),
});



// Cycle Fees (default fees per cycle)
export const CycleFeesSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  cycleId: z.string().uuid(),
  inscription: z.number().nonnegative(),
  scolarite: z.number().nonnegative(),
  annexes: z.number().nonnegative(),
  autres: z.number().nonnegative(),
  currency: z.string().length(3).default('XOF'),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const UpsertCycleFeesSchema = z.object({
  cycleId: z.string().uuid(),
  inscription: z.number().nonnegative().default(0),
  scolarite: z.number().nonnegative().default(0),
  annexes: z.number().nonnegative().default(0),
  autres: z.number().nonnegative().default(0),
  currency: z.string().length(3).default('XOF'),
});

export type CycleFees = z.infer<typeof CycleFeesSchema>;
export type UpsertCycleFees = z.infer<typeof UpsertCycleFeesSchema>;


export const CourseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  programmeId: z.string().uuid(),
  bilanTypeId: z.string().uuid(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(20).optional(),
  cm: z.string().max(255).optional(),
  td: z.string().max(255).optional(),
  tp: z.string().max(255).optional(),
  coef: z.number().finite().positive().nullish(),
  vhh: z.string().max(255).optional(),
  description: z.string().optional(),
  objectives: z.array(z.string()).optional(),
  hoursTotal: z.number().int().positive().optional(),
  hoursTheory: z.number().int().nonnegative().optional(),
  hoursPractical: z.number().int().nonnegative().optional(),
  deliveryMode: DeliveryModeSchema.optional(),
  prerequisites: z.array(z.string()).optional(),
  evaluationMethods: z.array(z.string()).optional(),
  resources: z.record(z.any()).optional(),
  status: CourseStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

const coefInSchema = z.number().finite().positive().optional();

export const CreateCourseSchema = z.object({
  programmeId: z.string().uuid(),
  bilanTypeId: z.string().uuid(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(20).optional(),
  cm: z.string().max(255).optional(),
  td: z.string().max(255).optional(),
  tp: z.string().max(255).optional(),
  coef: z.preprocess((val: unknown) => {
    if (val === "" || val === null || val === undefined) return undefined;
    const n = typeof val === "number" ? val : Number(String(val).replace(",", "."));
    if (!Number.isFinite(n)) return undefined;
    return n;
  }, coefInSchema),
  vhh: z.string().max(255).optional(),
  description: z.string().optional(),
  objectives: z.array(z.string()).optional(),
  hoursTotal: z.number().int().positive().optional(),
  hoursTheory: z.number().int().nonnegative().optional(),
  hoursPractical: z.number().int().nonnegative().optional(),
  deliveryMode: DeliveryModeSchema.optional(),
  prerequisites: z.array(z.string()).optional(),
  evaluationMethods: z.array(z.string()).optional(),
  resources: z.record(z.any()).optional(),
  status: CourseStatusSchema.default('active'),
});

export const UpdateCourseSchema = CreateCourseSchema.partial().extend({
  status: CourseStatusSchema.optional(),
});

export const TeacherSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  /** Mot de passe en clair stocké côté admin (users.initial_password), jamais le hash */
  initialPassword: z.string().optional().nullable(),
  employeeNumber: z.string().max(20).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  specialties: z.array(z.string()).optional(),
  bio: z.string().optional(),
  qualifications: z.array(z.string()).optional(),
  hireDate: z.string().optional(),
  contractType: ContractTypeSchema,
  hourlyRate: z.number().nonnegative().optional(),
  status: TeacherStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Modèle d'email d'envoi des identifiants enseignant.
 * `subject` et `body` acceptent des variables `{{firstName}}`, `{{email}}`,
 * `{{password}}`, `{{loginUrl}}`, `{{schoolName}}`, etc.
 */
export const TeacherCredentialsEmailTemplateSchema = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20000),
});

export const CreateTeacherSchema = z.object({
  userId: z.string().uuid().optional(),
  employeeNumber: z.string().max(20).optional(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  specialties: z.array(z.string()).optional(),
  bio: z.string().optional(),
  qualifications: z.array(z.string()).optional(),
  hireDate: z.string().optional(),
  contractType: ContractTypeSchema,
  hourlyRate: z.number().nonnegative().optional(),
  /** Si renseigné avec un email : création du compte utilisateur (comme les parents) */
  password: z.string().min(8).optional(),
  /** Envoyer les identifiants par email juste après la création (défaut : true) */
  sendCredentialsEmail: z.boolean().optional(),
  /** Modèle personnalisé pour cet envoi ; sinon le modèle du tenant est utilisé */
  credentialsEmailTemplate: TeacherCredentialsEmailTemplateSchema.optional(),
  /** Enregistrer aussi ce modèle comme modèle par défaut de l'établissement */
  saveCredentialsEmailTemplate: z.boolean().optional(),
});

export const UpdateTeacherSchema = CreateTeacherSchema.partial()
  .omit({
    password: true,
    sendCredentialsEmail: true,
    credentialsEmailTemplate: true,
    saveCredentialsEmailTemplate: true,
  })
  .extend({
    status: TeacherStatusSchema.optional(),
  });

export const CourseAssignmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  courseId: z.string().uuid(),
  teacherId: z.string().uuid(),
  academicYear: z.string().regex(/^\d{4}-\d{4}$/),
  semester: z.number().int().min(1).max(8).optional(),
  hoursAssigned: z.number().int().positive(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateCourseAssignmentSchema = z.object({
  courseId: z.string().uuid(),
  teacherId: z.string().uuid(),
  academicYear: z.string().regex(/^\d{4}-\d{4}$/),
  semester: z.number().int().min(1).max(8).optional(),
  hoursAssigned: z.number().int().positive(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

export const UpdateCourseAssignmentSchema = CreateCourseAssignmentSchema.partial();

export const TeachingHourSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  sessionDate: z.date(),
  hoursTaught: z.number().positive(),
  sessionType: SessionTypeSchema,
  notes: z.string().optional(),
  validatedBy: z.string().uuid().optional(),
  validatedAt: z.date().optional(),
  createdAt: z.date(),
});

export const CreateTeachingHourSchema = z.object({
  assignmentId: z.string().uuid(),
  sessionDate: z.date(),
  hoursTaught: z.number().positive(),
  sessionType: SessionTypeSchema,
  notes: z.string().optional(),
});

export const ValidateTeachingHourSchema = z.object({
  validatedBy: z.string().uuid(),
});

// Type exports
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
export type TeacherCredentialsEmailTemplate = z.infer<typeof TeacherCredentialsEmailTemplateSchema>;

export type CourseAssignment = z.infer<typeof CourseAssignmentSchema>;
export type CreateCourseAssignment = z.infer<typeof CreateCourseAssignmentSchema>;
export type UpdateCourseAssignment = z.infer<typeof UpdateCourseAssignmentSchema>;

export type TeachingHour = z.infer<typeof TeachingHourSchema>;
export type CreateTeachingHour = z.infer<typeof CreateTeachingHourSchema>;
export type ValidateTeachingHour = z.infer<typeof ValidateTeachingHourSchema>;

// Query schemas for API endpoints
export const CycleQuerySchema = z.object({
  status: CycleStatusSchema.optional(),
  type: CycleTypeSchema.optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export const ProgrammeQuerySchema = z.object({
  cycleId: z.string().uuid().optional(),
  status: ProgrammeStatusSchema.optional(),
  academicYear: z.string().regex(/^\d{4}-\d{4}$/).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export const CourseQuerySchema = z.object({
  programmeId: z.string().uuid().optional(),
  status: CourseStatusSchema.optional(),
  deliveryMode: DeliveryModeSchema.optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export const TeacherQuerySchema = z.object({
  email: z.string().email().optional(),
  status: TeacherStatusSchema.optional(),
  contractType: ContractTypeSchema.optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export const CourseAssignmentQuerySchema = z.object({
  courseId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  academicYear: z.string().regex(/^\d{4}-\d{4}$/).optional(),
  semester: z.number().int().min(1).max(8).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export const TeachingHourQuerySchema = z.object({
  assignmentId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  validated: z.boolean().optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type CycleQuery = z.infer<typeof CycleQuerySchema>;
export type ProgrammeQuery = z.infer<typeof ProgrammeQuerySchema>;
export type CourseQuery = z.infer<typeof CourseQuerySchema>;
export type TeacherQuery = z.infer<typeof TeacherQuerySchema>;
export type CourseAssignmentQuery = z.infer<typeof CourseAssignmentQuerySchema>;
export type TeachingHourQuery = z.infer<typeof TeachingHourQuerySchema>;
