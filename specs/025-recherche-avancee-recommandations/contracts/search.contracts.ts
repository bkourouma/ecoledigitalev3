/**
 * Search API Contracts
 * Phase 5 - Recherche Avancée et Gestion des Recommandations
 */

import { z } from 'zod';

// ============================================================================
// Search Query Schemas
// ============================================================================

export const SearchFiltersSchema = z.object({
  annee_id: z.number().int().positive().nullable().optional(),
  installation_id: z.number().int().positive().nullable().optional(),
  type_activite: z.string().nullable().optional(),
  sous_type: z.string().nullable().optional(),
  statut: z.string().nullable().optional(),
  tags: z.array(z.number().int().positive()).optional(),
  date_debut: z.string().date().nullable().optional(),
  date_fin: z.string().date().nullable().optional(),
  created_by: z.number().int().positive().nullable().optional(),
});

export const SearchSortSchema = z.object({
  field: z.enum(['relevance', 'date_activite', 'created_at', 'updated_at', 'titre']),
  order: z.enum(['ASC', 'DESC']).default('DESC'),
});

export const SearchQuerySchema = z.object({
  query: z.string().max(500).optional(),
  filters: SearchFiltersSchema.optional(),
  sort: SearchSortSchema.optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  include_drafts: z.boolean().default(false),
  exact_match: z.boolean().default(false),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type SearchFilters = z.infer<typeof SearchFiltersSchema>;
export type SearchSort = z.infer<typeof SearchSortSchema>;

// ============================================================================
// Search Result Schemas
// ============================================================================

export const SearchResultActivitySchema = z.object({
  id: z.number().int().positive(),
  code_activite: z.string(),
  titre: z.string(),
  type_activite: z.string(),
  sous_type: z.string().nullable(),
  installation_nom: z.string(),
  date_activite: z.string().date(),
  statut: z.string(),
  tags: z.array(z.object({
    id: z.number().int().positive(),
    nom: z.string(),
    couleur: z.string(),
    icone: z.string().nullable(),
  })),
  excerpt: z.string().nullable(),
  highlights: z.array(z.string()).optional(),
  relevance_score: z.number().optional(),
});

export const SearchResultRecommendationSchema = z.object({
  id: z.number().int().positive(),
  titre: z.string(),
  description: z.string(),
  activite_titre: z.string(),
  code_activite: z.string(),
  installation_nom: z.string(),
  statut: z.string(),
  priorite: z.string(),
  date_echeance: z.string().date().nullable(),
  excerpt: z.string().nullable(),
  highlights: z.array(z.string()).optional(),
  relevance_score: z.number().optional(),
});

export const SearchResultsSchema = z.object({
  results: z.array(z.union([SearchResultActivitySchema, SearchResultRecommendationSchema])),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
  query: z.string().optional(),
  filters: SearchFiltersSchema.optional(),
});

export type SearchResultActivity = z.infer<typeof SearchResultActivitySchema>;
export type SearchResultRecommendation = z.infer<typeof SearchResultRecommendationSchema>;
export type SearchResults = z.infer<typeof SearchResultsSchema>;

// ============================================================================
// Search Suggestions Schema
// ============================================================================

export const SearchSuggestionSchema = z.object({
  titre: z.string(),
  type: z.string(),
  date: z.string(),
  icon: z.string().nullable(),
  url: z.string(),
});

export const SearchSuggestionsSchema = z.object({
  suggestions: z.array(SearchSuggestionSchema),
});

export type SearchSuggestion = z.infer<typeof SearchSuggestionSchema>;
export type SearchSuggestions = z.infer<typeof SearchSuggestionsSchema>;

