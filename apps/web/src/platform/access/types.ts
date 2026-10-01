/**
 * Contrats consommés par les hooks d'accès (`usePermission`, `useFeature`).
 *
 * Endpoints du kernel/RBAC (Phase 1, piste A) :
 *   GET /api/v1/rbac/me/permissions -> { permissions: string[] }
 *   GET /api/v1/entitlements/me     -> { features: string[], plan?: string | null, packs?: string[] }
 *
 * Quand `packages/contracts/src/v2/*` publiera ces schémas, remplacer les définitions ci-dessous par un
 * import ; la forme est volontairement minimale pour que ce changement soit transparent.
 */

import { z } from "zod";

export const MyPermissionsSchema = z.object({
  /** Clés `ressource.action` accordées à l'utilisateur courant (jokers `*` et `ressource.*` acceptés). */
  permissions: z.array(z.string()),
  roles: z.array(z.string()).optional(),
});
export type MyPermissions = z.infer<typeof MyPermissionsSchema>;

export const MyEntitlementsSchema = z.object({
  /** Clés de fonctionnalités actives pour le tenant (plan + pack + surcharges). */
  features: z.array(z.string()),
  plan: z.string().nullish(),
  packs: z.array(z.string()).optional(),
});
export type MyEntitlements = z.infer<typeof MyEntitlementsSchema>;

export const PERMISSIONS_ENDPOINT = "/api/v1/rbac/me/permissions";
export const ENTITLEMENTS_ENDPOINT = "/api/v1/entitlements/me";
