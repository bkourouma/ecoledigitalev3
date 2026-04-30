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
