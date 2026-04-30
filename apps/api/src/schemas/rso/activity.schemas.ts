/**
 * RSO Activity Request Schemas
 * Zod schemas for activity management request validation
 */

import { z } from 'zod';

export const createActivitySchema = z.object({
  installationId: z.number().int().positive("L'ID d'installation est requis"),
  type: z.string().min(1, "Le type d'activité est requis").max(50, "Le type ne peut pas dépasser 50 caractères"),
  titre: z.string().min(1, "Le titre est requis").max(255, "Le titre ne peut pas dépasser 255 caractères"),
  description: z.string().optional(),
  dateActivite: z.string().datetime("Format de date invalide").or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format de date attendu: YYYY-MM-DD")),
  statut: z.enum(['planifie', 'en_cours', 'termine', 'annule']).optional().default('planifie'),
});

export const updateActivitySchema = z.object({
  installationId: z.number().int().positive().optional(),
  type: z.string().min(1).max(50).optional(),
  titre: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  dateActivite: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  statut: z.enum(['planifie', 'en_cours', 'termine', 'annule']).optional(),
});

export const listActivitiesQuerySchema = z.object({
  installationId: z.coerce.number().int().positive().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  type: z.string().max(50).optional(),
  statut: z.enum(['planifie', 'en_cours', 'termine', 'annule']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

