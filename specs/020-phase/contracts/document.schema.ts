/**
 * Document Generation & Management Contracts
 * 
 * Schemas for document generation requests, responses, and management operations
 */

import { z } from "zod";

// Document Types
export const DocumentTypeSchema = z.enum([
  "convention",
  "attestation_presence",
  "attestation_reussite",
  "devis",
  "facture",
  "facture_groupee",
]);

export type DocumentType = z.infer<typeof DocumentTypeSchema>;

// Generate Convention Request
export const GenerateConventionRequestSchema = z.object({
  inscription_id: z.string().uuid(),
});

export type GenerateConventionRequest = z.infer<typeof GenerateConventionRequestSchema>;

// Generate Attestation Presence Request
export const GenerateAttestationPresenceRequestSchema = z.object({
  inscription_id: z.string().uuid(),
});

export type GenerateAttestationPresenceRequest = z.infer<typeof GenerateAttestationPresenceRequestSchema>;

// Generate Attestation Reussite Request
export const GenerateAttestationReussiteRequestSchema = z.object({
  inscription_id: z.string().uuid(),
  note: z.number().min(0).max(20).optional(),
});

export type GenerateAttestationReussiteRequest = z.infer<typeof GenerateAttestationReussiteRequestSchema>;

// Generate Devis Request
export const GenerateDevisRequestSchema = z.object({
  session_id: z.string().uuid(),
  client: z.object({
    nom: z.string().min(1),
    prenom: z.string().min(1),
    email: z.string().email(),
    telephone: z.string().optional(),
    entreprise: z.string().optional(),
  }),
  validite_jours: z.number().int().min(1).max(365).default(30),
});

export type GenerateDevisRequest = z.infer<typeof GenerateDevisRequestSchema>;

// Batch Generate Request
export const BatchGenerateRequestSchema = z.object({
  type: z.enum(["attestation_presence", "attestation_reussite"]),
  session_id: z.string().uuid(),
});

export type BatchGenerateRequest = z.infer<typeof BatchGenerateRequestSchema>;

// Document Response
export const DocumentResponseSchema = z.object({
  document_url: z.string().url(),
  document_id: z.string().uuid(),
  numero: z.string(),
  deja_genere: z.boolean().optional(),
});

export type DocumentResponse = z.infer<typeof DocumentResponseSchema>;

// Batch Generate Response
export const BatchGenerateResponseSchema = z.object({
  nb_generes: z.number().int().min(0),
  documents: z.array(
    z.object({
      inscription_id: z.string().uuid(),
      apprenant: z.string(),
      document_url: z.string().url(),
      document_id: z.string().uuid(),
      numero: z.string(),
    })
  ),
});

export type BatchGenerateResponse = z.infer<typeof BatchGenerateResponseSchema>;

// Document List Query
export const DocumentListQuerySchema = z.object({
  type: DocumentTypeSchema.optional(),
  session_id: z.string().uuid().optional(),
  inscription_id: z.string().uuid().optional(),
  date_debut: z.string().datetime().optional(),
  date_fin: z.string().datetime().optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export type DocumentListQuery = z.infer<typeof DocumentListQuerySchema>;

// Document List Response
export const DocumentListItemSchema = z.object({
  id: z.string().uuid(),
  type: DocumentTypeSchema,
  numero: z.string(),
  date_generation: z.string().datetime(),
  inscription_id: z.string().uuid().nullable(),
  session_id: z.string().uuid().nullable(),
  entreprise_id: z.string().uuid().nullable(),
  apprenant_nom: z.string().nullable(),
  session_code: z.string().nullable(),
  fichier_url: z.string().url(),
});

export const DocumentListResponseSchema = z.object({
  documents: z.array(DocumentListItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});

export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;

// Resend Document Request
export const ResendDocumentRequestSchema = z.object({
  email: z.string().email(),
});

export type ResendDocumentRequest = z.infer<typeof ResendDocumentRequestSchema>;

