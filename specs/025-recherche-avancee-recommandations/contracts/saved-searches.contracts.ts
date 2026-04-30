/**
 * Saved Searches API Contracts
 * Phase 5 - Recherche Avancée et Gestion des Recommandations
 */

import { z } from 'zod';
import { SearchFiltersSchema, SearchSortSchema } from './search.contracts';

// ============================================================================
// Saved Search Schemas
// ============================================================================

export const SavedSearchFrequencySchema = z.enum(['immediate', 'quotidien', 'hebdomadaire']);

export const SavedSearchCriteriaSchema = z.object({
  query: z.string().max(500).nullable().optional(),
  filters: SearchFiltersSchema.optional(),
  sort: SearchSortSchema.optional(),
});

export const SavedSearchSchema = z.object({
  id: z.number().int().positive(),
  user_id: z.number().int().positive(),
  nom: z.string().min(1).max(100),
  description: z.string().nullable(),
  criteres: SavedSearchCriteriaSchema,
  notification_active: z.boolean(),
  frequence_notification: SavedSearchFrequencySchema,
  derniere_notification: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateSavedSearchSchema = z.object({
  nom: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  criteres: SavedSearchCriteriaSchema,
  notification_active: z.boolean().default(false),
  frequence_notification: SavedSearchFrequencySchema.default('quotidien'),
});

export const UpdateSavedSearchSchema = CreateSavedSearchSchema.partial();

export const SavedSearchListSchema = z.object({
  searches: z.array(SavedSearchSchema),
  total: z.number().int().nonnegative(),
});

export type SavedSearch = z.infer<typeof SavedSearchSchema>;
export type CreateSavedSearch = z.infer<typeof CreateSavedSearchSchema>;
export type UpdateSavedSearch = z.infer<typeof UpdateSavedSearchSchema>;
export type SavedSearchList = z.infer<typeof SavedSearchListSchema>;
export type SavedSearchCriteria = z.infer<typeof SavedSearchCriteriaSchema>;

