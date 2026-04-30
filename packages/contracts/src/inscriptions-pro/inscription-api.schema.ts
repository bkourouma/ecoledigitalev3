/**
 * Inscription API Schemas
 * 
 * Validation schemas for enrollment history API endpoints.
 */

import { z } from 'zod';

/**
 * Enrollment history query schema
 */
export const EnrollmentHistoryQuerySchema = z.object({
  statut: z.enum(['en_attente', 'confirmee', 'annulee', 'terminee', 'toutes']).optional(),
  date_debut: z.string().datetime().optional(),
  date_fin: z.string().datetime().optional(),
  search: z.string().max(100).optional(),
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(50).default(10),
});

/**
 * Enrollment history item schema
 */
export const EnrollmentHistoryItemSchema = z.object({
  id: z.string().uuid(),
  numero_inscription: z.string(),
  session: z.object({
    code_session: z.string(),
    date_debut: z.string().datetime(),
    date_fin: z.string().datetime(),
    formation: z.object({
      titre: z.string(),
      slug: z.string().optional(),
    }),
  }),
  statut: z.enum(['en_attente', 'confirmee', 'annulee', 'terminee']),
  montant_ht: z.number().nonnegative(),
  montant_ttc: z.number().nonnegative(),
  reduction_appliquee: z.number().nonnegative(),
  code_promo_utilise: z.string().nullable(),
  date_inscription: z.string().datetime(),
  facture_numero: z.string().nullable(),
  facture_url: z.string().url().nullable(),
  paiement_statut: z.enum(['en_attente', 'valide', 'echoue', 'rembourse', 'annule']).nullable(),
  paiement_methode: z.string().nullable(),
});

/**
 * Enrollment history response schema
 */
export const EnrollmentHistoryResponseSchema = z.object({
  inscriptions: z.array(EnrollmentHistoryItemSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

