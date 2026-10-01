import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    tenantId?: string;
    tenantSlug?: string;
    tenantSelectionSource?: "token" | "header";
    userId?: string;
    isAdmin?: boolean;
    user?: {
      id: string;
      email: string;
      tenantId?: string;
      tenantSlug?: string;
      activeRole?: string;
      role?: string;
      roles: string[];
      availableRoles?: string[];
      impersonatedBySuperAdminId?: string;
      /** `iam` quand l'utilisateur a été construit par la passerelle IAM v2 (platform/legacy-iam-bridge.ts), sinon absent (jeton legacy). */
      authSource?: "iam";
      /** Session et identité IAM d'origine (passerelle) : l'identifiant `id` ci-dessus reste celui du compte LEGACY. */
      iamSessionId?: string;
      iamIdentityId?: string;
    };
    /**
     * Requête faite sous une impersonation IAM v2 (passerelle). Volontairement distinct de `superAdmin` : les routes
     * `/super-admin/*` testent `request.superAdmin`, et une session d'impersonation ne doit pas y donner accès.
     * Lu par plugins/super-admin-audit.ts pour journaliser chaque requête (acteur réel + utilisateur imité).
     */
    iamImpersonation?: {
      superAdminId: string;
      tenantId: string;
      tenantSlug: string;
      /** Identifiant du compte LEGACY imité (routes legacy) ; `null` sur une route de module v2 (la FK vise `users.id`, pas l'identité IAM). */
      impersonatedUserId: string | null;
    };
    superAdmin?: {
      id: string;
      email: string;
      selectedTenantId?: string;
      selectedTenantSlug?: string;
      impersonatedUserId?: string;
    };
  }
}

export {};
