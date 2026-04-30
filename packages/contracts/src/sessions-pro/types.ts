import { z } from "zod";
import {
  SessionProStatusSchema,
  DeliveryModeSchema,
  SessionListQuerySchema,
  SessionListItemSchema,
  FormationBasicSchema,
  FormateurBasicSchema,
  SessionListResponseSchema,
  CalendarQuerySchema,
} from "./session.schema";
import { CalendarEventSchema } from "./calendar.schema";
import { EnrollmentStatusSchema, PaymentStatusSchema } from "./admin.schema";

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type DeliveryMode = z.infer<typeof DeliveryModeSchema>;
export type SessionProStatus = z.infer<typeof SessionProStatusSchema>;
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export type SessionListQuery = z.infer<typeof SessionListQuerySchema>;
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;
export type SessionListItem = z.infer<typeof SessionListItemSchema>;
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

// Additional types for admin and enrollment details
export const EnrollmentTypeSchema = z.enum(["individuelle", "entreprise"]);
export type EnrollmentType = z.infer<typeof EnrollmentTypeSchema>;

export const FormateurRoleSchema = z.enum(["principal", "assistant", "intervenant"]);
export type FormateurRole = z.infer<typeof FormateurRoleSchema>;

// Formation detail schema
export const FormationDetailSchema = FormationBasicSchema.extend({
  description_courte: z.string().nullable().optional(),
  objectifs: z.array(z.string()).optional(),
  programme: z.string().nullable().optional(),
});

// Formateur detail schema
export const FormateurDetailSchema = FormateurBasicSchema.extend({
  bio: z.string().nullable().optional(),
  photo: z.string().url().nullable().optional(),
  specialites: z.array(z.string()).optional(),
});

// Session detail schema
export const SessionDetailSchema = z.object({
  id: z.string().uuid(),
  code_session: z.string(),
  formation: FormationDetailSchema,
  date_debut: z.string(), // ISO date
  date_fin: z.string(), // ISO date
  horaires: z.string().nullable(),
  mode_formation: DeliveryModeSchema,
  lieu: z.string().nullable().optional(),
  lien_visio: z.string().url().nullable().optional(),
  places_totales: z.number().int().min(0),
  places_reservees: z.number().int().min(0),
  places_disponibles: z.number().int().min(0),
  statut: SessionProStatusSchema,
  prix_ht: z.number().nullable().optional(),
  prix_ttc: z.number().nullable().optional(),
  formateurs: z.array(FormateurDetailSchema),
  inscriptions_count: z.number().int().min(0),
});

export const SessionDetailResponseSchema = z.object({
  success: z.literal(true),
  data: SessionDetailSchema,
});

export type SessionDetail = z.infer<typeof SessionDetailSchema>;

export const AvailabilityResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    places_disponibles: z.number().int().min(0),
    places_reservees: z.number().int().min(0),
    places_totales: z.number().int().min(0),
    peut_inscrire: z.boolean(),
    message: z.string().nullable().optional(),
  }),
});

// Admin session detail
export const AdminSessionDetailSchema = SessionDetailSchema.extend({
  notes_internes: z.string().nullable().optional(),
});

export const AdminSessionDetailResponseSchema = z.object({
  success: z.literal(true),
  data: AdminSessionDetailSchema,
});

export type AdminSessionDetail = z.infer<typeof AdminSessionDetailSchema>;

// Enrollment detail
export const EnrollmentDetailSchema = z.object({
  id: z.string().uuid(),
  apprenant: z.object({
    id: z.string().uuid(),
    nom: z.string(),
    prenom: z.string(),
    email: z.string().email(),
    telephone: z.string().nullable().optional(),
  }),
  entreprise: z
    .object({
      id: z.string().uuid(),
      nom: z.string(),
    })
    .nullable()
    .optional(),
  type_inscription: EnrollmentTypeSchema,
  statut: EnrollmentStatusSchema,
  statut_paiement: PaymentStatusSchema,
  date_inscription: z.string(), // ISO datetime
});

export const EnrollmentListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    inscrits: z.array(EnrollmentDetailSchema),
    total: z.number().int().min(0),
  }),
});

export type EnrollmentDetail = z.infer<typeof EnrollmentDetailSchema>;

// Trainer availability
export const TrainerAvailabilityItemSchema = z.object({
  id: z.string().uuid(),
  nom: z.string(),
  prenom: z.string(),
  disponible: z.boolean(),
  conflits: z
    .array(
      z.object({
        session_id: z.string().uuid(),
        code_session: z.string(),
        formation: z.string(),
        date_debut: z.string(), // ISO date
        date_fin: z.string(), // ISO date
      })
    )
    .optional(),
});

export const TrainerAvailabilityResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    formateurs: z.array(TrainerAvailabilityItemSchema),
  }),
});

export type TrainerAvailabilityItem = z.infer<typeof TrainerAvailabilityItemSchema>;

// Status update response
export const UpdateStatusResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
  statut: SessionProStatusSchema,
  updated_at: z.string(), // ISO datetime
  }),
});

// Distinct name: barrel also exports teacher-students `ErrorResponseSchema`.
export const SessionProErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  message: z.string(),
  details: z
    .array(
      z.object({
        field: z.string(),
        message: z.string(),
      })
    )
    .optional(),
});

