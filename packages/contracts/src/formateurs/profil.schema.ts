/**
 * Profile Schemas
 * 
 * Zod schemas for trainer profile management
 */

import { z } from "zod";

export const FormateurProfileSchema = z.object({
  id: z.string().uuid(),
  nom: z.string(),
  prenom: z.string(),
  email: z.string().email(),
  telephone: z.string().optional(),
  bio: z.string().optional(),
  specialites: z.array(z.string()).optional(),
  linkedin_url: z.string().url().optional(),
  photo_url: z.string().optional(),
  cv_url: z.string().optional(),
});

export const FormateurStatisticsSchema = z.object({
  nb_sessions_total: z.number().int().min(0),
  nb_apprenants_formes: z.number().int().min(0),
  heures_formation_total: z.number().int().min(0),
  nb_supports_crees: z.number().int().min(0),
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
  photo: z.string().optional(), // Base64 encoded image or file URL
});

// Type exports
export type FormateurProfile = z.infer<typeof FormateurProfileSchema>;
export type FormateurStatistics = z.infer<typeof FormateurStatisticsSchema>;

