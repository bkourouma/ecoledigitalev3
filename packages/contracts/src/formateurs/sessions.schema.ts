/**
 * Session Schemas
 * 
 * Zod schemas for trainer session management
 */

import { z } from "zod";

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
});

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
  date_debut: z.string().date(),
  date_fin: z.string().date(),
  horaires: z.string().optional(),
  mode_formation: z.enum(["presentiel", "distanciel", "hybride"]),
  lieu: z.string().optional(),
  lien_visio: z.string().optional(),
  statut: z.enum(["planifiee", "ouverte", "complete", "en_cours", "terminee", "annulee"]),
  places_totales: z.number().int().min(0),
  places_reservees: z.number().int().min(0),
  places_disponibles: z.number().int().min(0),
  notes_formateur: z.string().optional(),
  notes_updated_at: z.string().datetime().optional(),
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
    email: z.string().email(),
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
  presence_marked_at: z.string().datetime().optional(),
});

export const SessionDetailResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    session: SessionDetailSchema,
    formation: FormationInfoSchema,
    inscrits: z.array(InscritItemSchema),
    supports: z.array(z.object({
      id: z.string().uuid(),
      titre: z.string(),
      type_fichier: z.string(),
      fichier_url: z.string(),
    })),
    notes_formateur: z.string().optional(),
  }),
});

export const InscritsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    inscrits: z.array(InscritItemSchema),
    stats: z.object({
      total_inscrits: z.number().int().min(0),
      confirmees: z.number().int().min(0),
      presents: z.number().int().min(0).optional(),
      absents: z.number().int().min(0).optional(),
    }),
  }),
});

export const UpdateSessionNotesSchema = z.object({
  notes: z.string().max(10000, "Notes cannot exceed 10000 characters"),
});

export const SessionNotesResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    session_id: z.string().uuid(),
    notes: z.string(),
    updated_at: z.string().datetime(),
  }),
});

// Type exports
export type SessionDetail = z.infer<typeof SessionDetailSchema>;
export type InscritItem = z.infer<typeof InscritItemSchema>;

