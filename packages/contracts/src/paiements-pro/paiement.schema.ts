/**
 * Paiement Professionnel Zod Schemas
 * 
 * Validation schemas for payment initiation requests and responses.
 */

import { z } from 'zod';

/**
 * Payment method enum
 */
export const PaiementProMethodSchema = z.enum([
  'orange_money',
  'mtn_money',
  'wave',
  'carte_bancaire',
  'tresorpay',
]);

/**
 * Payment status enum
 */
export const PaymentStatusSchema = z.enum([
  'en_attente',
  'valide',
  'echoue',
  'rembourse',
  'annule',
]);

/**
 * Payment initiation request schema
 */
export const PaymentInitiationRequestSchema = z.object({
  inscription_id: z.string().uuid('Inscription ID must be a valid UUID'),
  methode_paiement: PaiementProMethodSchema,
  montant: z.number().positive('Amount must be positive'),
  telephone: z.string().min(8, 'Phone number too short').max(20, 'Phone number too long').optional(),
  return_url: z.string().url('Invalid return URL').optional(),
});

/**
 * Payment initiation response schema
 */
export const PaymentInitiationResponseSchema = z.object({
  paiement_id: z.string().uuid(),
  transaction_id: z.string(),
  reference_externe: z.string().nullable(),
  ussd_code: z.string().optional(),
  instructions: z.string().optional(),
  qr_code: z.string().url().optional(),
  redirect_url: z.string().url().optional(),
  status_check_url: z.string().url().optional(),
  statut: PaymentStatusSchema,
  message: z.string(),
});

/**
 * Payment status check response schema
 */
export const PaymentStatusResponseSchema = z.object({
  paiement_id: z.string().uuid(),
  transaction_id: z.string(),
  statut: PaymentStatusSchema,
  reference_externe: z.string().nullable(),
  message: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

