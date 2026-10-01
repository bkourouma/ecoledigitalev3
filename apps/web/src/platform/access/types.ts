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

/**
 * `GET /api/v1/rbac/me/permissions` renvoie `{ tenantId, userId, mfa, permissions: [{ key, sensitive, scopes }], requiresMfa }`
 * (contrat `rbacMyPermissionsResponseSchema`). L'ancienne forme `permissions: string[]` reste acceptée ; dans les deux cas
 * `permissions` est normalisé en liste de clés, et `sensitive` / `requiresMfa` sont conservés.
 */
const PermissionEntrySchema = z.union([
  z.string(),
  z.object({ key: z.string(), sensitive: z.boolean().optional(), scopes: z.array(z.unknown()).optional() }),
]);

export const MyPermissionsSchema = z
  .object({
    /** Clés `ressource.action` accordées à l'utilisateur courant (jokers `*` et `ressource.*` acceptés). */
    permissions: z.array(PermissionEntrySchema),
    roles: z.array(z.string()).optional(),
    /** La session a satisfait la MFA (permissions sensibles utilisables). */
    mfa: z.boolean().optional(),
    /** Permissions sensibles détenues mais inutilisables tant que la MFA n'est pas satisfaite. */
    requiresMfa: z.array(z.string()).optional(),
  })
  .transform((value) => ({
    ...value,
    permissions: value.permissions.map((p) => (typeof p === "string" ? p : p.key)),
    sensitive: value.permissions.flatMap((p) => (typeof p !== "string" && p.sensitive ? [p.key] : [])),
  }));
export type MyPermissions = z.output<typeof MyPermissionsSchema>;

export const MyEntitlementsSchema = z.object({
  /** Clés de fonctionnalités actives pour le tenant (plan + pack + surcharges). */
  features: z.array(z.string()),
  plan: z.string().nullish(),
  packs: z.array(z.string()).optional(),
});
export type MyEntitlements = z.infer<typeof MyEntitlementsSchema>;

export const PERMISSIONS_ENDPOINT = "/api/v1/rbac/me/permissions";
export const ENTITLEMENTS_ENDPOINT = "/api/v1/entitlements/me";
