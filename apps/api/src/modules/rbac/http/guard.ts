/**
 * Garde Fastify `requirePermission(key, { scope? })` — REFUSE PAR DÉFAUT.
 *
 *   app.get("/grades", { preHandler: requirePermission("grade.read") }, handler);
 *   app.post("/grades", { preHandler: requirePermission("grade.enter", { scope: (req) => campusScope(req.params.campusId) }) }, handler);
 *
 * Reçoit le contexte dans `request.ctx` (`RequestContext`, cf.
 * docs/architecture/module-conventions.md), posé en amont par l'authentification.
 * Les droits viennent du plugin `rbac` (décoration `fastify.rbac`), précalculés et
 * mis en cache. Échecs :
 *   - pas de `request.ctx`                 → 401 `UnauthorizedError` ;
 *   - acteur sans utilisateur (system)     → 403 (un job n'a pas de droits RBAC) ;
 *   - permission absente / hors périmètre / hors validité → 403 `ForbiddenError` ;
 *   - permission sensible sans MFA         → 403 `ForbiddenError` code `rbac.mfa_required` ;
 *   - plugin `rbac` non enregistré         → 500 `rbac.not_configured` (refus, mais bruyant).
 *
 * Périmètre (`scope`) :
 *   - omis            : périmètre actif de la requête (campus > établissement), sinon le tenant entier ;
 *   - `ScopeRef`      : ce périmètre précis ;
 *   - `"any"`         : « détenue quelque part » (listes qui filtrent ensuite par `grantedScopes`) ;
 *   - fonction        : calculé depuis la requête (paramètre de route, corps…).
 */
import type { FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import {
  ForbiddenError,
  InternalError,
  PERMISSION_KEY_RE,
  UnauthorizedError,
  type Clock,
  type Logger,
  type RequestContext,
} from "@ecoledigitale/kernel";
import {
  createAuthorizationContext,
  decide,
  type AuthorizationContext,
  type PermissionSet,
} from "../domain/permission-set";
import type { ScopeTarget, ScopeTreeProvider } from "../domain/scope";
import type { PermissionSetCache } from "../application/permission-cache";

/** Ce que le plugin `rbac` publie sur l'instance Fastify (`fastify.rbac`). */
export interface RbacRuntime {
  readonly permissions: { get(ctx: RequestContext): Promise<PermissionSet> };
  readonly scopeTrees: ScopeTreeProvider;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Cache des droits du processus (invalidé par les événements relayés : `subscribeCacheInvalidation`). */
  readonly cache?: PermissionSetCache;
}

export type ScopeSelector =
  | ScopeTarget
  | ((request: FastifyRequest) => ScopeTarget | undefined | Promise<ScopeTarget | undefined>);

export interface RequirePermissionOptions {
  scope?: ScopeSelector;
}

/** `request.ctx` (posé par l'authentification) sans imposer d'augmentation de type globale. */
export function getRequestCtx(request: FastifyRequest): RequestContext | undefined {
  return (request as unknown as { ctx?: RequestContext }).ctx;
}

export function getRuntime(request: FastifyRequest): RbacRuntime {
  const runtime = (request.server as unknown as { rbac?: RbacRuntime }).rbac;
  if (!runtime) {
    throw new InternalError("Le plugin rbac n'est pas enregistré : autorisation impossible.", {
      code: "rbac.not_configured",
    });
  }
  return runtime;
}

const memo = new WeakMap<object, Promise<AuthorizationContext>>();

/**
 * Contexte d'autorisation de la requête (mémorisé : plusieurs gardes sur une même
 * requête ne rechargent pas les droits).
 */
export function loadAuthorization(request: FastifyRequest): Promise<AuthorizationContext> {
  const existing = memo.get(request);
  if (existing) return existing;
  const promise = (async () => {
    const runtime = getRuntime(request);
    const ctx = getRequestCtx(request);
    if (!ctx) throw new UnauthorizedError();
    if (ctx.userId === null) {
      throw new ForbiddenError("Un acteur système n'a pas de droits d'utilisateur.", { code: "rbac.no_user" });
    }
    const [permissionSet, tree] = await Promise.all([
      runtime.permissions.get(ctx),
      runtime.scopeTrees.forTenant(ctx.tenantId),
    ]);
    return createAuthorizationContext({ ctx, permissionSet, now: runtime.clock.now(), tree });
  })();
  memo.set(request, promise);
  // Un échec ne doit pas rester mémorisé pour le reste de la requête.
  promise.catch(() => memo.delete(request));
  return promise;
}

export function requirePermission(permission: string, options: RequirePermissionOptions = {}): preHandlerAsyncHookHandler {
  if (!PERMISSION_KEY_RE.test(permission)) {
    throw new TypeError(`requirePermission : clé de permission invalide "${permission}".`);
  }
  const selector = options.scope;

  return async function rbacGuard(request: FastifyRequest): Promise<void> {
    const auth = await loadAuthorization(request);
    const scope = typeof selector === "function" ? await selector(request) : selector;
    const decision = decide(auth, permission, scope);
    if (decision.allowed) return;

    if (decision.reason === "mfa_required") {
      throw new ForbiddenError("Authentification forte (MFA) requise pour cette action.", {
        code: "rbac.mfa_required",
        details: { permission },
      });
    }
    // La raison fine (hors périmètre / expirée) n'est pas exposée au client ; elle reste dans les logs.
    getRuntime(request).logger.debug(
      { permission, reason: decision.reason, requestId: request.id },
      "rbac : accès refusé",
    );
    throw new ForbiddenError("Action non autorisée.", { details: { permission } });
  };
}
