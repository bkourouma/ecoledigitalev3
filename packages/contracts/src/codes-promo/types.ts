/**
 * Code Promo TypeScript Types
 * 
 * Type definitions for promotional code validation system.
 */

import { z } from 'zod';
import {
  PromoCodeValidationRequestSchema,
  PromoCodeValidationResponseSchema,
} from './code-promo.schema';

/**
 * Promotional code validation request type
 */
export type PromoCodeValidationRequest = z.infer<typeof PromoCodeValidationRequestSchema>;

/**
 * Promotional code validation response type
 */
export type PromoCodeValidationResponse = z.infer<typeof PromoCodeValidationResponseSchema>;

/**
 * Promotional code reduction type
 */
export type PromoCodeType = 'pourcentage' | 'montant_fixe';

/**
 * Promotional code details type
 */
export type PromoCodeDetails = {
  id: string;
  code: string;
  type_reduction: PromoCodeType;
  valeur_reduction: number;
  description: string | null;
};

