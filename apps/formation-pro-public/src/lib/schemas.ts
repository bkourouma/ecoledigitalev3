import { z } from "zod";

export const registerSchema = z.object({
  prenom: z.string().trim().min(2, "Le prénom est requis."),
  nom: z.string().trim().min(2, "Le nom est requis."),
  email: z.string().trim().email("Adresse email invalide."),
  telephone: z.string().trim().min(8, "Le numéro doit contenir au moins 8 chiffres."),
  password: z
    .string()
    .min(8, "Le mot de passe doit contenir au moins 8 caractères."),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

export const resendVerificationSchema = z.object({
  email: z.string().trim().email("Adresse email invalide."),
});

export const paymentInitSchema = z.object({
  formationId: z.string().min(1),
  sessionId: z.string().optional().nullable(),
  telephone: z.string().optional(),
});

export const catalogueFiltersSchema = z.object({
  search: z.string().trim().optional(),
  categorie: z.string().trim().optional(),
  niveau: z.string().trim().optional(),
  mode: z.string().trim().optional(),
  prixMin: z.coerce.number().optional(),
  prixMax: z.coerce.number().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(24).default(9),
});

export const createFormateurSchema = z.object({
  tenantId: z.string().trim().min(1, "Le tenant est requis."),
  prenom: z.string().trim().min(2, "Le prénom est requis."),
  nom: z.string().trim().min(2, "Le nom est requis."),
  email: z.string().trim().email("Adresse email invalide."),
  telephone: z.string().trim().optional(),
});

export const supportAssignmentSchema = z.object({
  supportId: z.string().trim().min(1, "Le support est requis."),
  formateurId: z.string().trim().min(1, "Le formateur est requis."),
  sessionId: z.string().trim().optional().nullable(),
});
