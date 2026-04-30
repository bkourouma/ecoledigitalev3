/**
 * Inscriptions Professionnelles Contracts
 * 
 * Exports all schemas and types for professional training enrollment system.
 */

// Schemas
export {
  IndividualEnrollmentRequestSchema,
  CompanyEnrollmentRequestSchema,
  CompanySearchRequestSchema,
  CompanySearchResponseSchema,
  EnrollmentResponseSchema,
  AvailabilityCheckRequestSchema,
  AvailabilityCheckResponseSchema,
  EnrollmentCreationResponseSchema,
} from './inscription.schema';

export {
  EnrollmentHistoryQuerySchema,
  EnrollmentHistoryItemSchema,
  EnrollmentHistoryResponseSchema,
} from './inscription-api.schema';

// Types
export type {
  IndividualEnrollmentRequest,
  CompanyEnrollmentRequest,
  CompanySearchRequest,
  CompanySearchResponse,
  CompanyInfo,
  EnrollmentResponse,
  EnrollmentStatus,
  EnrollmentType,
  AvailabilityCheckRequest,
  AvailabilityCheckResponse,
  EnrollmentCreationResponse,
  InscriptionProSessionStatus,
} from './types';

