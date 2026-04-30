import { z } from "zod";
import { PaginationSchema } from "./common";

// Enum schemas
export const NiveauSchema = z.enum(["Débutant", "Intermédiaire", "Avancé"]);
export const FormationProDeliveryModeSchema = z.enum(["presentiel", "distanciel", "hybride"]);
export const SortOptionSchema = z.enum([
  "pertinence",
  "prix_asc",
  "prix_desc",
  "titre_asc",
  "date_asc",
]);

// Session status enum (for filtering)
export const FormationProSessionStatusSchema = z.enum([
  "planifiee",
  "ouverte",
  "complete",
  "en_cours",
  "terminee",
  "annulee",
]);

// Query parameter schemas
export const FormationListQuerySchema = z.object({
  // Pagination
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),

  // Search
  search: z.string().optional(),

  // Filters
  themes: z
    .string()
    .transform((val) => (val ? val.split(",") : []))
    .optional(),
  duree_min: z.coerce.number().int().min(0).optional(),
  duree_max: z.coerce.number().int().min(0).optional(),
  prix_min: z.coerce.number().nonnegative().optional(),
  prix_max: z.coerce.number().nonnegative().optional(),
  niveau: NiveauSchema.optional(),
  mode: z
    .string()
    .transform((val) =>
      val ? (val.split(",") as Array<z.infer<typeof FormationProDeliveryModeSchema>>) : []
    )
    .optional(),
  certification: z.coerce.boolean().optional(),

  // Sorting
  sort: SortOptionSchema.default("pertinence").optional(),
});

// Response schemas
export const ProchaineSessionSchema = z.object({
  date_debut: z.string(), // ISO date
  mode_formation: FormationProDeliveryModeSchema,
});

/** Résumé support catalogue sur chaque carte liste (tenant sans sessions). */
export const FormationListCatalogueSupportSchema = z.object({
  titre: z.string(),
  type_fichier: z.string(),
  video_provider: z.enum(["local", "vimeo"]).nullable().optional(),
});

export const FormationListItemSchema = z.object({
  id: z.string().uuid(),
  titre: z.string(),
  slug: z.string(),
  description_courte: z.string().nullable(),
  duree_jours: z.number().int().nullable(),
  duree_heures: z.number().int().nullable(),
  prix_ttc: z.number().nonnegative(),
  niveau: NiveauSchema.nullable(),
  type_certification: z.string().nullable(),
  themes: z.array(z.string()),
  prochaine_session: ProchaineSessionSchema.nullable(),
  catalogue_support: FormationListCatalogueSupportSchema.nullable().optional(),
});

export const FormationListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    formations: z.array(FormationListItemSchema),
    pagination: PaginationSchema,
  }),
});

// Detail page schemas
export const ProgrammeModuleSchema = z.object({
  titre: z.string(),
  duree: z.string().optional(),
  contenu: z.array(z.string()),
});

export const ProgrammeDetailleSchema = z.object({
  modules: z.array(ProgrammeModuleSchema),
});

export const SessionListItemSchema = z.object({
  id: z.string().uuid(),
  code_session: z.string(),
  date_debut: z.string(), // ISO date
  date_fin: z.string(), // ISO date
  horaires: z.string().nullable(),
  mode_formation: FormationProDeliveryModeSchema,
  lieu: z.string().nullable(),
  places_disponibles: z.number().int().nonnegative(),
  prix_ttc: z.number().nonnegative(),
});

/** Support unique catalogue (tenant sans sessions) — renvoyé avec le détail formation. */
export const CatalogueSupportDetailSchema = z.object({
  id: z.string().uuid(),
  titre: z.string(),
  description: z.string().nullable().optional(),
  type_fichier: z.string(),
  fichier_url: z.string(),
  video_provider: z.enum(["local", "vimeo"]).nullable().optional(),
  video_id: z.string().nullable().optional(),
});

export type CatalogueSupportDetail = z.infer<typeof CatalogueSupportDetailSchema>;

export const FormationDetailSchema = z.object({
  id: z.string().uuid(),
  titre: z.string(),
  slug: z.string(),
  description_courte: z.string().nullable(),
  objectifs: z.array(z.string()),
  programme_detaille: ProgrammeDetailleSchema.nullable(),
  prerequis: z.string().nullable(),
  public_cible: z.string().nullable(),
  duree_jours: z.number().int().nullable(),
  duree_heures: z.number().int().nullable(),
  prix_ht: z.number().nonnegative().nullable(),
  prix_ttc: z.number().nonnegative(),
  type_certification: z.string().nullable(),
  nom_certification: z.string().nullable(),
  themes: z.array(z.string()),
  niveau: NiveauSchema.nullable(),
  carriere: z.string().nullable().optional(),
  sessions: z.array(SessionListItemSchema),
  catalogue_support: CatalogueSupportDetailSchema.nullable().optional(),
});

export const FormationDetailResponseSchema = z.object({
  success: z.literal(true),
  data: FormationDetailSchema,
});

// Sessions endpoint schemas
export const SessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});

export const SessionsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    sessions: z.array(SessionListItemSchema),
    total: z.number().int().nonnegative(),
  }),
});

// Similar trainings schemas
export const SimilarFormationsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    formations: z.array(FormationListItemSchema),
  }),
});

// Themes endpoint schemas
export const ThemeItemSchema = z.object({
  value: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
});

export const ThemesResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    themes: z.array(ThemeItemSchema),
  }),
});

// Stats endpoint schemas
export const FormationStatsSchema = z.object({
  prix: z.object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
  }),
  duree: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
  }),
  total_formations: z.number().int().nonnegative(),
  total_sessions: z.number().int().nonnegative(),
});

export const StatsResponseSchema = z.object({
  success: z.literal(true),
  data: FormationStatsSchema,
});

// Error response schema
export const FormationErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

// Type exports
export type FormationListQuery = z.infer<typeof FormationListQuerySchema>;
export type FormationListItem = z.infer<typeof FormationListItemSchema>;
export type FormationListResponse = z.infer<typeof FormationListResponseSchema>;
export type FormationDetail = z.infer<typeof FormationDetailSchema>;
export type FormationDetailResponse = z.infer<typeof FormationDetailResponseSchema>;
export type SessionListItem = z.infer<typeof SessionListItemSchema>;
export type SessionsResponse = z.infer<typeof SessionsResponseSchema>;
export type SimilarFormationsResponse = z.infer<typeof SimilarFormationsResponseSchema>;
export type ThemeItem = z.infer<typeof ThemeItemSchema>;
export type ThemesResponse = z.infer<typeof ThemesResponseSchema>;
export type FormationStats = z.infer<typeof FormationStatsSchema>;
export type StatsResponse = z.infer<typeof StatsResponseSchema>;
export type FormationErrorResponse = z.infer<typeof FormationErrorResponseSchema>;
export type Niveau = z.infer<typeof NiveauSchema>;
export type FormationProDeliveryMode = z.infer<typeof FormationProDeliveryModeSchema>;
export type FormationProSessionStatus = z.infer<typeof FormationProSessionStatusSchema>;
export type SortOption = z.infer<typeof SortOptionSchema>;

