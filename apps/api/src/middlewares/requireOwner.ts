import type { FastifyReply, FastifyRequest } from "fastify";

type RequestUser = { id: string; roles?: string[] };

function hasNormalizedRole(roles: string[] | undefined, allowedRoles: string[]): boolean {
  if (!Array.isArray(roles)) return false;
  const normalizedRoles = roles.map((role) => String(role).toLowerCase());
  return allowedRoles.some((role) => normalizedRoles.includes(role));
}

/**
 * Ensures JWT-authenticated user has role "owner" on the current tenant.
 * Requires tenant context (X-Tenant / subdomain) so tenantId is set before auth.
 */
export async function requireOwner(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const tenantId = request.tenantId;
  if (!tenantId) {
    reply.status(400).send({
      success: false,
      error: "Tenant Required",
      message: "This endpoint requires tenant context",
    });
    return;
  }

  const user = (request as FastifyRequest & { user?: RequestUser }).user;
  const roles = user?.roles ?? [];
  if (!hasNormalizedRole(roles, ["owner"])) {
    reply.status(403).send({
      success: false,
      error: "Forbidden",
      message: "Owner role required",
    });
    return;
  }
}

/**
 * Access-management endpoints are available to owner, admin and super-admin.
 * This is narrower than the full owner area and is used only on dedicated routes.
 */
export async function requireOwnerOrAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const tenantId = request.tenantId;
  if (!tenantId) {
    reply.status(400).send({
      success: false,
      error: "Tenant Required",
      message: "This endpoint requires tenant context",
    });
    return;
  }

  const user = (request as FastifyRequest & { user?: RequestUser }).user;
  const roles = user?.roles ?? [];
  if (!hasNormalizedRole(roles, ["owner", "admin", "super_admin", "administrateur"])) {
    reply.status(403).send({
      success: false,
      error: "Forbidden",
      message: "Owner, admin or super-admin role required",
    });
    return;
  }
}
