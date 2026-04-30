/**
 * Scheduled Reports API Contracts
 * Phase 5 - Recherche Avancée et Gestion des Recommandations
 */

import { z } from 'zod';

// ============================================================================
// Scheduled Report Schemas
// ============================================================================

export const ReportTypeSchema = z.enum(['activites', 'recommandations', 'statistiques', 'personnalise']);

export const ReportFrequencySchema = z.enum(['quotidien', 'hebdomadaire', 'mensuel', 'trimestriel']);

export const ReportFormatSchema = z.enum(['pdf', 'excel', 'csv', 'email']);

export const ScheduledReportParametersSchema = z.object({
  filters: z.object({
    annee_id: z.number().int().positive().nullable().optional(),
    installation_id: z.number().int().positive().nullable().optional(),
    type_activite: z.string().nullable().optional(),
    statut: z.string().nullable().optional(),
    date_debut: z.string().date().nullable().optional(),
    date_fin: z.string().date().nullable().optional(),
  }).optional(),
  include_details: z.boolean().default(true),
  group_by: z.string().nullable().optional(),
});

export const ScheduledReportSchema = z.object({
  id: z.number().int().positive(),
  user_id: z.number().int().positive(),
  nom: z.string().min(1).max(100),
  description: z.string().nullable(),
  type_rapport: ReportTypeSchema,
  parametres: ScheduledReportParametersSchema,
  frequence: ReportFrequencySchema,
  jour_semaine: z.number().int().min(1).max(7).nullable(),
  jour_mois: z.number().int().min(1).max(31).nullable(),
  heure: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/),
  format: ReportFormatSchema,
  email_destinataires: z.array(z.string().email()).nullable(),
  actif: z.boolean(),
  derniere_execution: z.string().datetime().nullable(),
  prochaine_execution: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CreateScheduledReportSchema = z.object({
  nom: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  type_rapport: ReportTypeSchema,
  parametres: ScheduledReportParametersSchema,
  frequence: ReportFrequencySchema,
  jour_semaine: z.number().int().min(1).max(7).nullable().optional(),
  jour_mois: z.number().int().min(1).max(31).nullable().optional(),
  heure: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/).default('08:00:00'),
  format: ReportFormatSchema,
  email_destinataires: z.array(z.string().email()).nullable().optional(),
  actif: z.boolean().default(true),
});

export const UpdateScheduledReportSchema = CreateScheduledReportSchema.partial();

export const ScheduledReportListSchema = z.object({
  reports: z.array(ScheduledReportSchema),
  total: z.number().int().nonnegative(),
});

export type ScheduledReport = z.infer<typeof ScheduledReportSchema>;
export type CreateScheduledReport = z.infer<typeof CreateScheduledReportSchema>;
export type UpdateScheduledReport = z.infer<typeof UpdateScheduledReportSchema>;
export type ScheduledReportList = z.infer<typeof ScheduledReportListSchema>;
export type ScheduledReportParameters = z.infer<typeof ScheduledReportParametersSchema>;

