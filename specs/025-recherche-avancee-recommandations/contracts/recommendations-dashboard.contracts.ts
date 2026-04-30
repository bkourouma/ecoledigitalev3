/**
 * Recommendations Dashboard API Contracts
 * Phase 5 - Recherche Avancée et Gestion des Recommandations
 */

import { z } from 'zod';

// ============================================================================
// Dashboard Statistics Schemas
// ============================================================================

export const DashboardStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  en_attente: z.number().int().nonnegative(),
  en_cours: z.number().int().nonnegative(),
  en_retard: z.number().int().nonnegative(),
  terminees: z.number().int().nonnegative(),
  validees: z.number().int().nonnegative(),
});

export const PriorityBreakdownSchema = z.object({
  critique: z.number().int().nonnegative(),
  haute: z.number().int().nonnegative(),
  moyenne: z.number().int().nonnegative(),
  basse: z.number().int().nonnegative(),
});

export const MonthlyEvolutionSchema = z.object({
  mois: z.string(),
  creees: z.number().int().nonnegative(),
  terminees: z.number().int().nonnegative(),
  en_cours: z.number().int().nonnegative(),
});

export const InstallationSummarySchema = z.object({
  installation_id: z.number().int().positive(),
  installation_nom: z.string(),
  total: z.number().int().nonnegative(),
  en_cours: z.number().int().nonnegative(),
  terminees: z.number().int().nonnegative(),
});

export const DashboardDataSchema = z.object({
  stats: DashboardStatsSchema,
  priority_breakdown: PriorityBreakdownSchema,
  monthly_evolution: z.array(MonthlyEvolutionSchema),
  by_installation: z.array(InstallationSummarySchema),
  period: z.object({
    date_debut: z.string().date().nullable(),
    date_fin: z.string().date().nullable(),
    installation_id: z.number().int().positive().nullable(),
  }),
});

export const OverdueRecommendationSchema = z.object({
  id: z.number().int().positive(),
  titre: z.string(),
  activite_titre: z.string(),
  installation_nom: z.string(),
  date_echeance: z.string().date(),
  jours_retard: z.number().int(),
  priorite: z.string(),
  responsable_nom: z.string().nullable(),
  impact: z.string().nullable(),
  cout_estime: z.number().nullable(),
});

export const UpcomingDeadlineSchema = z.object({
  id: z.number().int().positive(),
  titre: z.string(),
  date_echeance: z.string().date(),
  jours_restants: z.number().int(),
  priorite: z.string(),
});

export const DashboardRecommendationsSchema = z.object({
  en_retard: z.array(OverdueRecommendationSchema),
  echeance_proche: z.array(UpcomingDeadlineSchema),
});

export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
export type PriorityBreakdown = z.infer<typeof PriorityBreakdownSchema>;
export type MonthlyEvolution = z.infer<typeof MonthlyEvolutionSchema>;
export type InstallationSummary = z.infer<typeof InstallationSummarySchema>;
export type DashboardData = z.infer<typeof DashboardDataSchema>;
export type OverdueRecommendation = z.infer<typeof OverdueRecommendationSchema>;
export type UpcomingDeadline = z.infer<typeof UpcomingDeadlineSchema>;
export type DashboardRecommendations = z.infer<typeof DashboardRecommendationsSchema>;

