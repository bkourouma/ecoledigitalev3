/**
 * Contrats du module `rbac` (routes `/api/v1/rbac/*`). Écrits avant les routes
 * (ADR-001 règle 6) ; le client web est typé à partir de ces schémas.
 *
 * Dates : ISO 8601 UTC (`...Z`). Identifiants : UUID. Libellés : français.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** `ressource.action` ou `ressource.sous.action` (identique au kernel). */
export const rbacPermissionKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$/, "Clé de permission invalide.");

export const rbacRoleKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,62}$/, "La clé doit être en minuscules, chiffres et « _ » (2 à 63 caractères).");

export const rbacUuidSchema = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });

/** Périmètre : tout le tenant, un établissement ou un campus. */
export const rbacScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tenant") }).strict(),
  z.object({ type: z.literal("institution"), id: rbacUuidSchema }).strict(),
  z.object({ type: z.literal("campus"), id: rbacUuidSchema }).strict(),
]);
export type RbacScope = z.infer<typeof rbacScopeSchema>;

// ---------------------------------------------------------------------------
// Catalogue de permissions
// ---------------------------------------------------------------------------

export const rbacPermissionEntrySchema = z.object({
  key: rbacPermissionKeySchema,
  label: z.string(),
  description: z.string().nullable(),
  /** Permission sensible : exige que la session ait satisfait la MFA. */
  sensitive: z.boolean(),
  moduleKey: z.string(),
  moduleTitle: z.string().nullable(),
});
export type RbacPermissionEntry = z.infer<typeof rbacPermissionEntrySchema>;

export const rbacPermissionCatalogResponseSchema = z.object({
  permissions: z.array(rbacPermissionEntrySchema),
});
export type RbacPermissionCatalogResponse = z.infer<typeof rbacPermissionCatalogResponseSchema>;

// ---------------------------------------------------------------------------
// Rôles
// ---------------------------------------------------------------------------

export const rbacRoleSummarySchema = z.object({
  id: rbacUuidSchema,
  key: rbacRoleKeySchema,
  label: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  /** Un rôle système est verrouillé : on le clone pour l'adapter. */
  locked: z.boolean(),
  templateKey: z.string().nullable(),
  clonedFromRoleId: rbacUuidSchema.nullable(),
  permissionCount: z.number().int().nonnegative(),
  /** Motifs de modèle sans correspondance dans le catalogue (module pas encore déployé). */
  pendingCount: z.number().int().nonnegative(),
  assignmentCount: z.number().int().nonnegative(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type RbacRoleSummary = z.infer<typeof rbacRoleSummarySchema>;

export const rbacRoleListResponseSchema = z.object({ roles: z.array(rbacRoleSummarySchema) });
export type RbacRoleListResponse = z.infer<typeof rbacRoleListResponseSchema>;

export const rbacRoleDetailSchema = rbacRoleSummarySchema
  .omit({ permissionCount: true, pendingCount: true })
  .extend({
    permissions: z.array(rbacPermissionKeySchema),
    pendingPermissions: z.array(z.string()),
  });
export type RbacRoleDetail = z.infer<typeof rbacRoleDetailSchema>;

const roleLabel = z.string().trim().min(1, "Le libellé est obligatoire.").max(120);
const roleDescription = z.string().trim().max(1000).nullable();

export const rbacCreateRoleBodySchema = z
  .object({
    /** Optionnelle : dérivée du libellé si absente. */
    key: rbacRoleKeySchema.optional(),
    label: roleLabel,
    description: roleDescription.optional(),
    permissions: z.array(rbacPermissionKeySchema).max(1000).default([]),
  })
  .strict();
export type RbacCreateRoleBody = z.infer<typeof rbacCreateRoleBodySchema>;

export const rbacCloneRoleBodySchema = z
  .object({
    key: rbacRoleKeySchema.optional(),
    label: roleLabel,
    description: roleDescription.optional(),
  })
  .strict();
export type RbacCloneRoleBody = z.infer<typeof rbacCloneRoleBodySchema>;

export const rbacUpdateRoleBodySchema = z
  .object({
    label: roleLabel.optional(),
    description: roleDescription.optional(),
    /** Remplace l'ensemble des permissions du rôle. */
    permissions: z.array(rbacPermissionKeySchema).max(1000).optional(),
  })
  .strict()
  .refine((v) => v.label !== undefined || v.description !== undefined || v.permissions !== undefined, {
    message: "Au moins un champ à modifier est requis.",
  });
export type RbacUpdateRoleBody = z.infer<typeof rbacUpdateRoleBodySchema>;

// ---------------------------------------------------------------------------
// Assignations
// ---------------------------------------------------------------------------

export const rbacAssignmentSchema = z.object({
  id: rbacUuidSchema,
  userId: rbacUuidSchema,
  identityId: rbacUuidSchema.nullable(),
  roleId: rbacUuidSchema,
  roleKey: rbacRoleKeySchema,
  scope: rbacScopeSchema,
  validFrom: isoDate.nullable(),
  validUntil: isoDate.nullable(),
  grantedBy: rbacUuidSchema.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type RbacAssignment = z.infer<typeof rbacAssignmentSchema>;

export const rbacAssignmentListResponseSchema = z.object({ assignments: z.array(rbacAssignmentSchema) });
export type RbacAssignmentListResponse = z.infer<typeof rbacAssignmentListResponseSchema>;

export const rbacCreateAssignmentBodySchema = z
  .object({
    userId: rbacUuidSchema,
    identityId: rbacUuidSchema.nullish(),
    roleId: rbacUuidSchema,
    scope: rbacScopeSchema.default({ type: "tenant" }),
    validFrom: isoDate.nullish(),
    validUntil: isoDate.nullish(),
  })
  .strict()
  .refine((v) => !v.validFrom || !v.validUntil || Date.parse(v.validUntil) > Date.parse(v.validFrom), {
    message: "La fin de validité doit suivre le début.",
    path: ["validUntil"],
  });
export type RbacCreateAssignmentBody = z.infer<typeof rbacCreateAssignmentBodySchema>;

export const rbacUpdateAssignmentBodySchema = z
  .object({
    validFrom: isoDate.nullable().optional(),
    validUntil: isoDate.nullable().optional(),
  })
  .strict()
  .refine((v) => v.validFrom !== undefined || v.validUntil !== undefined, {
    message: "Au moins un champ à modifier est requis.",
  });
export type RbacUpdateAssignmentBody = z.infer<typeof rbacUpdateAssignmentBodySchema>;

export const rbacListAssignmentsQuerySchema = z.object({
  userId: rbacUuidSchema.optional(),
  roleId: rbacUuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});
export type RbacListAssignmentsQuery = z.infer<typeof rbacListAssignmentsQuerySchema>;

export const rbacIdParamsSchema = z.object({ id: rbacUuidSchema });

// ---------------------------------------------------------------------------
// « Moi » : permissions effectives et navigation
// ---------------------------------------------------------------------------

export const rbacMyPermissionSchema = z.object({
  key: rbacPermissionKeySchema,
  sensitive: z.boolean(),
  /** Périmètres où la permission est accordée ; `[{type:"tenant"}]` = partout. */
  scopes: z.array(rbacScopeSchema),
});

export const rbacMyPermissionsResponseSchema = z.object({
  tenantId: rbacUuidSchema,
  userId: rbacUuidSchema,
  mfa: z.boolean(),
  permissions: z.array(rbacMyPermissionSchema),
  /** Permissions sensibles détenues mais inutilisables tant que la MFA n'est pas satisfaite. */
  requiresMfa: z.array(rbacPermissionKeySchema),
});
export type RbacMyPermissionsResponse = z.infer<typeof rbacMyPermissionsResponseSchema>;

export const rbacPortalSchema = z.enum(["admin", "teacher", "parent", "student", "owner", "super-admin"]);
export type RbacPortal = z.infer<typeof rbacPortalSchema>;

export const rbacNavItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  href: z.string(),
  portal: rbacPortalSchema,
  icon: z.string().optional(),
  order: z.number(),
  moduleKey: z.string(),
  permission: rbacPermissionKeySchema,
  feature: z.string().optional(),
});
export type RbacNavItem = z.infer<typeof rbacNavItemSchema>;

export const rbacNavigationResponseSchema = z.object({
  portals: z.object({
    admin: z.array(rbacNavItemSchema),
    teacher: z.array(rbacNavItemSchema),
    parent: z.array(rbacNavItemSchema),
    student: z.array(rbacNavItemSchema),
    owner: z.array(rbacNavItemSchema),
    "super-admin": z.array(rbacNavItemSchema),
  }),
  availablePortals: z.array(rbacPortalSchema),
});
export type RbacNavigationResponse = z.infer<typeof rbacNavigationResponseSchema>;
