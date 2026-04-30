/**
 * Data Export Contracts
 * 
 * Schemas for export configuration and job management
 */

import { z } from "zod";

// Export Type
export const ExportTypeSchema = z.enum([
  "inscriptions",
  "paiements",
  "presences",
  "ca_formation",
  "personnalise",
]);

export type ExportType = z.infer<typeof ExportTypeSchema>;

// Export Format
export const ExportFormatSchema = z.enum(["xlsx", "csv"]);

export type ExportFormat = z.infer<typeof ExportFormatSchema>;

// Export Inscriptions Request
export const ExportInscriptionsRequestSchema = z.object({
  filters: z.object({
    date_debut: z.string().datetime().optional(),
    date_fin: z.string().datetime().optional(),
    statut: z.string().optional(),
    formation_id: z.string().uuid().optional(),
    session_id: z.string().uuid().optional(),
  }),
  format: ExportFormatSchema,
  colonnes: z.array(z.string()).min(1),
});

export type ExportInscriptionsRequest = z.infer<typeof ExportInscriptionsRequestSchema>;

// Export Paiements Request
export const ExportPaiementsRequestSchema = z.object({
  filters: z.object({
    date_debut: z.string().datetime().optional(),
    date_fin: z.string().datetime().optional(),
    methode: z.string().optional(),
    statut: z.string().optional(),
  }),
  format: ExportFormatSchema,
  grouper_par: z.enum(["methode", "jour", "formation"]).optional(),
});

export type ExportPaiementsRequest = z.infer<typeof ExportPaiementsRequestSchema>;

// Export Presences Request
export const ExportPresencesRequestSchema = z.object({
  session_id: z.string().uuid(),
});

export type ExportPresencesRequest = z.infer<typeof ExportPresencesRequestSchema>;

// Export CA Formation Request
export const ExportCAFormationRequestSchema = z.object({
  annee: z.number().int().min(2000).max(2100),
  format: ExportFormatSchema,
});

export type ExportCAFormationRequest = z.infer<typeof ExportCAFormationRequestSchema>;

// Export Personnalise Request
export const ExportPersonnaliseRequestSchema = z.object({
  tables: z.array(z.string()).min(1),
  colonnes: z.array(z.string()).min(1),
  filtres: z.array(
    z.object({
      table: z.string(),
      colonne: z.string(),
      operateur: z.string(),
      valeur: z.union([z.string(), z.number(), z.boolean()]),
    })
  ).optional(),
  groupements: z.array(z.string()).optional(),
  format: ExportFormatSchema,
});

export type ExportPersonnaliseRequest = z.infer<typeof ExportPersonnaliseRequestSchema>;

// Export Job Status
export const ExportJobStatusSchema = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export type ExportJobStatus = z.infer<typeof ExportJobStatusSchema>;

// Export Job Response
export const ExportJobResponseSchema = z.object({
  job_id: z.string().uuid(),
  status: ExportJobStatusSchema,
  progress: z.number().int().min(0).max(100),
  fichier_url: z.string().url().nullable(),
  error_message: z.string().nullable(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
});

export type ExportJobResponse = z.infer<typeof ExportJobResponseSchema>;

