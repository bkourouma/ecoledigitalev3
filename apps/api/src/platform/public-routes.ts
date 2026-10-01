/**
 * Routes PUBLIQUES des modules v2, DÉRIVÉES de leurs déclarations (`config: { public: true }`).
 *
 * Problème corrigé : le middleware d'authentification legacy (`plugins/auth-middleware.ts`) est un hook
 * `preHandler` racine qui s'applique à TOUTES les routes et qui répondait 401 à toute requête sans jeton
 * legacy valide — y compris `POST /api/v1/iam/login`, `POST /api/v1/iam/refresh` et les webhooks de
 * paiement signés `POST /api/v1/finance/webhooks/:provider/:tenantId`. Plutôt que d'allonger la liste
 * codée en dur du legacy, chaque route de module déclare `config: { public: true }` ; ce fichier relève ces
 * déclarations (hook `onRoute`) et expose `isDeclaredPublicRoute(request)`, que le middleware legacy
 * interroge. Sans plateforme v2 (V2_DATABASE_URL absent) la liste reste vide : comportement legacy inchangé.
 *
 * « Publique » = ne demande ni `request.ctx` ni l'authentification legacy ; la route s'authentifie
 * elle-même (mot de passe, signature HMAC d'un webhook, JWT super-admin…) ou est ouverte.
 *
 * Ce fichier n'importe ni pg, ni les paquets v2 : le middleware legacy peut l'importer sans les charger.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface PublicRouteEntry {
  method: string;
  /** Patron de route complet (préfixe compris), ex. `/api/v1/finance/webhooks/:provider/:tenantId`. */
  url: string;
}

const publicRoutes = new Map<string, PublicRouteEntry>();
const tracked = new WeakSet<FastifyInstance>();

const keyOf = (method: string, url: string): string => `${method.toUpperCase()} ${url}`;

/** Relève les routes `config.public` déclarées à partir de maintenant (idempotent par instance). */
export function trackPublicRoutes(app: FastifyInstance): void {
  if (tracked.has(app)) return;
  tracked.add(app);
  app.addHook("onRoute", (route) => {
    const config = (route.config ?? {}) as { public?: unknown };
    if (config.public !== true) return;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) publicRoutes.set(keyOf(String(method), route.url), { method: String(method).toUpperCase(), url: route.url });
  });
}

/** Routes publiques relevées, triées (documentation, tests). */
export function listPublicRoutes(): PublicRouteEntry[] {
  return [...publicRoutes.values()].sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
}

export function resetPublicRoutesForTests(): void {
  publicRoutes.clear();
}

/** La route appariée par Fastify pour cette requête a-t-elle été déclarée publique ? */
export function isDeclaredPublicRoute(request: FastifyRequest): boolean {
  if (publicRoutes.size === 0) return false;
  const route = request.routeOptions;
  if (!route?.url) return false;
  return publicRoutes.has(keyOf(request.method, route.url));
}

/** Marque posée par l'authentification v2 (jeton IAM) : le middleware legacy n'a alors rien à vérifier. */
declare module "fastify" {
  interface FastifyRequest {
    /** Posé par `platform/v2-auth.ts` quand un jeton IAM v2 valide a authentifié la requête. */
    v2Authenticated?: boolean;
  }
}

/**
 * Seul point d'appel du middleware legacy : `true` ⇒ il ne s'applique pas à cette requête.
 *  - route de module déclarée publique ;
 *  - requête déjà authentifiée par un jeton IAM v2 (hook `onRequest` de la plateforme).
 */
export function shouldBypassLegacyAuth(request: FastifyRequest): boolean {
  return request.v2Authenticated === true || isDeclaredPublicRoute(request);
}
