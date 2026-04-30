import { z } from "zod";

export const AssignmentContractTypeSchema = z.enum(["salarie", "vacataire"]);
export type AssignmentContractType = z.infer<typeof AssignmentContractTypeSchema>;

export const AssignmentStatusSchema = z.enum(["active", "paused", "ended", "cancelled"]);
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;

export const TeacherAssignmentSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  classCourseId: z.string().uuid(),
  teacherId: z.string().uuid(),
  contractType: AssignmentContractTypeSchema,
  datebut: z.date(),
  datefin: z.date(),
  courseAmount: z.number().nonnegative().nullable().optional(),
  status: AssignmentStatusSchema,
  notes: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateTeacherAssignmentSchema = z.object({
  classCourseId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  teacherId: z.string().uuid(),
  contractType: AssignmentContractTypeSchema,
  datebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  datefin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  courseAmount: z.number().nonnegative().optional(),
  status: AssignmentStatusSchema.default("active"),
  notes: z.string().optional(),
})
.refine((data) => !!data.classCourseId || (!!data.classId && !!data.courseId), {
  message: "Provide either classCourseId or classId + courseId",
  path: ["classCourseId"],
})
.refine((data) => {
  if (data.contractType === "vacataire") {
    return typeof data.courseAmount === "number" && data.courseAmount > 0;
  }
  return true;
}, { message: "courseAmount is required and must be > 0 for vacataire", path: ["courseAmount"] });

export const UpdateTeacherAssignmentSchema = z.object({
  classCourseId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  courseId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  contractType: AssignmentContractTypeSchema.optional(),
  datebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  datefin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  courseAmount: z.number().nonnegative().nullable().optional(),
  status: AssignmentStatusSchema.optional(),
  notes: z.string().optional(),
}).refine((data) => {
  if (data.contractType === "vacataire") {
    // If setting to vacataire, require courseAmount
    return data.courseAmount === null || typeof data.courseAmount === "number";
  }
  return true;
}, { message: "Invalid courseAmount for contract type", path: ["courseAmount"] });

export type TeacherAssignment = z.infer<typeof TeacherAssignmentSchema>;
export type CreateTeacherAssignment = z.infer<typeof CreateTeacherAssignmentSchema>;
export type UpdateTeacherAssignment = z.infer<typeof UpdateTeacherAssignmentSchema>;

