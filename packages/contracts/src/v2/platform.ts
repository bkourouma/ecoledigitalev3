/**
 * Contrats v2 de la console plateforme (`/api/v1/platform/*`) — opérations réservées aux opérateurs
 * (super-admin) : provisionner un tenant, changer son statut, plans, abonnements, surcharges.
 *
 * Les corps d'abonnement et de surcharge sont ceux du module `entitlements` (mêmes schémas) ; la console
 * ajoute l'orchestration (provisioning complet) et la liste des organisations.
 */
import { z } from "zod";
import { CatalogKeySchema } from "./entitlements";
import { InstitutionPackSchema, ProvisionTenantInputSchema, TenantStatusSchema } from "./tenancy";

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

// ---------------------------------------------------------------------------
// Réponses RÉELLES de la console (validées contre l'API réelle : test `platform-console.integration.test.ts`)
// ---------------------------------------------------------------------------

/**
 * Réponse de `POST /platform/tenants` (201) : le résultat de la CONSOLE (`provisionPlatformTenant`) — organisation,
 * établissements et campus par défaut, propriétaire invité, abonnement d'essai. Ce n'est PAS `ProvisionTenantResultSchema`
 * (module tenancy, qui porte l'`onboarding` et ignore le propriétaire et l'abonnement) : la console enchaîne plusieurs
 * modules. Aucun mot de passe ni jeton d'invitation n'y figure (l'invitation part par e-mail).
 */
export const PlatformProvisionTenantResponseSchema = z.object({
  tenantId: UuidSchema,
  slug: z.string(),
  institutions: z.array(z.object({ id: UuidSchema, code: z.string(), pack: InstitutionPackSchema, defaultCampusId: UuidSchema })),
  owner: z.object({ identityId: UuidSchema, membershipId: UuidSchema, email: z.string().email() }),
  subscription: z.object({ planKey: CatalogKeySchema, status: z.literal("TRIALING"), endsAt: z.string().datetime({ offset: true }).nullable() }),
});
export type PlatformProvisionTenantResponse = z.infer<typeof PlatformProvisionTenantResponseSchema>;

/** Réponse de `PATCH /platform/tenants/:tenantId/status` (200) : la transition effectuée. */
export const PlatformSetTenantStatusResponseSchema = z.object({
  tenantId: UuidSchema,
  previous: TenantStatusSchema,
  current: TenantStatusSchema,
});
export type PlatformSetTenantStatusResponse = z.infer<typeof PlatformSetTenantStatusResponseSchema>;
