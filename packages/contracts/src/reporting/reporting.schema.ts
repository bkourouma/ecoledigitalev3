/**
 * Reporting & Metrics Contracts
 * 
 * Schemas for reporting dashboard and metrics queries
 */

import { z } from "zod";

// Reporting Period
export const ReportingPeriodSchema = z.enum(["jour", "semaine", "mois", "annee"]);

export type ReportingPeriod = z.infer<typeof ReportingPeriodSchema>;

// Dashboard Metrics Query
export const DashboardMetricsQuerySchema = z.object({
  periode: ReportingPeriodSchema.default("mois"),
});

export type DashboardMetricsQuery = z.infer<typeof DashboardMetricsQuerySchema>;

// Dashboard Metrics Response
export const DashboardMetricsResponseSchema = z.object({
  inscriptions: z.object({
    total: z.number().int().min(0),
    evolution: z.string(), // Percentage change
  }),
  ca: z.object({
    total: z.number().min(0),
    evolution: z.string(), // Percentage change
  }),
  sessions: z.object({
    total: z.number().int().min(0),
    taux_remplissage: z.string(), // Average fill rate percentage
  }),
  top_formations: z.array(
    z.object({
      formation: z.string(),
      nb_inscriptions: z.number().int().min(0),
    })
  ),
  top_entreprises: z.array(
    z.object({
      entreprise: z.string(),
      nb_inscriptions: z.number().int().min(0),
      ca: z.number().min(0),
    })
  ),
});

export type DashboardMetricsResponse = z.infer<typeof DashboardMetricsResponseSchema>;

// CA Previsionnel Query
export const CAPrevisionnelQuerySchema = z.object({
  annee: z.number().int().min(2000).max(2100),
  trimestre: z.number().int().min(1).max(4).optional(),
});

export type CAPrevisionnelQuery = z.infer<typeof CAPrevisionnelQuerySchema>;

// CA Previsionnel Response
export const CAPrevisionnelResponseSchema = z.object({
  ca_realise: z.number().min(0),
  ca_previsionnel: z.number().min(0),
  ca_potentiel: z.number().min(0),
  ca_total_estime: z.number().min(0),
  par_mois: z.array(
    z.object({
      mois: z.string(),
      ca_realise: z.number().min(0),
      ca_previsionnel: z.number().min(0),
    })
  ),
  par_formation: z.array(
    z.object({
      formation: z.string(),
      ca: z.number().min(0),
    })
  ),
});

export type CAPrevisionnelResponse = z.infer<typeof CAPrevisionnelResponseSchema>;

// Statistics Query
export const StatisticsQuerySchema = z.object({
  date_debut: z.string().datetime(),
  date_fin: z.string().datetime(),
  type: z.enum(["inscriptions", "formations", "formateurs", "entreprises"]),
});

export type StatisticsQuery = z.infer<typeof StatisticsQuerySchema>;

// Statistics Response (varies by type)
export const StatisticsResponseSchema = z.union([
  // Inscriptions statistics
  z.object({
    type: z.literal("inscriptions"),
    repartition_statut: z.record(z.string(), z.number().int()),
    evolution_temporelle: z.array(
      z.object({
        periode: z.string(),
        nombre: z.number().int().min(0),
      })
    ),
  }),
  // Formations statistics
  z.object({
    type: z.literal("formations"),
    nb_sessions: z.number().int().min(0),
    taux_remplissage_moyen: z.number().min(0).max(100),
    repartition_mode: z.record(z.string(), z.number().int()),
  }),
  // Formateurs statistics
  z.object({
    type: z.literal("formateurs"),
    nb_formateurs: z.number().int().min(0),
    nb_sessions_animees: z.number().int().min(0),
    repartition_sessions: z.array(
      z.object({
        formateur: z.string(),
        nb_sessions: z.number().int().min(0),
      })
    ),
  }),
  // Entreprises statistics
  z.object({
    type: z.literal("entreprises"),
    nb_entreprises: z.number().int().min(0),
    nb_inscriptions: z.number().int().min(0),
    ca_total: z.number().min(0),
  }),
]);

export type StatisticsResponse = z.infer<typeof StatisticsResponseSchema>;

// Taux Conversion Response
export const TauxConversionResponseSchema = z.object({
  taux_global: z.string(), // Percentage
  par_formation: z.array(
    z.object({
      formation: z.string(),
      taux: z.string(), // Percentage
    })
  ),
  par_methode_paiement: z.array(
    z.object({
      methode: z.string(),
      pourcentage: z.number().min(0).max(100),
    })
  ),
  par_mois: z.array(
    z.object({
      mois: z.string(),
      taux: z.string(), // Percentage
    })
  ),
});

export type TauxConversionResponse = z.infer<typeof TauxConversionResponseSchema>;

