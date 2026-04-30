/**
 * Paiement Professionnel TypeScript Types
 * 
 * Type definitions for payment processing system.
 */

import { z } from 'zod';
import {
  PaymentInitiationRequestSchema,
  PaymentInitiationResponseSchema,
  PaymentStatusResponseSchema,
  PaiementProMethodSchema,
  PaymentStatusSchema,
} from './paiement.schema';

/**
 * Payment method type (pro checkout — distinct from parent `PaymentMethod` object type)
 */
export type PaiementProMethod = z.infer<typeof PaiementProMethodSchema>;

/**
 * Payment status type
 */
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

/**
 * Payment initiation request type
 */
export type PaymentInitiationRequest = z.infer<typeof PaymentInitiationRequestSchema>;

/**
 * Payment initiation response type
 */
export type PaymentInitiationResponse = z.infer<typeof PaymentInitiationResponseSchema>;

/**
 * Payment status response type
 */
export type PaymentStatusResponse = z.infer<typeof PaymentStatusResponseSchema>;

