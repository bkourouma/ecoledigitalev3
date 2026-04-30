/**
 * Tags API Contracts
 * Phase 5 - Recherche Avancée et Gestion des Recommandations
 */

import { z } from 'zod';

// ============================================================================
// Tag Schemas
// ============================================================================

export const TagCategorySchema = z.enum(['theme', 'priorite', 'type_incident', 'equipement', 'zone', 'autre']);

export const TagSchema = z.object({
  id: z.number().int().positive(),
  nom: z.string().min(1).max(50),
  slug: z.string().min(1).max(50),
  description: z.string().nullable(),
  couleur: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  icone: z.string().max(50).nullable(),
  categorie: TagCategorySchema,
  nb_utilisations: z.number().int().nonnegative(),
  actif: z.boolean(),
  created_at: z.string().datetime(),
});

export const CreateTagSchema = z.object({
  nom: z.string().min(1).max(50),
  description: z.string().nullable().optional(),
  couleur: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3498db'),
  icone: z.string().max(50).nullable().optional(),
  categorie: TagCategorySchema.default('autre'),
});

export const UpdateTagSchema = CreateTagSchema.partial().extend({
  actif: z.boolean().optional(),
});

export const TagListSchema = z.object({
  tags: z.array(TagSchema),
  total: z.number().int().nonnegative(),
});

export type Tag = z.infer<typeof TagSchema>;
export type CreateTag = z.infer<typeof CreateTagSchema>;
export type UpdateTag = z.infer<typeof UpdateTagSchema>;
export type TagList = z.infer<typeof TagListSchema>;

// ============================================================================
// Activity-Tag Association Schemas
// ============================================================================

export const ActivityTagAssociationSchema = z.object({
  activite_id: z.number().int().positive(),
  tag_id: z.number().int().positive(),
});

export const ActivityTagsSchema = z.object({
  activite_id: z.number().int().positive(),
  tags: z.array(z.number().int().positive()),
});

export type ActivityTagAssociation = z.infer<typeof ActivityTagAssociationSchema>;
export type ActivityTags = z.infer<typeof ActivityTagsSchema>;

