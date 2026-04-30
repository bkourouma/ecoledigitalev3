/**
 * Code Promo Zod Schemas
 * 
 * Validation schemas for promotional code validation requests and responses.
 */

import { z } from 'zod';

/**
 * Promotional code validation request schema
 */
export const PromoCodeValidationRequestSchema = z.object({
  code: z.string().min(1, 'Promotional code is required').max(50, 'Code too long'),
  formation_id: z.string().uuid('Formation ID must be a valid UUID').optional(),
  session_id: z.string().uuid('Session ID must be a valid UUID').optional(),
  montant: z.number().positive('Amount must be positive'),
});

/**
 * Promotional code validation response schema
 */
export const PromoCodeValidationResponseSchema = z.object({
  valide: z.boolean(),
  code_promo: z.object({
    id: z.string().uuid(),
    code: z.string(),
    type_reduction: z.enum(['pourcentage', 'montant_fixe']),
    valeur_reduction: z.number().nonnegative(),
    description: z.string().nullable(),
  }).nullable(),
  reduction_montant: z.number().nonnegative(),
  nouveau_montant: z.number().nonnegative(),
  message: z.string(),
});

