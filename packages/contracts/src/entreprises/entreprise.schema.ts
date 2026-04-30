/**
 * Enterprise Client Management Contracts
 * 
 * Schemas for enterprise CRUD operations and grouped invoicing
 */

import { z } from "zod";

// Create Enterprise Request
export const CreateEntrepriseRequestSchema = z.object({
  raison_sociale: z.string().min(1).max(255),
  siret: z.string().length(14).regex(/^\d{14}$/),
  forme_juridique: z.string().min(1).max(100),
  adresse: z.string().min(1).max(500),
  code_postal: z.string().min(1).max(20),
  ville: z.string().min(1).max(100),
  pays: z.string().min(1).max(100).default("Côte d'Ivoire"),
  contact_nom: z.string().min(1).max(100),
  contact_prenom: z.string().min(1).max(100),
  contact_email: z.string().email(),
  contact_telephone: z.string().max(20).optional(),
  secteur_activite: z.string().max(100).optional(),
  nombre_employes: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export type CreateEntrepriseRequest = z.infer<typeof CreateEntrepriseRequestSchema>;

// Update Enterprise Request
export const UpdateEntrepriseRequestSchema = CreateEntrepriseRequestSchema.partial().extend({
  actif: z.boolean().optional(),
});

export type UpdateEntrepriseRequest = z.infer<typeof UpdateEntrepriseRequestSchema>;

// Enterprise List Query
export const EntrepriseListQuerySchema = z.object({
  search: z.string().optional(),
  secteur: z.string().optional(),
  actif: z.boolean().optional(),
  sort: z.enum(["nb_inscriptions", "ca_total", "raison_sociale"]).default("ca_total"),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(12),
});

export type EntrepriseListQuery = z.infer<typeof EntrepriseListQuerySchema>;

// Enterprise Response
export const EntrepriseResponseSchema = z.object({
  id: z.string().uuid(),
  raison_sociale: z.string(),
  siret: z.string(),
  forme_juridique: z.string(),
  adresse: z.string(),
  code_postal: z.string(),
  ville: z.string(),
  pays: z.string(),
  contact_nom: z.string(),
  contact_prenom: z.string(),
  contact_email: z.string(),
  contact_telephone: z.string().nullable(),
  secteur_activite: z.string().nullable(),
  nombre_employes: z.number().int().nullable(),
  actif: z.boolean(),
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

// Enterprise with Statistics
export const EntrepriseWithStatsSchema = EntrepriseResponseSchema.extend({
  nb_inscriptions: z.number().int().min(0),
  nb_apprenants: z.number().int().min(0),
  ca_total: z.number().min(0),
});

export type EntrepriseWithStats = z.infer<typeof EntrepriseWithStatsSchema>;

// Enterprise List Response
export const EntrepriseListResponseSchema = z.object({
  entreprises: z.array(EntrepriseWithStatsSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});

export type EntrepriseListResponse = z.infer<typeof EntrepriseListResponseSchema>;

// Enterprise Detail Response
export const EntrepriseDetailResponseSchema = EntrepriseResponseSchema.extend({
  inscriptions: z.array(
    z.object({
      id: z.string().uuid(),
      numero_inscription: z.string(),
      date_inscription: z.string().datetime(),
      statut: z.string(),
      montant_ttc: z.number(),
      formation: z.string(),
      session_code: z.string(),
      apprenant: z.string(),
    })
  ),
  statistiques: z.object({
    nb_inscriptions: z.number().int().min(0),
    nb_apprenants: z.number().int().min(0),
    ca_total: z.number().min(0),
    formations_suivies: z.array(z.string()),
  }),
});

export type EntrepriseDetailResponse = z.infer<typeof EntrepriseDetailResponseSchema>;

// Generate Grouped Invoice Request
export const GenerateFacturationGroupeeRequestSchema = z.object({
  inscription_ids: z.array(z.string().uuid()).min(1),
  date_echeance: z.string().datetime().optional(),
});

export type GenerateFacturationGroupeeRequest = z.infer<typeof GenerateFacturationGroupeeRequestSchema>;

// Generate Grouped Invoice Response
export const GenerateFacturationGroupeeResponseSchema = z.object({
  facture_url: z.string().url(),
  numero_facture: z.string(),
});

export type GenerateFacturationGroupeeResponse = z.infer<typeof GenerateFacturationGroupeeResponseSchema>;

