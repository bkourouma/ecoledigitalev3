import { z } from "zod";

// Enums
export const ClassroomTypeSchema = z.enum([
  'amphitheatre',
  'salle_cours',
  'laboratoire',
  'salle_informatique',
  'atelier',
  'bibliotheque',
  'salle_reunion',
  'autre'
]);

export const ClassroomStatusSchema = z.enum([
  'disponible',
  'occupe',
  'maintenance',
  'hors_service'
]);

export const ReservationStatusSchema = z.enum([
  'confirmed',
  'cancelled',
  'pending'
]);

// Base Classroom Schema
export const ClassroomSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(50),
  type: ClassroomTypeSchema,
  capacity: z.number().int().positive(),
  floor: z.number().int().optional(),
  building: z.string().max(100).optional(),
  description: z.string().optional(),
  equipment: z.array(z.string()).optional(),
  status: ClassroomStatusSchema,
  isActive: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Create Classroom Schema
export const CreateClassroomSchema = z.object({
  name: z.string().min(1, "Le nom est requis").max(255),
  code: z.string().min(1, "Le code est requis").max(50),
  type: ClassroomTypeSchema,
  capacity: z.number().int().positive("La capacité doit être positive"),
  floor: z.number().int().optional(),
  building: z.string().max(100).optional(),
  description: z.string().optional(),
  equipment: z.array(z.string()).optional(),
  status: ClassroomStatusSchema.optional(),
  isActive: z.boolean().optional(),
});

// Update Classroom Schema
export const UpdateClassroomSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  code: z.string().min(1).max(50).optional(),
  type: ClassroomTypeSchema.optional(),
  capacity: z.number().int().positive().optional(),
  floor: z.number().int().optional(),
  building: z.string().max(100).optional(),
  description: z.string().optional(),
  equipment: z.array(z.string()).optional(),
  status: ClassroomStatusSchema.optional(),
  isActive: z.boolean().optional(),
});

// Classroom Reservation Schema
export const ClassroomReservationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  classroomId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  startDatetime: z.date(),
  endDatetime: z.date(),
  reservedBy: z.string().uuid(),
  courseId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  status: ReservationStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Create Reservation Schema
export const CreateReservationSchema = z.object({
  classroomId: z.string().uuid("ID de salle requis"),
  title: z.string().min(1, "Le titre est requis").max(255),
  description: z.string().optional(),
  startDatetime: z.date(),
  endDatetime: z.date(),
  courseId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
}).refine(
  (data) => data.endDatetime > data.startDatetime,
  {
    message: "La date de fin doit être après la date de début",
    path: ["endDatetime"],
  }
);

// Update Reservation Schema
export const UpdateReservationSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  startDatetime: z.date().optional(),
  endDatetime: z.date().optional(),
  courseId: z.string().uuid().optional(),
  classId: z.string().uuid().optional(),
  status: ReservationStatusSchema.optional(),
});

// Extended schemas with relations
export const ClassroomWithReservationsSchema = ClassroomSchema.extend({
  reservations: z.array(ClassroomReservationSchema).optional(),
});

export const ReservationWithDetailsSchema = ClassroomReservationSchema.extend({
  classroom: ClassroomSchema.optional(),
  reservedByUser: z.object({
    id: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
  }).optional(),
  course: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
  }).optional(),
  class: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
  }).optional(),
});

// Type exports
export type ClassroomType = z.infer<typeof ClassroomTypeSchema>;
export type ClassroomStatus = z.infer<typeof ClassroomStatusSchema>;
export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

export type Classroom = z.infer<typeof ClassroomSchema>;
export type CreateClassroom = z.infer<typeof CreateClassroomSchema>;
export type UpdateClassroom = z.infer<typeof UpdateClassroomSchema>;

export type ClassroomReservation = z.infer<typeof ClassroomReservationSchema>;
export type CreateReservation = z.infer<typeof CreateReservationSchema>;
export type UpdateReservation = z.infer<typeof UpdateReservationSchema>;

export type ClassroomWithReservations = z.infer<typeof ClassroomWithReservationsSchema>;
export type ReservationWithDetails = z.infer<typeof ReservationWithDetailsSchema>;

// Utility functions for display
export const getClassroomTypeLabel = (type: ClassroomType): string => {
  const labels: Record<ClassroomType, string> = {
    amphitheatre: "Amphithéâtre",
    salle_cours: "Salle de cours",
    laboratoire: "Laboratoire",
    salle_informatique: "Salle informatique",
    atelier: "Atelier",
    bibliotheque: "Bibliothèque",
    salle_reunion: "Salle de réunion",
    autre: "Autre",
  };
  return labels[type];
};

export const getClassroomStatusLabel = (status: ClassroomStatus): string => {
  const labels: Record<ClassroomStatus, string> = {
    disponible: "Disponible",
    occupe: "Occupée",
    maintenance: "En maintenance",
    hors_service: "Hors service",
  };
  return labels[status];
};

export const getReservationStatusLabel = (status: ReservationStatus): string => {
  const labels: Record<ReservationStatus, string> = {
    confirmed: "Confirmée",
    cancelled: "Annulée",
    pending: "En attente",
  };
  return labels[status];
};
