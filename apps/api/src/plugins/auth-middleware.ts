import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";
import { decodeToken, extractTokenFromHeader, verifyToken } from "../services/jwt.service";
import { verifySuperAdminToken } from "../services/super-admin-jwt.service";
import { isBlacklisted } from "../services/blacklist.service";
import {
  loadUserAuthContextById,
  persistActiveRolePreference,
} from "../services/user-auth.service";
import {
  ensureTechnicalAccountsForTenant,
  resolveTenantTechnicalUser,
} from "../services/tenant-provisioning.service";
import { setRlsContext } from "../services/rls-context.service";
import { shouldBypassLegacyAuth } from "../platform/public-routes";

function isSensitiveOperation(method: string): boolean {
  return ["POST", "PUT", "DELETE", "PATCH"].includes(method.toUpperCase());
}

async function attachTenantUser(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  token: string
): Promise<boolean> {
  const payload = verifyToken(token);

  if (payload.scope !== "tenant_user") {
    return false;
  }

  setRlsContext({
    tenantId: payload.tenantId,
    isSuperAdmin: false,
  });

  if (request.tenantId && payload.tenantId !== request.tenantId) {
    await reply.status(401).send({
      error: "Tenant Mismatch",
      message: "Token tenant does not match request context",
      code: "TENANT_MISMATCH",
    });
    return true;
  }

  if (
    isSensitiveOperation(request.method) &&
    (await isBlacklisted(fastify, {
      scope: "tenant_user",
      tenantId: payload.tenantId,
      tokenJti: payload.jti,
    }))
  ) {
    await reply.status(401).send({
      error: "Token Revoked",
      message: "Token has been revoked",
      code: "TOKEN_REVOKED",
    });
    return true;
  }

  const client = await fastify.pg.connect();
  try {
    const context = await loadUserAuthContextById(client, payload.userId, payload.activeRole);
    if (!context) {
      await reply.status(401).send({
        error: "Authentication Failed",
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
      return true;
    }

    if (!context.tenantIsActive) {
      await reply.status(403).send({
        error: "Tenant Disabled",
        message: "This tenant is disabled",
        code: "TENANT_DISABLED",
      });
      return true;
    }

    if (!context.userIsActive) {
      await reply.status(403).send({
        error: "Account Disabled",
        message: "This account is disabled",
        code: "ACCOUNT_DISABLED",
      });
      return true;
    }

    const roleUpdatedResult = await client.query<{ role_updated_at: Date | null }>(
      "SELECT role_updated_at FROM users WHERE id = $1 AND tenant_id = $2",
      [payload.userId, payload.tenantId]
    );

    const roleUpdatedAt = roleUpdatedResult.rows[0]?.role_updated_at;
    if (roleUpdatedAt) {
      const roleUpdatedTimestamp = Math.floor(new Date(roleUpdatedAt).getTime() / 1000);
      if (roleUpdatedTimestamp > payload.iat) {
        await reply.status(401).send({
          error: "Roles Changed",
          message: "Your roles have changed, please log in again",
          code: "ROLES_CHANGED",
        });
        return true;
      }
    }

    const activeRole =
      context.availableRoles.includes(payload.activeRole) && payload.activeRole
        ? payload.activeRole
        : context.activeRole;

    if (!context.availableRoles.includes(activeRole)) {
      await reply.status(401).send({
        error: "Roles Changed",
        message: "Your active role is no longer available",
        code: "ROLES_CHANGED",
      });
      return true;
    }

    request.tenantId = context.tenantId;
    request.tenantSlug = context.tenantSlug;
    request.user = {
      id: context.userId,
      email: context.email,
      tenantId: context.tenantId,
      tenantSlug: context.tenantSlug,
      activeRole,
      role: activeRole,
      roles: [activeRole],
      availableRoles: context.availableRoles,
    };
    request.userId = context.userId;
    request.isAdmin = activeRole === "admin";

    if (activeRole !== context.activeRole) {
      await persistActiveRolePreference(client, context.userId, activeRole);
    }

    return false;
  } finally {
    client.release();
  }
}

async function attachSuperAdmin(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  token: string
): Promise<boolean> {
  const payload = verifySuperAdminToken(token);

  if (
    isSensitiveOperation(request.method) &&
    (await isBlacklisted(fastify, {
      scope: "super_admin",
      tokenJti: payload.jti,
    }))
  ) {
    await reply.status(401).send({
      error: "Token Revoked",
      message: "Token has been revoked",
      code: "TOKEN_REVOKED",
    });
    return true;
  }

  request.superAdmin = {
    id: payload.superAdminId,
    email: payload.email,
    selectedTenantId: request.tenantId,
    selectedTenantSlug: request.tenantSlug,
  };

  if (request.url.startsWith("/api/v1/super-admin")) {
    setRlsContext({
      tenantId: null,
      isSuperAdmin: true,
    });
    return false;
  }

  if (!request.tenantId || !request.tenantSlug) {
    await reply.status(400).send({
      error: "Tenant Required",
      message: "A super administrator must choose a tenant before accessing tenant data",
      code: "TENANT_SELECTION_REQUIRED",
    });
    return true;
  }

  setRlsContext({
    tenantId: request.tenantId,
    isSuperAdmin: false,
  });

  const client = await fastify.pg.connect();
  try {
    await ensureTechnicalAccountsForTenant(client, request.tenantId, request.tenantSlug);
    const technicalAdmin = await resolveTenantTechnicalUser(client, request.tenantId, "admin");

    if (!technicalAdmin) {
      await reply.status(500).send({
        error: "Impersonation Failed",
        message: "Default admin technical account could not be resolved",
        code: "IMPERSONATION_FAILED",
      });
      return true;
    }

    request.superAdmin = {
      ...request.superAdmin,
      impersonatedUserId: technicalAdmin.userId,
    };

    request.user = {
      id: technicalAdmin.userId,
      email: technicalAdmin.email,
      tenantId: request.tenantId,
      tenantSlug: request.tenantSlug,
      activeRole: "admin",
      role: "admin",
      roles: ["admin"],
      availableRoles: ["admin"],
      impersonatedBySuperAdminId: payload.superAdminId,
    };
    request.userId = technicalAdmin.userId;
    request.isAdmin = true;

    return false;
  } finally {
    client.release();
  }
}

async function authMiddleware(fastify: FastifyInstance) {
  fastify.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    // Plateforme v2 : routes de modules déclarées `config.public` (login/refresh IAM, webhooks signés,
    // console super-admin…) et requêtes déjà authentifiées par un jeton IAM v2. Liste DÉRIVÉE des
    // déclarations de routes (platform/public-routes.ts), vide tant que la plateforme v2 est désactivée.
    if (shouldBypassLegacyAuth(request)) {
      return;
    }

    const skipAuthRoutes = [
      "/api/v1/auth/login",
      "/api/v1/auth/refresh",
      "/api/v1/auth/register-request",
      "/api/v1/health",
      "/api/v1/files/",
      "/api/v1/formations-pro",
      "/api/v1/super-admin/auth/login",
      "/api/v1/webhooks/livekit",
    ];

    const isPublicSessionsPro =
      request.url.startsWith("/api/v1/sessions-pro") &&
      request.method === "GET" &&
      !request.url.startsWith("/api/v1/admin/sessions-pro") &&
      !request.url.startsWith("/api/v1/sessions-pro/admin/");

    if (skipAuthRoutes.some((route) => request.url.startsWith(route)) || isPublicSessionsPro) {
      return;
    }

    const token = extractTokenFromHeader(request.headers.authorization as string | undefined);
    if (!token) {
      return reply.status(401).send({
        error: "Authentication Required",
        message: "No authentication token provided",
        code: "TOKEN_MISSING",
      });
    }

    const decodedToken = decodeToken(token) as { scope?: string } | null;
    const isSuperAdminToken = decodedToken?.scope === "super_admin";

    const primaryAuthenticator = isSuperAdminToken ? attachSuperAdmin : attachTenantUser;
    const secondaryAuthenticator = isSuperAdminToken ? attachTenantUser : attachSuperAdmin;

    try {
      const handled = await primaryAuthenticator(fastify, request, reply, token);
      if (!handled) {
        return;
      }
      return;
    } catch (primaryError) {
      try {
        const handled = await secondaryAuthenticator(fastify, request, reply, token);
        if (!handled) {
          return;
        }
        return;
      } catch (secondaryError) {
        const error = secondaryError instanceof Error ? secondaryError : primaryError;
        fastify.log.error({ err: error }, "authentication failed");

        return reply.status(401).send({
          error: "Authentication Failed",
          message: error instanceof Error ? error.message : "Token validation failed",
          code: "AUTH_FAILED",
        });
      }
    }
  });
}

export default fastifyPlugin(authMiddleware, {
  name: "auth-middleware",
});
