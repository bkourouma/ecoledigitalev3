/**
 * Inscription Professionnelle Zod Schemas
 * 
 * Validation schemas for professional training enrollment requests and responses.
 */

import { z } from 'zod';

const oneOfSessionOrFormation = (data: { session_id?: string; formation_pro_id?: string }) =>
  Boolean(data.session_id) !== Boolean(data.formation_pro_id);

/**
 * Individual enrollment request schema
 */
export const IndividualEnrollmentRequestSchema = z
  .object({
  session_id: z.string().uuid('Session ID must be a valid UUID').optional(),
  formation_pro_id: z.string().uuid('Formation ID must be a valid UUID').optional(),
  type_inscription: z.literal('individuelle'),
  apprenant: z.object({
    civilite: z.enum(['M.', 'Mme', 'Autre']).optional(),
    nom: z.string().min(1, 'Last name is required').max(100, 'Last name too long'),
    prenom: z.string().min(1, 'First name is required').max(100, 'First name too long'),
    email: z.string().email('Invalid email format'),
    telephone: z.string().min(8, 'Phone number too short').max(20, 'Phone number too long'),
    poste: z.string().max(100, 'Job title too long').optional(),
  }),
  apprenant_id: z.string().uuid('Apprenant ID must be a valid UUID').optional(),
  code_promo: z.string().max(50, 'Promotional code too long').optional(),
  cgv_accepte: z.boolean().refine((val) => val === true, {
    message: 'Terms and conditions must be accepted',
  }),
})
  .refine(oneOfSessionOrFormation, {
    message: 'Fournir soit session_id (ASPCI / sessions), soit formation_pro_id (catalogue par formation)',
    path: ['session_id'],
  });

/**
 * Enrollment response schema
 */
export const EnrollmentResponseSchema = z.object({
  id: z.string().uuid(),
  numero_inscription: z.string(),
  session_id: z.string().uuid().optional(),
  formation_pro_id: z.string().uuid().optional(),
  apprenant_id: z.string().uuid(),
  entreprise_id: z.string().uuid().nullable(),
  type_inscription: z.enum(['individuelle', 'entreprise']),
  statut: z.enum(['en_attente', 'confirmee', 'annulee', 'terminee']),
  montant_ht: z.number().nonnegative(),
  montant_ttc: z.number().nonnegative(),
  code_promo_utilise: z.string().nullable(),
  reduction_appliquee: z.number().nonnegative(),
  date_inscription: z.string().datetime(),
  facture_numero: z.string().nullable(),
  facture_url: z.string().url().nullable(),
});

/**
 * Session availability check request schema
 */
export const AvailabilityCheckRequestSchema = z
  .object({
  session_id: z.string().uuid('Session ID must be a valid UUID').optional(),
  formation_pro_id: z.string().uuid('Formation ID must be a valid UUID').optional(),
})
  .refine(oneOfSessionOrFormation, {
    message: 'Fournir soit session_id, soit formation_pro_id',
    path: ['session_id'],
  });

/**
 * Session availability response schema
 */
export const AvailabilityCheckResponseSchema = z.object({
  disponible: z.boolean(),
  places_restantes: z.number().int().nonnegative(),
  message: z.string(),
  session: z
    .object({
    id: z.string().uuid(),
    code_session: z.string(),
    date_debut: z.string().datetime(),
    date_fin: z.string().datetime(),
    places_totales: z.number().int().positive(),
    places_reservees: z.number().int().nonnegative(),
    places_disponibles: z.number().int().nonnegative(),
    statut: z.enum(['planifiee', 'ouverte', 'complete', 'en_cours', 'terminee', 'annulee']),
  })
    .optional(),
  formation: z
    .object({
      id: z.string().uuid(),
      titre: z.string(),
      slug: z.string(),
      prix_ttc: z.number().nonnegative(),
      actif: z.boolean(),
    })
    .optional(),
});

/**
 * Company enrollment request schema
 */
export const CompanyEnrollmentRequestSchema = z
  .object({
  session_id: z.string().uuid('Session ID must be a valid UUID').optional(),
  formation_pro_id: z.string().uuid('Formation ID must be a valid UUID').optional(),
  type_inscription: z.literal('entreprise'),
  entreprise: z.object({
    raison_sociale: z.string().min(1, 'Company name is required').max(200, 'Company name too long'),
    siret: z.string().regex(/^\d{14}$/, 'SIRET must be 14 digits').optional(),
    adresse: z.string().max(500, 'Address too long').optional(),
    code_postal: z.string().max(10, 'Postal code too long').optional(),
    ville: z.string().max(100, 'City too long').optional(),
    pays: z.string().max(100, 'Country too long').optional(),
    telephone: z.string().min(8, 'Phone number too short').max(20, 'Phone number too long').optional(),
    email: z.string().email('Invalid email format').optional(),
  }),
  entreprise_id: z.string().uuid('Entreprise ID must be a valid UUID').optional(),
  apprenant: z.object({
    civilite: z.enum(['M.', 'Mme', 'Autre']).optional(),
    nom: z.string().min(1, 'Last name is required').max(100, 'Last name too long'),
    prenom: z.string().min(1, 'First name is required').max(100, 'First name too long'),
    email: z.string().email('Invalid email format'),
    telephone: z.string().min(8, 'Phone number too short').max(20, 'Phone number too long'),
    poste: z.string().max(100, 'Job title too long').optional(),
  }),
  apprenant_id: z.string().uuid('Apprenant ID must be a valid UUID').optional(),
  code_promo: z.string().max(50, 'Promotional code too long').optional(),
  cgv_accepte: z.boolean().refine((val) => val === true, {
    message: 'Terms and conditions must be accepted',
  }),
})
  .refine(oneOfSessionOrFormation, {
    message: 'Fournir soit session_id, soit formation_pro_id',
    path: ['session_id'],
  });

/**
 * Company search request schema
 */
export const CompanySearchRequestSchema = z.object({
  query: z.string().min(1, 'Search query is required').max(200, 'Search query too long'),
});

/**
 * Company search response schema
 */
export const CompanySearchResponseSchema = z.object({
  entreprises: z.array(
    z.object({
      id: z.string().uuid(),
      raison_sociale: z.string(),
      siret: z.string().nullable(),
      adresse: z.string().nullable(),
      code_postal: z.string().nullable(),
      ville: z.string().nullable(),
      pays: z.string().nullable(),
      telephone: z.string().nullable(),
      email: z.string().nullable(),
    })
  ),
});

/**
 * Enrollment creation response schema
 */
export const EnrollmentCreationResponseSchema = z.object({
  inscription: EnrollmentResponseSchema,
  montant_final: z.number().nonnegative(),
  reduction_appliquee: z.number().nonnegative(),
  next_step: z.literal('paiement'),
  reservation_expires_at: z.string().datetime(),
});

