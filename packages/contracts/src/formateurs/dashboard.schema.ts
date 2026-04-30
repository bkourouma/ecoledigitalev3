/**
 * Dashboard Schemas
 * 
 * Zod schemas for trainer dashboard API endpoints
 */

import { z } from "zod";
import { NotificationItemSchema } from "./notifications.schema";

export const DashboardStatsSchema = z.object({
  sessions_a_venir: z.number().int().min(0),
  sessions_en_cours: z.number().int().min(0),
  sessions_terminees_mois: z.number().int().min(0),
  total_apprenants: z.number().int().min(0),
  heures_formation_mois: z.number().int().min(0),
});

export const SessionListItemSchema = z.object({
  id: z.string().uuid(),
  code_session: z.string(),
  formation: z.object({
    id: z.string().uuid(),
    titre: z.string(),
    slug: z.string().optional(),
  }),
  date_debut: z.string().datetime(),
  date_fin: z.string().datetime(),
  horaires: z.string().optional(),
  mode_formation: z.enum(["presentiel", "distanciel", "hybride"]),
  lieu: z.string().optional(),
  lien_visio: z.string().optional(),
  statut: z.enum(["planifiee", "ouverte", "complete", "en_cours", "terminee", "annulee"]),
  places_totales: z.number().int().min(0),
  places_reservees: z.number().int().min(0),
  places_disponibles: z.number().int().min(0),
  nb_inscrits: z.number().int().min(0).optional(),
});

export const SupportListItemSchema = z.object({
  id: z.string().uuid(),
  titre: z.string(),
  description: z.string().optional(),
  type_fichier: z.string(),
  taille_fichier: z.number().int().min(0),
  fichier_url: z.string(),
  nb_telechargements: z.number().int().min(0),
  created_at: z.string().datetime(),
});

export const DashboardResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    stats: DashboardStatsSchema,
    prochaines_sessions: z.array(SessionListItemSchema),
    sessions_recentes: z.array(SessionListItemSchema),
    supports_recents: z.array(SupportListItemSchema),
    notifications: z.object({
      nb_non_lues: z.number().int().min(0),
      recentes: z.array(NotificationItemSchema),
    }),
  }),
});

// Type exports
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
export type SessionListItem = z.infer<typeof SessionListItemSchema>;
export type SupportListItem = z.infer<typeof SupportListItemSchema>;

