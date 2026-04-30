import { z } from "zod";
import { PaginationSchema } from "../common";

// ============================================================================
// ENUM SCHEMAS
// ============================================================================

// Delivery mode schema (redefined here to avoid circular dependency issues)
export const DeliveryModeSchema = z.enum(["presentiel", "distanciel", "hybride"]);

// Session status for professional training sessions (different from attendance sessions)
export const SessionProStatusSchema = z.enum([
  "planifiee",
  "ouverte",
  "complete",
  "en_cours",
  "terminee",
  "annulee",
]);

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
      val ? (val.split(",") as Array<z.infer<typeof SessionProStatusSchema>>) : []
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
    lien_visio: z.preprocess(
      (val) => (val === "" || val === null || val === undefined ? undefined : val),
      z.string().url().max(500).optional()
    ),
    places_totales: z.number().int().min(1),
    prix_ht: z.number().nonnegative().optional(),
    prix_ttc: z.number().nonnegative().optional(),
    formateur_ids: z.array(z.string().uuid()).min(1, "Veuillez sélectionner au moins un formateur"),
    statut: z.enum(["planifiee", "ouverte"]).default("ouverte").optional(),
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

// UpdateSessionSchema - all fields optional, but must maintain validation if provided
export const UpdateSessionSchema = z.object({
  formation_id: z.string().uuid().optional(),
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  horaires: z.string().min(1).max(100).optional(),
  mode_formation: DeliveryModeSchema.optional(),
  lieu: z.string().max(500).optional(),
  lien_visio: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : val),
    z.string().url().max(500).optional()
  ),
  places_totales: z.number().int().min(1).optional(),
  prix_ht: z.number().nonnegative().optional(),
  prix_ttc: z.number().nonnegative().optional(),
  formateur_ids: z.array(z.string().uuid()).min(1).optional(),
  statut: z.enum(["planifiee", "ouverte"]).optional(),
  notes_internes: z.string().optional(),
}).refine(
  (data) => {
    if (data.date_debut && data.date_fin) {
      const startDate = new Date(data.date_debut);
      const endDate = new Date(data.date_fin);
      return endDate > startDate;
    }
    return true;
  },
  {
    message: "date_fin must be after date_debut",
    path: ["date_fin"],
  }
).refine(
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
).refine(
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
).refine(
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
  statut: SessionProStatusSchema,
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

