/**
 * API Contracts: Session Management & Calendar
 * 
 * Zod schemas for session management API endpoints
 * To be placed in: packages/contracts/src/sessions-pro.ts
 */

import { z } from "zod";
import { PaginationSchema } from "../common";

// ============================================================================
// ENUM SCHEMAS
// ============================================================================

export const DeliveryModeSchema = z.enum(["presentiel", "distanciel", "hybride"]);

export const SessionStatusSchema = z.enum([
  "planifiee",
  "ouverte",
  "complete",
  "en_cours",
  "terminee",
  "annulee",
]);

export const FormateurRoleSchema = z.enum(["principal", "assistant", "intervenant"]);

export const EnrollmentStatusSchema = z.enum(["confirmee", "en_attente", "annulee"]);

export const PaymentStatusSchema = z.enum(["valide", "en_attente", "echec"]);

export const EnrollmentTypeSchema = z.enum(["individuelle", "entreprise"]);

// ============================================================================
// QUERY PARAMETER SCHEMAS
// ============================================================================

export const SessionListQuerySchema = z.object({
  // Pagination
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),

  // Filters
  formation_id: z.string().uuid().optional(),
  mode: z
    .string()
    .transform((val) =>
      val ? (val.split(",") as Array<z.infer<typeof DeliveryModeSchema>>) : []
    )
    .optional(),
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
  date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // YYYY-MM-DD
  statut: z
    .string()
    .transform((val) =>
      val ? (val.split(",") as Array<z.infer<typeof SessionStatusSchema>>) : []
    )
    .optional(),
  formateur_id: z.string().uuid().optional(),

  // Calendar-specific
  mois: z.string().regex(/^\d{4}-\d{2}$/).optional(), // YYYY-MM
  annee: z.coerce.number().int().min(2000).max(2100).optional(),

  // Sorting
  sort: z.enum(["date_asc", "date_desc", "prix_asc", "prix_desc"]).optional(),
});

export const CalendarQuerySchema = z.object({
  annee: z.coerce.number().int().min(2000).max(2100),
  mois: z.coerce.number().int().min(1).max(12).optional(),
  formations: z
    .string()
    .transform((val) => (val ? val.split(",") : []))
    .optional(),
  modes: z
    .string()
    .transform((val) =>
      val ? (val.split(",") as Array<z.infer<typeof DeliveryModeSchema>>) : []
    )
    .optional(),
});

export const AdminSessionListQuerySchema = SessionListQuerySchema.extend({
  search: z.string().optional(), // Search by code_session or formation title
});

export const TrainerAvailabilityQuerySchema = z.object({
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD, required
  date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD, required
  formateur_ids: z
    .string()
    .transform((val) => (val ? val.split(",") : []))
    .optional(),
});

export const EnrollmentListQuerySchema = z.object({
  statut: z
    .string()
    .transform((val) =>
      val ? (val.split(",") as Array<z.infer<typeof EnrollmentStatusSchema>>) : []
    )
    .optional(),
  paiement: z
    .string()
    .transform((val) =>
      val ? (val.split(",") as Array<z.infer<typeof PaymentStatusSchema>>) : []
    )
    .optional(),
  search: z.string().optional(),
});

// ============================================================================
// REQUEST BODY SCHEMAS
// ============================================================================

export const CreateSessionSchema = z
  .object({
    formation_id: z.string().uuid(),
    date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
    date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
    horaires: z.string().min(1).max(100),
    mode_formation: DeliveryModeSchema,
    lieu: z.string().max(500).optional(),
    lien_visio: z.string().url().max(500).optional(),
    places_totales: z.number().int().min(1),
    prix_ht: z.number().nonnegative().optional(),
    prix_ttc: z.number().nonnegative().optional(),
    formateur_ids: z.array(z.string().uuid()).min(1),
    statut: z.enum(["planifiee", "ouverte"]).default("planifiee").optional(),
    notes_internes: z.string().optional(),
  })
  .refine(
    (data) => {
      const startDate = new Date(data.date_debut);
      const endDate = new Date(data.date_fin);
      return endDate > startDate;
    },
    {
      message: "date_fin must be after date_debut",
      path: ["date_fin"],
    }
  )
  .refine(
    (data) => {
      if (data.mode_formation === "presentiel") {
        return !!data.lieu;
      }
      return true;
    },
    {
      message: "lieu is required for presentiel mode",
      path: ["lieu"],
    }
  )
  .refine(
    (data) => {
      if (data.mode_formation === "distanciel" || data.mode_formation === "hybride") {
        return !!data.lien_visio;
      }
      return true;
    },
    {
      message: "lien_visio is required for distanciel or hybride mode",
      path: ["lien_visio"],
    }
  )
  .refine(
    (data) => {
      if (data.prix_ht !== undefined && data.prix_ttc !== undefined) {
        return data.prix_ttc >= data.prix_ht;
      }
      return true;
    },
    {
      message: "prix_ttc must be >= prix_ht",
      path: ["prix_ttc"],
    }
  );

export const UpdateSessionSchema = CreateSessionSchema.partial().extend({
  formation_id: z.string().uuid().optional(),
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  horaires: z.string().min(1).max(100).optional(),
  mode_formation: DeliveryModeSchema.optional(),
  places_totales: z.number().int().min(1).optional(),
  formateur_ids: z.array(z.string().uuid()).min(1).optional(),
});

export const UpdateSessionStatusSchema = z.object({
  statut: SessionStatusSchema,
});

export const DuplicateSessionSchema = z.object({
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
  date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD
}).refine(
  (data) => {
    const startDate = new Date(data.date_debut);
    const endDate = new Date(data.date_fin);
    return endDate > startDate;
  },
  {
    message: "date_fin must be after date_debut",
    path: ["date_fin"],
  }
);

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

export const FormationBasicSchema = z.object({
  id: z.string().uuid(),
  titre: z.string(),
  slug: z.string(),
});

export const FormateurBasicSchema = z.object({
  id: z.string().uuid(),
  nom: z.string(),
  prenom: z.string(),
});

export const FormateurDetailSchema = FormateurBasicSchema.extend({
  bio: z.string().nullable().optional(),
  photo: z.string().url().nullable().optional(),
  specialites: z.array(z.string()).optional(),
});

export const SessionListItemSchema = z.object({
  id: z.string().uuid(),
  code_session: z.string(),
  formation: FormationBasicSchema,
  date_debut: z.string(), // ISO date
  date_fin: z.string(), // ISO date
  horaires: z.string().nullable(),
  mode_formation: DeliveryModeSchema,
  lieu: z.string().nullable().optional(),
  lien_visio: z.string().url().nullable().optional(),
  places_totales: z.number().int().min(0),
  places_reservees: z.number().int().min(0),
  places_disponibles: z.number().int().min(0),
  statut: SessionStatusSchema,
  prix_ht: z.number().nullable().optional(),
  prix_ttc: z.number().nullable().optional(),
  formateurs: z.array(FormateurBasicSchema),
});

export const SessionListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    sessions: z.array(SessionListItemSchema),
    pagination: PaginationSchema,
  }),
});

export const CalendarEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  start: z.string(), // ISO datetime
  end: z.string(), // ISO datetime
  backgroundColor: z.string(),
  borderColor: z.string(),
  extendedProps: z.object({
    code_session: z.string(),
    mode: DeliveryModeSchema,
    lieu: z.string().nullable().optional(),
    formateurs: z.string(), // Comma-separated names
    places_disponibles: z.number().int(),
    statut: z.string(),
  }),
});

export const CalendarResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    events: z.array(CalendarEventSchema),
  }),
});

export const FormationDetailSchema = FormationBasicSchema.extend({
  description_courte: z.string().nullable().optional(),
  objectifs: z.array(z.string()).optional(),
  programme: z.string().nullable().optional(),
});

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
  statut: SessionStatusSchema,
  prix_ht: z.number().nullable().optional(),
  prix_ttc: z.number().nullable().optional(),
  formateurs: z.array(FormateurDetailSchema),
  inscriptions_count: z.number().int().min(0),
});

export const SessionDetailResponseSchema = z.object({
  success: z.literal(true),
  data: SessionDetailSchema,
});

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

export const AdminSessionDetailSchema = SessionDetailSchema.extend({
  notes_internes: z.string().nullable().optional(),
});

export const AdminSessionDetailResponseSchema = z.object({
  success: z.literal(true),
  data: AdminSessionDetailSchema,
});

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

export const UpdateStatusResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    id: z.string().uuid(),
    statut: SessionStatusSchema,
    updated_at: z.string(), // ISO datetime
  }),
});

// ============================================================================
// ERROR RESPONSE SCHEMAS
// ============================================================================

export const ErrorResponseSchema = z.object({
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

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type DeliveryMode = z.infer<typeof DeliveryModeSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type FormateurRole = z.infer<typeof FormateurRoleSchema>;
export type EnrollmentStatus = z.infer<typeof EnrollmentStatusSchema>;
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export type EnrollmentType = z.infer<typeof EnrollmentTypeSchema>;

export type SessionListItem = z.infer<typeof SessionListItemSchema>;
export type SessionDetail = z.infer<typeof SessionDetailSchema>;
export type AdminSessionDetail = z.infer<typeof AdminSessionDetailSchema>;
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type EnrollmentDetail = z.infer<typeof EnrollmentDetailSchema>;
export type TrainerAvailabilityItem = z.infer<typeof TrainerAvailabilityItemSchema>;

