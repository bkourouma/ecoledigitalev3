/**
 * Contrats v2 de la console plateforme (`/api/v1/platform/*`) — opérations réservées aux opérateurs
 * (super-admin) : provisionner un tenant, changer son statut, plans, abonnements, surcharges.
 *
 * Les corps d'abonnement et de surcharge sont ceux du module `entitlements` (mêmes schémas) ; la console
 * ajoute l'orchestration (provisioning complet) et la liste des organisations.
 */
import { z } from "zod";
import { CatalogKeySchema } from "./entitlements";
import { ProvisionTenantInputSchema, TenantStatusSchema } from "./tenancy";

const UuidSchema = z.string().uuid();

/** Essai accordé au tenant provisionné (défaut : plan `STARTER`, 30 jours). */
export const PlatformTrialSchema = z
  .object({
    planKey: CatalogKeySchema.optional(),
    days: z.number().int().min(1).max(365).optional(),
  })
  .strict();

export const PlatformProvisionTenantBodySchema = ProvisionTenantInputSchema.extend({
  trial: PlatformTrialSchema.optional(),
}).strict();
export type PlatformProvisionTenantBody = z.infer<typeof PlatformProvisionTenantBodySchema>;

export const PlatformTenantParamsSchema = z.object({ tenantId: UuidSchema }).strict();

export const PlatformListTenantsQuerySchema = z
  .object({
    status: TenantStatusSchema.optional(),
    search: z.string().trim().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type PlatformListTenantsQuery = z.infer<typeof PlatformListTenantsQuerySchema>;

export const PlatformSetTenantStatusBodySchema = z
  .object({
    status: TenantStatusSchema,
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();
export type PlatformSetTenantStatusBody = z.infer<typeof PlatformSetTenantStatusBodySchema>;

export const PlatformTenantSummarySchema = z.object({
  id: UuidSchema,
  slug: z.string(),
  name: z.string(),
  status: TenantStatusSchema,
  createdAt: z.string(),
});
export type PlatformTenantSummary = z.infer<typeof PlatformTenantSummarySchema>;

export const PlatformTenantListResponseSchema = z.object({
  items: z.array(PlatformTenantSummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type PlatformTenantListResponse = z.infer<typeof PlatformTenantListResponseSchema>;
