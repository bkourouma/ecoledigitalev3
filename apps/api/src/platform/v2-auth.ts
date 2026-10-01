/**
 * Authentification des routes de modules v2 : cohabitation du jeton IAM v2 et du jeton legacy.
 *
 *   Authorization: Bearer <jeton>
 *     ├─ jeton IAM v2 (`typ` d'en-tête `at+jwt` / `imp+jwt`)  -> CE hook (phase `onRequest`) : signature, session,
 *     │     révocation, époque, accès et tenant actifs (une requête SQL) ; pose `request.ctx` (mfa lu en base),
 *     │     `request.iamAuth` et `request.v2Authenticated`. Le middleware legacy, qui n'aurait vu qu'un jeton
 *     │     inconnu et répondu 401, s'efface (`shouldBypassLegacyAuth`).
 *     └─ jeton legacy (`typ: JWT`)  -> middleware legacy (`plugins/auth-middleware.ts`, inchangé) puis
 *           `v2-context` (`buildRequestContextFromLegacy`) qui en dérive `request.ctx`.
 *
 * Périmètre : uniquement les routes de MODULES v2 chargés (`/api/v1/<clé de module>/…`) qui ne sont pas
 * déclarées `config.public` (celles-ci s'authentifient elles-mêmes). Les routes legacy ne sont jamais touchées :
 * un jeton IAM y reste inconnu, comme avant.
 *
 * Un jeton IAM invalide (signature, expiré, session révoquée…) renvoie 401 au format d'erreur du module ; il ne
 * retombe PAS sur le legacy (aucune ambiguïté : le type d'en-tête désigne l'émetteur).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { unwrap } from "@ecoledigitale/kernel";
import { isIamBearerToken } from "../modules/iam";
import { MODULE_HTTP_PREFIX } from "../modules/registry-discovery";
import { requestIdFrom } from "./v2-context";

const BEARER = /^Bearer ([A-Za-z0-9._-]{20,4096})$/;

/** Clé de module d'une route `/api/v1/<clé>/…`, ou `undefined`. */
export function moduleKeyOfRoute(url: string | undefined, keys: ReadonlySet<string>): string | undefined {
  if (!url?.startsWith(`${MODULE_HTTP_PREFIX}/`)) return undefined;
  const key = url.slice(MODULE_HTTP_PREFIX.length + 1).split("/", 1)[0];
  return key && keys.has(key) ? key : undefined;
}

function bearerOf(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  return BEARER.exec(header)?.[1] ?? null;
}

export function installV2Authentication(app: FastifyInstance, options: { moduleKeys: ReadonlySet<string> }): void {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    const route = request.routeOptions;
    if (!route?.url) return; // route inconnue (404) : rien à authentifier
    if ((route.config as { public?: unknown } | undefined)?.public === true) return;
    if (!moduleKeyOfRoute(route.url, options.moduleKeys)) return;
    if (!app.hasDecorator("iam")) return; // module iam absent : seule l'authentification legacy existe

    const token = bearerOf(request);
    if (!token || !isIamBearerToken(token)) return;

    const authenticated = unwrap(
      await app.iam.authenticate(token, { requestId: requestIdFrom(request.headers), allowImpersonation: true }),
    );
    request.iamAuth = { principal: authenticated.principal };
    request.ctx = authenticated.principal.ctx;
    request.v2Authenticated = true;
  });
}
