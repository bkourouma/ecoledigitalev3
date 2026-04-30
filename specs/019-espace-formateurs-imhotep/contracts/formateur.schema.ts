/**
 * API Contracts: Trainer Space (Espace Formateurs)
 * 
 * Zod schemas for trainer space API endpoints
 * To be placed in: packages/contracts/src/formateurs/index.ts
 */

import { z } from "zod";

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
});

export const PaginationResponseSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

// ============================================================================
// DASHBOARD SCHEMAS
// ============================================================================

export const DashboardStatsSchema = z.object({
  sessions_a_venir: z.number(),
  sessions_en_cours: z.number(),
  sessions_terminees_mois: z.number(),
  total_apprenants: z.number(),
  heures_formation_mois: z.number(),
});

export const SessionListItemSchema = z.object({
  id: z.string().uuid(),
  code_session: z.string(),
  formation: z.object({
    id: z.string().uuid(),
    titre: z.string(),
    slug: z.string().optional(),
  }),
  date_debut: z.string(),
  date_fin: z.string(),
  horaires: z.string().optional(),
  mode_formation: z.enum(["presentiel", "distanciel", "hybride"]),
  lieu: z.string().optional(),
  lien_visio: z.string().optional(),
  statut: z.enum(["planifiee", "ouverte", "complete", "en_cours", "terminee", "annulee"]),
  places_totales: z.number(),
  places_reservees: z.number(),
  places_disponibles: z.number(),
  nb_inscrits: z.number().optional(),
});

export const SupportListItemSchema = z.object({
  id: z.string().uuid(),
  titre: z.string(),
  description: z.string().optional(),
  type_fichier: z.string(),
  taille_fichier: z.number(),
  fichier_url: z.string(),
  nb_telechargements: z.number(),
  created_at: z.string(),
});

export const NotificationItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  titre: z.string(),
  message: z.string(),
  metadata: z.record(z.any()).optional(),
  lue: z.boolean(),
  lue_at: z.string().optional(),
  created_at: z.string(),
});

export const DashboardResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    stats: DashboardStatsSchema,
    prochaines_sessions: z.array(SessionListItemSchema),
    sessions_recentes: z.array(SessionListItemSchema),
    supports_recents: z.array(SupportListItemSchema),
    notifications: z.object({
      nb_non_lues: z.number(),
      recentes: z.array(NotificationItemSchema),
    }),
  }),
});

// ============================================================================
// SCHEDULE SCHEMAS
// ============================================================================

export const PlanningQuerySchema = z.object({
  annee: z.coerce.number().int().min(2000).max(2100),
  mois: z.coerce.number().int().min(1).max(12).optional(),
  vue: z.enum(["mois", "semaine", "liste"]).optional().default("mois"),
});

export const IndisponibiliteItemSchema = z.object({
  id: z.string().uuid(),
  date_debut: z.string(),
  date_fin: z.string(),
  raison: z.string(),
  created_at: z.string(),
});

export const CalendarSessionEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  backgroundColor: z.string(),
  extendedProps: z.object({
    type: z.literal("session"),
    code_session: z.string(),
    formation_titre: z.string(),
    mode_formation: z.string(),
    nb_inscrits: z.number(),
    statut: z.string(),
  }),
});

export const PlanningResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    sessions: z.array(CalendarSessionEventSchema),
    indisponibilites: z.array(IndisponibiliteItemSchema),
  }),
});

export const CreateIndisponibiliteSchema = z.object({
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  raison: z.string().min(1).max(500),
});

// ============================================================================
// SESSION SCHEMAS
// ============================================================================

export const SessionListQuerySchema = PaginationQuerySchema.extend({
  statuts: z
    .string()
    .transform((val) => (val ? val.split(",") : []))
    .optional(),
  date_debut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  formation_id: z.string().uuid().optional(),
  search: z.string().optional(),
});

export const SessionDetailSchema = z.object({
  id: z.string().uuid(),
  code_session: z.string(),
  date_debut: z.string(),
  date_fin: z.string(),
  horaires: z.string().optional(),
  mode_formation: z.enum(["presentiel", "distanciel", "hybride"]),
  lieu: z.string().optional(),
  lien_visio: z.string().optional(),
  statut: z.enum(["planifiee", "ouverte", "complete", "en_cours", "terminee", "annulee"]),
  places_totales: z.number(),
  places_reservees: z.number(),
  places_disponibles: z.number(),
  notes_formateur: z.string().optional(),
  notes_updated_at: z.string().optional(),
});

export const FormationInfoSchema = z.object({
  id: z.string().uuid(),
  titre: z.string(),
  slug: z.string().optional(),
  description_courte: z.string().optional(),
});

export const InscritItemSchema = z.object({
  id: z.string().uuid(),
  inscription_id: z.string().uuid(),
  apprenant: z.object({
    id: z.string().uuid(),
    nom: z.string(),
    prenom: z.string(),
    email: z.string(),
    telephone: z.string().optional(),
  }),
  entreprise: z
    .object({
      id: z.string().uuid(),
      nom: z.string(),
    })
    .optional(),
  statut_inscription: z.string(),
  presence: z.boolean().optional(),
  presence_marked_at: z.string().optional(),
});

export const SessionDetailResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    session: SessionDetailSchema,
    formation: FormationInfoSchema,
    inscrits: z.array(InscritItemSchema),
    supports: z.array(SupportListItemSchema),
    notes_formateur: z.string().optional(),
  }),
});

export const InscritsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    inscrits: z.array(InscritItemSchema),
    stats: z.object({
      total_inscrits: z.number(),
      confirmees: z.number(),
      presents: z.number().optional(),
      absents: z.number().optional(),
    }),
  }),
});

// ============================================================================
// ATTENDANCE SCHEMAS
// ============================================================================

export const MarkPresenceSchema = z.object({
  present: z.boolean(),
});

export const AttendanceResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    inscription_id: z.string().uuid(),
    present: z.boolean(),
    marked_at: z.string(),
  }),
});

// ============================================================================
// COURSE MATERIALS SCHEMAS
// ============================================================================

export const SupportsListQuerySchema = PaginationQuerySchema.extend({
  formation_id: z.string().uuid().optional(),
  session_id: z.string().uuid().optional(),
  type_fichier: z.enum(["PDF", "PPT", "DOC", "ZIP", "Video", "Autre"]).optional(),
  search: z.string().optional(),
});

export const SupportDetailSchema = z.object({
  id: z.string().uuid(),
  titre: z.string(),
  description: z.string().optional(),
  type_fichier: z.string(),
  taille_fichier: z.number(),
  fichier_url: z.string(),
  visible_apprenants: z.boolean(),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

export const SupportWithAssociationsSchema = SupportDetailSchema.extend({
  formation: z
    .object({
      id: z.string().uuid(),
      titre: z.string(),
    })
    .optional(),
  sessions: z.array(
    z.object({
      id: z.string().uuid(),
      code_session: z.string(),
    })
  ),
});

export const UploadSupportSchema = z.object({
  titre: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  formation_id: z.string().uuid().optional(),
  session_ids: z
    .string()
    .transform((val) => (val ? val.split(",") : []))
    .optional(),
  visible_apprenants: z.boolean().default(true),
});

export const UpdateSupportSchema = z.object({
  titre: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  visible_apprenants: z.boolean().optional(),
  session_ids: z.array(z.string().uuid()).optional(),
});

export const SupportStatisticsSchema = z.object({
  nb_telechargements: z.number(),
  dernier_telechargement: z.string().optional(),
  telechargements_par_session: z.array(
    z.object({
      session_code: z.string(),
      nb_telechargements: z.number(),
    })
  ),
});

// ============================================================================
// SESSION NOTES SCHEMAS
// ============================================================================

export const SessionNotesSchema = z.object({
  notes: z.string().max(10000),
});

export const SessionNotesResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    session_id: z.string().uuid(),
    notes: z.string(),
    updated_at: z.string(),
  }),
});

// ============================================================================
// MESSAGING SCHEMAS
// ============================================================================

export const GroupMessageSchema = z.object({
  sujet: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  type: z.enum(["email", "sms", "both"]),
  destinataires: z.enum(["tous", "presents", "absents"]).default("tous"),
});

export const GroupMessageResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    nb_destinataires: z.number(),
    email_envoyes: z.number().optional(),
    sms_envoyes: z.number().optional(),
  }),
});

// ============================================================================
// PROFILE SCHEMAS
// ============================================================================

export const FormateurProfileSchema = z.object({
  id: z.string().uuid(),
  nom: z.string(),
  prenom: z.string(),
  email: z.string(),
  telephone: z.string().optional(),
  bio: z.string().optional(),
  specialites: z.array(z.string()).optional(),
  linkedin_url: z.string().url().optional(),
  photo_url: z.string().optional(),
  cv_url: z.string().optional(),
});

export const FormateurStatisticsSchema = z.object({
  nb_sessions_total: z.number(),
  nb_apprenants_formes: z.number(),
  heures_formation_total: z.number(),
  nb_supports_crees: z.number(),
});

export const ProfileResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    formateur: FormateurProfileSchema,
    formations_assignees: z.array(
      z.object({
        id: z.string().uuid(),
        titre: z.string(),
      })
    ),
    statistiques: FormateurStatisticsSchema,
  }),
});

export const UpdateProfileSchema = z.object({
  bio: z.string().max(2000).optional(),
  specialites: z.array(z.string()).optional(),
  linkedin_url: z.string().url().optional(),
  photo: z.string().optional(), // Base64 encoded image
});

// ============================================================================
// NOTIFICATION SCHEMAS
// ============================================================================

export const NotificationsQuerySchema = PaginationQuerySchema.extend({
  non_lues: z.coerce.boolean().optional(),
});

export const NotificationsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    notifications: z.array(NotificationItemSchema),
    nb_non_lues: z.number(),
    pagination: PaginationResponseSchema,
  }),
});

// ============================================================================
// ERROR SCHEMAS
// ============================================================================

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  details: z.array(z.string()).optional(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
export type SessionListItem = z.infer<typeof SessionListItemSchema>;
export type SupportListItem = z.infer<typeof SupportListItemSchema>;
export type NotificationItem = z.infer<typeof NotificationItemSchema>;
export type IndisponibiliteItem = z.infer<typeof IndisponibiliteItemSchema>;
export type SessionDetail = z.infer<typeof SessionDetailSchema>;
export type InscritItem = z.infer<typeof InscritItemSchema>;
export type SupportDetail = z.infer<typeof SupportDetailSchema>;
export type FormateurProfile = z.infer<typeof FormateurProfileSchema>;
export type FormateurStatistics = z.infer<typeof FormateurStatisticsSchema>;

