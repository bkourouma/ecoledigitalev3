/**
 * Course Materials Schemas
 * 
 * Zod schemas for course material management
 */

import { z } from "zod";
import { PaginationQuerySchema } from "./sessions.schema";

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
  taille_fichier: z.number().int().min(0),
  fichier_url: z.string(),
  video_provider: z.enum(["local", "vimeo"]).optional().nullable(),
  video_id: z.string().optional().nullable(),
  url_thumbnail: z.string().optional().nullable(),
  visible_apprenants: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
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
  video_provider: z.enum(["local", "vimeo"]).optional(),
  vimeo_url: z.string().url().optional(),
  thumbnail_url: z.string().url().optional(),
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
  nb_telechargements: z.number().int().min(0),
  dernier_telechargement: z.string().datetime().optional(),
  telechargements_par_session: z.array(
    z.object({
      session_code: z.string(),
      nb_telechargements: z.number().int().min(0),
    })
  ),
});

// Type exports
export type SupportDetail = z.infer<typeof SupportDetailSchema>;
