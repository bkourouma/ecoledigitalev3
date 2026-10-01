import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";

/**
 * Application Fastify MINIMALE qui monte les VRAIS plugins de routes legacy.
 *
 * Choix : on appelle les routes par `inject` plutôt que de recopier leur logique, car la logique de calcul
 * de la pile classique vit dans des fermetures non exportées de `routes/semester-averages.ts`, et celle de la
 * paie dans des handlers de `routes/teacher-payments.ts`. Seule la couche d'authentification est remplacée :
 * le contexte (tenant, utilisateur, rôles) est lu dans des en-têtes `x-test-*`, ce qui évite d'émettre un
 * JWT ou de dépendre du plugin d'auth legacy (qui exige des secrets). Aucune autre route n'est montée.
 *
 * `pg` est le pool de la base du scénario (même API que `@fastify/postgres` : `pg.connect()`).
 */
export interface TestAuth {
  tenantId: string;
  userId: string;
  roles?: string[];
}

declare module "fastify" {
  interface FastifyInstance {
    pg: Pool;
  }
  interface FastifyRequest {
    tenantId?: string;
    userId?: string;
    user?: { id: string; roles: string[] };
  }
}

export async function buildLegacyApp(
  pool: Pool,
  register: (app: FastifyInstance) => Promise<void>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("pg", pool);
  app.decorateRequest("tenantId", undefined);
  app.decorateRequest("userId", undefined);
  app.decorateRequest("user", undefined);
  app.addHook("onRequest", async (request) => {
    const tenant = request.headers["x-test-tenant"];
    const user = request.headers["x-test-user"];
    const roles = request.headers["x-test-roles"];
    if (typeof tenant === "string") request.tenantId = tenant;
    if (typeof user === "string") {
      request.userId = user;
      request.user = { id: user, roles: typeof roles === "string" ? roles.split(",") : [] };
    }
  });
  await register(app);
  await app.ready();
  return app;
}

export function authHeaders(auth: TestAuth): Record<string, string> {
  return {
    "x-test-tenant": auth.tenantId,
    "x-test-user": auth.userId,
    "x-test-roles": (auth.roles ?? ["admin"]).join(","),
  };
}

/** Appelle une route et renvoie `{ status, body }` (corps JSON si possible). */
export async function call(
  app: FastifyInstance,
  auth: TestAuth,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  payload?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await app.inject({
    method,
    url,
    headers: { ...authHeaders(auth), ...(payload !== undefined ? { "content-type": "application/json" } : {}) },
    payload: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  let body: unknown = res.body;
  try {
    body = JSON.parse(res.body);
  } catch {
    // corps non JSON (PDF simulé)
  }
  return { status: res.statusCode, body };
}
