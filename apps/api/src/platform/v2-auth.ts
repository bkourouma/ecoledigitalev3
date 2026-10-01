/**
 * Authentification des requêtes par jeton IAM v2, aux côtés du jeton legacy.
 *
 *   Authorization: Bearer <jeton>
 *     ├─ jeton IAM v2 (`typ` d'en-tête `at+jwt` / `imp+jwt`)  -> CE hook (phase `onRequest`) : signature, session,
 *     │     révocation (TOUTES méthodes HTTP), époque, accès et tenant actifs (une requête SQL) ; pose `request.ctx`
 *     │     (mfa lu en base) et `request.iamAuth` ; selon la route :
 *     │       · route de MODULE v2   -> `request.v2Authenticated` : le middleware legacy s'efface ;
 *     │       · route LEGACY         -> `request.iamAuth` seulement : le middleware legacy en tire `request.user`
 *     │                                 (`platform/legacy-iam-bridge.ts`) ; le tenant du jeton, désormais VÉRIFIÉ,
 *     │                                 est celui que lit `tenant-context` (jamais un JWT non vérifié).
 *     └─ jeton legacy (`typ: JWT`)  -> middleware legacy (`plugins/auth-middleware.ts`) puis `v2-context`
 *           (`buildRequestContextFromLegacy`) qui en dérive `request.ctx`. Accepté jusqu'à `LEGACY_TOKEN_SUNSET`.
 *
 * Un jeton IAM invalide (signature, expiré, session révoquée…) :
 *   - route de module : 401 au format d'erreur du module ;
 *   - route legacy    : consigné dans `request.iamAuthFailure`, le middleware legacy répond (les routes publiques du
 *     legacy — login, santé, fichiers — ignorent l'en-tête comme avant) ;
 *   il ne retombe JAMAIS sur le legacy (le type d'en-tête désigne l'émetteur, aucune ambiguïté).
 *
 * Retour arrière : `V2_LEGACY_IAM_BRIDGE=0` -> les routes legacy ignorent les jetons IAM (401 comme avant).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isAppError, unwrap } from "@ecoledigitale/kernel";
import { isIamBearerToken } from "../modules/iam";
import { MODULE_HTTP_PREFIX } from "../modules/registry-discovery";
import { legacyCodeForIamError, legacyIamBridgeEnabled } from "./legacy-iam-bridge";
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

/**
 * Requête faite sous impersonation : consignée pour le journal des super-admins (plugins/super-admin-audit.ts, une
 * ligne par requête) et journalisée au niveau applicatif. L'ouverture de la session a déjà écrit
 * `iam.impersonation.started` dans l'outbox (même transaction que la session : pas d'audit, pas de session).
 */
function noteImpersonation(request: FastifyRequest, principal: { impersonatedBy?: string | undefined; ctx: { tenantId: string }; tenantSlug: string; identityId: string }): void {
  if (!principal.impersonatedBy) return;
  request.iamImpersonation = { superAdminId: principal.impersonatedBy, tenantId: principal.ctx.tenantId, tenantSlug: principal.tenantSlug, impersonatedUserId: null };
  request.log.info(
    { event: "iam_impersonated_request", superAdminId: principal.impersonatedBy, targetIdentityId: principal.identityId, tenantId: principal.ctx.tenantId, method: request.method, url: request.url.split("?")[0] },
    "Requête sous impersonation",
  );
}

export function installV2Authentication(app: FastifyInstance, options: { moduleKeys: ReadonlySet<string>; env?: NodeJS.ProcessEnv }): void {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    const route = request.routeOptions;
    if (!route?.url) return; // route inconnue (404) : rien à authentifier
    if ((route.config as { public?: unknown } | undefined)?.public === true) return;
    if (!app.hasDecorator("iam")) return; // module iam absent : seule l'authentification legacy existe

    const token = bearerOf(request);
    if (!token || !isIamBearerToken(token)) return;

    if (moduleKeyOfRoute(route.url, options.moduleKeys)) {
      const authenticated = unwrap(
        await app.iam.authenticate(token, { requestId: requestIdFrom(request.headers), allowImpersonation: true }),
      );
      request.iamAuth = { principal: authenticated.principal };
      request.ctx = authenticated.principal.ctx;
      request.v2Authenticated = true;
      noteImpersonation(request, authenticated.principal);
      return;
    }

    // Route LEGACY : le jeton IAM est accepté (passerelle), sauf retour arrière explicite (lu à chaque requête).
    if (!legacyIamBridgeEnabled(options.env ?? process.env)) return;
    const result = await app.iam.authenticate(token, { requestId: requestIdFrom(request.headers), allowImpersonation: true });
    if (result.ok) {
      request.iamAuth = { principal: result.value.principal };
      request.ctx = result.value.principal.ctx;
      noteImpersonation(request, result.value.principal);
      return;
    }
    const error = result.error;
    request.iamAuthFailure = {
      status: isAppError(error) ? error.httpStatus : 401,
      code: legacyCodeForIamError(isAppError(error) ? (error.code as string | undefined) : undefined),
      message: "Authentication failed",
    };
  });
}
