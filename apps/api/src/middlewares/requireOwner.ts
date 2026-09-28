import type { FastifyReply, FastifyRequest } from "fastify";

type RequestUser = { id: string; roles?: string[]; availableRoles?: string[] };

function hasNormalizedRole(roles: string[] | undefined, allowedRoles: string[]): boolean {
  if (!Array.isArray(roles)) return false;
  const normalizedRoles = roles.map((role) => String(role).toLowerCase());
  return allowedRoles.some((role) => normalizedRoles.includes(role));
}

/**
 * Rôles à considérer pour AUTORISER, et pourquoi ce ne sont pas ceux de `roles`.
 *
 * `auth-middleware` remplit `roles: [activeRole]` — uniquement le rôle sous
 * lequel la personne navigue à cet instant. Conséquence, corrigée ici : un
 * compte **owner ET admin** dont le rôle actif est `admin` recevait un 403 sur
 * TOUT l'espace propriétaire. Le fondateur d'une école qui administre aussi son
 * établissement se voyait refuser ses propres statistiques, sans explication,
 * simplement parce qu'il avait basculé de casquette.
 *
 * L'autorisation se fonde sur ce que la personne EST — `availableRoles`, la
 * liste de ses rôles sur ce tenant — et non sur celui qu'elle a choisi
 * d'afficher. Le rôle actif garde son sens : il gouverne la PRÉSENTATION, le
 * menu et les préférences, pas le droit d'accès.
 *
 * `roles` est conservé en repli pour les appelants qui ne remplissent pas
 * `availableRoles`, et n'est pas modifié à la source : d'autres codes testent
 * `roles` pour décider d'actions, et y verser tous les rôles disponibles
 * élargirait silencieusement des permissions qui n'ont rien demandé.
 */
function rolesPourAutorisation(user: RequestUser | undefined): string[] {
  if (user?.availableRoles && user.availableRoles.length > 0) return user.availableRoles;
  return user?.roles ?? [];
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
  const roles = rolesPourAutorisation(user);
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
  const roles = rolesPourAutorisation(user);
  if (!hasNormalizedRole(roles, ["owner", "admin", "super_admin", "administrateur"])) {
    reply.status(403).send({
      success: false,
      error: "Forbidden",
      message: "Owner, admin or super-admin role required",
    });
    return;
  }
}
