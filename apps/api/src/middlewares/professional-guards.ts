import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Gardes de rôle du Module Professionnel (feature 028).
 * Calqués sur middlewares/requireOwner.ts — fonctions `preHandler` Fastify.
 *
 * Pré-requis : `authMiddleware` (peuple `request.user`) et `tenantContextPlugin`
 * (peuple `request.tenantId`) doivent s'exécuter avant ces gardes.
 */

type RequestUser = { id: string; roles?: string[] };

function hasNormalizedRole(roles: string[] | undefined, allowedRoles: string[]): boolean {
  if (!Array.isArray(roles)) return false;
  const normalizedRoles = roles.map((role) => String(role).toLowerCase());
  return allowedRoles.some((role) => normalizedRoles.includes(role));
}

function getRoles(request: FastifyRequest): string[] {
  const user = (request as FastifyRequest & { user?: RequestUser }).user;
  return user?.roles ?? [];
}

/** Vérifie la présence du contexte tenant. Renvoie false (et répond 400) si absent. */
function ensureTenant(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.tenantId) {
    reply.status(400).send({
      success: false,
      error: "TENANT_REQUIRED",
      message: "This endpoint requires tenant context",
    });
    return false;
  }
  return true;
}

function makeRoleGuard(allowedRoles: string[], message: string) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!ensureTenant(request, reply)) return;
    if (!hasNormalizedRole(getRoles(request), allowedRoles)) {
      reply.status(403).send({
        success: false,
        error: "FORBIDDEN",
        message,
      });
    }
  };
}

/** Réservé aux administrateurs de l'établissement. */
export const requireAdmin = makeRoleGuard(
  ["admin", "super_admin", "administrateur"],
  "Admin role required"
);

/** Réservé aux étudiants. */
export const requireStudent = makeRoleGuard(["student"], "Student role required");

/** Réservé aux parents. */
export const requireParent = makeRoleGuard(["parent"], "Parent role required");

/** Administrateurs ou enseignants (ex. marquer une inscription « terminée »). */
export const requireAdminOrTeacher = makeRoleGuard(
  ["admin", "super_admin", "administrateur", "teacher"],
  "Admin or teacher role required"
);

/** Réservé aux enseignants. */
export const requireTeacher = makeRoleGuard(["teacher"], "Teacher role required");
