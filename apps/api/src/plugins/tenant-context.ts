import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { extractTokenFromHeader, verifyTokenQuiet } from "../services/jwt.service";
import { setRlsContext } from "../services/rls-context.service";
import { isIamAccessTokenShape, isLegacyTokenSunsetReached } from "../platform/legacy-iam-bridge";

async function resolveTenant(
  fastify: FastifyInstance,
  identifier: string
): Promise<{ id: string; slug: string } | null> {
  const client = await fastify.pg.connect();

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
    const result = await client.query<{ id: string; slug: string }>(
      isUuid
        ? "SELECT id, slug FROM tenants WHERE id = $1 LIMIT 1"
        : "SELECT id, slug FROM tenants WHERE slug = $1 LIMIT 1",
      [identifier]
    );

    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

function headerTenant(request: FastifyRequest): string | undefined {
  const value = request.headers["x-tenant"];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value.trim() : undefined;
}

async function tenantContextPlugin(fastify: FastifyInstance) {
  fastify.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    request.tenantId = undefined;
    request.tenantSlug = undefined;
    request.tenantSelectionSource = undefined;

    // Le tenant d'un jeton n'est lu QU'APRÈS vérification (jamais d'un JWT simplement décodé, y compris sur les
    // routes publiques) :
    //  - jeton IAM v2 : `request.iamAuth`, posé par le crochet `onRequest` de platform/v2-auth.ts après signature,
    //    session, révocation, époque, accès et tenant actifs ;
    //  - jeton legacy : signature + expiration + émetteur, et seulement tant que LEGACY_TOKEN_SUNSET n'est pas atteinte.
    // Un jeton invalide ne désigne aucun tenant : on retombe sur l'en-tête X-Tenant, exactement comme sans jeton
    // (le middleware d'authentification répond 401 sur les routes protégées).
    const token = extractTokenFromHeader(request.headers.authorization as string | undefined);
    if (token) {
      if (isIamAccessTokenShape(token)) {
        const principal = request.iamAuth?.principal;
        if (principal) {
          request.tenantId = principal.ctx.tenantId;
          request.tenantSlug = principal.tenantSlug;
          request.tenantSelectionSource = "token";
        }
      } else {
        const tenantUserPayload = isLegacyTokenSunsetReached() ? null : verifyTokenQuiet(token);
        if (tenantUserPayload?.scope === "tenant_user" && tenantUserPayload.tenantId) {
          request.tenantId = tenantUserPayload.tenantId;
          request.tenantSlug = tenantUserPayload.tenantSlug;
          request.tenantSelectionSource = "token";
        }
      }
    }

    if (!request.tenantId) {
      const selectedTenant = headerTenant(request);
      if (selectedTenant) {
        const resolved = await resolveTenant(fastify, selectedTenant);
        if (resolved) {
          request.tenantId = resolved.id;
          request.tenantSlug = resolved.slug;
          request.tenantSelectionSource = "header";
        }
      }
    }

    // Mirror the resolved tenant onto the X-Tenant header so route handlers
    // that still read `request.headers['x-tenant']` directly see a valid
    // value. The host nginx force-overrides X-Tenant from the request
    // subdomain and strips it when empty (main domain), so without this
    // mirror those routes 400 even when the JWT carries the tenant.
    if (request.tenantId) {
      (request.headers as Record<string, string>)["x-tenant"] = request.tenantId;
    }

    setRlsContext({
      tenantId: request.tenantId ?? null,
      isSuperAdmin: false,
    });

    const tenantRequiredPrefixes = [
      "/api/v1/users",
      "/api/v1/attendance",
      "/api/v1/classes",
      "/api/v1/courses",
      "/api/v1/teachers",
      "/api/v1/students",
      "/api/v1/programmes",
      "/api/v1/cycles",
      "/api/v1/academic-years",
      "/api/v1/enrollments",
      "/api/v1/teacher-assignments",
      "/api/v1/assignments",
      "/api/v1/teacher-payments",
      "/api/v1/teacher-payment-configs",
      "/api/v1/payment-reports",
      "/api/v1/payment-periods",
      "/api/v1/tuition-schedules",
      "/api/v1/student-payments",
      "/api/v1/receipts",
      "/api/v1/notifications",
      "/api/v1/financial-reports",
      "/api/v1/cycle-fees",
      "/api/v1/classrooms",
      "/api/v1/classroom-reservations",
      "/api/v1/assignment-instances",
      "/api/v1/owner",
      "/api/v1/parent",
      "/api/v1/teacher",
      "/api/v1/admin",
      "/api/v1/registration-requests",
      "/api/v1/professional",
    ];

    // Un jeton présent mais NON vérifié (expiré, révoqué, forgé, d'un autre type…) ne désigne aucun tenant : la réponse
    // attendue est le 401 de l'authentification (plugins/auth-middleware.ts, exécuté ensuite), pas « Tenant Required ».
    // Avant, le tenant d'un jeton simplement décodé suffisait à passer ce contrôle ; il n'est plus lu sans vérification.
    const requiresTenant = tenantRequiredPrefixes.some((prefix) => request.url.startsWith(prefix));
    if (requiresTenant && !request.tenantId && !token && !request.url.startsWith("/api/v1/super-admin")) {
      return reply.status(400).send({
        error: "Tenant Required",
        message: "This endpoint requires tenant context via token or X-Tenant header",
      });
    }
  });
}

export { tenantContextPlugin };
export default fp(tenantContextPlugin);
