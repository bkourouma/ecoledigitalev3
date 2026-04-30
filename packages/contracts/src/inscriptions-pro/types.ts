/**
 * Inscription Professionnelle TypeScript Types
 * 
 * Type definitions for professional training enrollment system.
 */

import { z } from 'zod';
import {
  IndividualEnrollmentRequestSchema,
  CompanyEnrollmentRequestSchema,
  CompanySearchRequestSchema,
  CompanySearchResponseSchema,
  EnrollmentResponseSchema,
  AvailabilityCheckRequestSchema,
  AvailabilityCheckResponseSchema,
  EnrollmentCreationResponseSchema,
} from './inscription.schema';

/**
 * Individual enrollment request type
 */
export type IndividualEnrollmentRequest = z.infer<typeof IndividualEnrollmentRequestSchema>;

/**
 * Company enrollment request type
 */
export type CompanyEnrollmentRequest = z.infer<typeof CompanyEnrollmentRequestSchema>;

/**
 * Company search request type
 */
export type CompanySearchRequest = z.infer<typeof CompanySearchRequestSchema>;

/**
 * Company search response type
 */
export type CompanySearchResponse = z.infer<typeof CompanySearchResponseSchema>;

/**
 * Company info type
 */
export type CompanyInfo = {
  id: string;
  raison_sociale: string;
  siret: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  pays: string | null;
  telephone: string | null;
  email: string | null;
};

/**
 * Enrollment response type
 */
export type EnrollmentResponse = z.infer<typeof EnrollmentResponseSchema>;

/**
 * Enrollment status type
 */
export type EnrollmentStatus = 'en_attente' | 'confirmee' | 'annulee' | 'terminee';

/**
 * Enrollment type
 */
export type EnrollmentType = 'individuelle' | 'entreprise';

/**
 * Session availability check request type
 */
export type AvailabilityCheckRequest = z.infer<typeof AvailabilityCheckRequestSchema>;

/**
 * Session availability check response type
 */
export type AvailabilityCheckResponse = z.infer<typeof AvailabilityCheckResponseSchema>;

/**
 * Enrollment creation response type
 */
export type EnrollmentCreationResponse = z.infer<typeof EnrollmentCreationResponseSchema>;

/**
 * Session status type
 */
export type InscriptionProSessionStatus =
  | 'planifiee'
  | 'ouverte'
  | 'complete'
  | 'en_cours'
  | 'terminee'
  | 'annulee';

