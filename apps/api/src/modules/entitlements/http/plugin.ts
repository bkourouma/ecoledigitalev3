/**
 * Plugin Fastify du module `entitlements`.
 *
 *   await app.register(entitlementsPlugin, {
 *     db,                      // TenantDb (obligatoire)
 *     requirePermission,       // garde du module rbac (sinon app.requirePermission, sinon REFUS)
 *     resolveContext,          // RequestContext de la requête (défaut : request.requestContext)
 *     superAdminAuthorizer,    // PORT : qui est opérateur plateforme (sinon REFUS des routes /admin)
 *   });
 *
 * Le plugin :
 *  - pose le préfixe `/api/v1/entitlements` lui-même (l'appelant n'en ajoute pas) ;
 *  - décore l'instance racine avec `app.entitlements` ({ reader, requireFeature, ... }),
 *    ce qui rend `requireFeature(key)` utilisable depuis n'importe quel autre plugin ;
 *  - routes tenant : lecture des droits et de l'usage (permission `entitlements.read`) ;
 *  - routes `/admin/*` : plans, abonnements, surcharges — réservées au `SuperAdminAuthorizer`
 *    (et, si `adminRequiresPermission`, à la permission sensible `entitlements.manage`).
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { createRequestContext, unwrap, type Clock, type Logger, type RequestContext } from "@ecoledigitale/kernel";
import type { TenantDb } from "@ecoledigitale/database";
import { CatalogKeySchema, FeatureKeySchema } from "@ecoledigitale/contracts/src/v2/entitlements";
import { getCatalog, setPlanFeatures, upsertPlan } from "../application/catalog";
import { listFeatureOverrides, removeFeatureOverride, setFeatureOverride } from "../application/overrides";
import {
  CachedEntitlementsReader,
  PgEntitlementsReader,
  type EntitlementsReader,
} from "../application/reader";
import { getSubscription, setSubscription } from "../application/subscriptions";
import { parseWith, type AuditRecorder, type CacheInvalidator, type EntitlementsDeps } from "../application/support";
import { getUsage } from "../application/usage";
import {
  defaultContextResolver,
  denyAllSuperAdmin,
  installErrorHandler,
  resolvePermissionGuard,
  type ContextResolver,
  type PermissionGuardFactory,
  type SuperAdminAuthorizer,
  type SuperAdminIdentity,
} from "./common";
import { createRequireFeature, type EntitlementsService } from "./require-feature";
import { permissionGuardFactory } from "../../../platform/guards";
import type { ModuleRuntime } from "../../../platform/runtime";
import {
  toEntitlementsDto,
  toFeatureDto,
  toMyFeaturesDto,
  toOverrideDto,
  toPackDto,
  toPlanDto,
  toSubscriptionDto,
  toUsageDto,
} from "./serializers";

export const ENTITLEMENTS_ROUTE_PREFIX = "/api/v1/entitlements";

export interface EntitlementsPluginOptions {
  db: TenantDb;
  clock?: Clock;
  audit?: AuditRecorder;
  logger?: Logger;
  /** Lecteur de droits ; défaut : `CachedEntitlementsReader(PgEntitlementsReader(db))`. */
  reader?: EntitlementsReader;
  /** TTL du cache du lecteur par défaut (ms ; défaut 30 000). */
  cacheTtlMs?: number;
  requirePermission?: PermissionGuardFactory;
  resolveContext?: ContextResolver;
  superAdminAuthorizer?: SuperAdminAuthorizer;
  /** Préfixe des routes. Défaut `/api/v1/entitlements` ; `""` sous le registre de modules (qui applique le préfixe). */
  prefix?: string;
  /** Exige AUSSI `entitlements.manage` sur les routes /admin (défaut : non, le super-admin plateforme n'a pas de rôle de tenant). */
  adminRequiresPermission?: boolean;
}

const isInvalidator = (r: unknown): r is CacheInvalidator =>
  typeof r === "object" && r !== null && "invalidate" in r && "invalidateAll" in r;

const TenantParams = z.object({ tenantId: z.string().uuid("Identifiant de tenant invalide.") });
const PlanParams = z.object({ key: CatalogKeySchema });
const OverrideParams = TenantParams.extend({ featureKey: FeatureKeySchema });

const routes: FastifyPluginAsync<EntitlementsPluginOptions & { service: EntitlementsService; deps: EntitlementsDeps }> = async (
  app: FastifyInstance,
  opts,
) => {
  const { service, deps } = opts;
  const guard = resolvePermissionGuard(app, opts.requirePermission);
  const ctxOf = service.resolveContext;
  const authorizer = opts.superAdminAuthorizer ?? denyAllSuperAdmin;
  installErrorHandler(app);

  const READ = guard("entitlements.read");
  const MANAGE = guard("entitlements.manage");

  // ---- Identité de l'opérateur plateforme -------------------------------------
  const operators = new WeakMap<FastifyRequest, SuperAdminIdentity>();
  const authorizeOperator = async (req: FastifyRequest): Promise<void> => {
    operators.set(req, await authorizer.authorize(req));
  };
  const ADMIN = opts.adminRequiresPermission
    ? [authorizeOperator, MANAGE]
    : [authorizeOperator];
  // Routes d'administration plateforme : authentifiées par le `SuperAdminAuthorizer` (JWT super-admin), PAS par
  // le contexte de tenant ni par l'authentification legacy — d'où `public` (voir platform/runtime.ts) : sans
  // cela, le registre répondait 401 (aucun `request.ctx`) et le middleware legacy 400/401 à tout opérateur.
  const ADMIN_ROUTE = { preHandler: ADMIN, config: { public: true } };

  /** Contexte d'une opération d'administration SUR un tenant : acteur `superAdmin`, RLS sur ce seul tenant. */
  const adminCtx = (req: FastifyRequest, tenantId: string): RequestContext => {
    const operator = operators.get(req);
    if (!operator) throw new Error("entitlements: opérateur non autorisé (garde absente).");
    return createRequestContext({ tenantId, userId: operator.actorId, actor: "superAdmin", requestId: req.id });
  };

  // ---- Routes tenant ----------------------------------------------------------
  app.get("/me", { preHandler: READ }, async (req) =>
    toEntitlementsDto(await service.reader.getEntitlements(ctxOf(req).tenantId)),
  );

  // Fonctionnalités actives : volontairement SANS permission nominative, pour que le web masque ou affiche les
  // entrées de menu conditionnées par une fonctionnalité pour TOUT membre (parent, élève, enseignant…). Authentification
  // de session exigée par `ctxOf` (401 sinon) ; le tenant lu est TOUJOURS celui de la session. Uniquement les clés :
  // ni plan, ni pack, ni quota, ni prix, ni date d'abonnement (`MyFeaturesSchema`).
  app.get("/me/features", async (req) => {
    const entitlements = await service.reader.getEntitlements(ctxOf(req).tenantId);
    return toMyFeaturesDto(entitlements);
  });

  app.get("/me/usage", { preHandler: READ }, async (req) =>
    ({ items: unwrap(await getUsage(deps, ctxOf(req), req.query ?? {})).map(toUsageDto) }),
  );

  // ---- Administration plateforme ---------------------------------------------
  app.get("/admin/catalog", ADMIN_ROUTE, async () => {
    const catalog = unwrap(await getCatalog(deps));
    return { plans: catalog.plans.map(toPlanDto), packs: catalog.packs.map(toPackDto), features: catalog.features.map(toFeatureDto) };
  });

  app.put("/admin/plans/:key", ADMIN_ROUTE, async (req) => {
    const { key } = unwrap(parseWith(PlanParams, req.params));
    return toPlanDto(unwrap(await upsertPlan(deps, key, req.body)));
  });

  app.put("/admin/plans/:key/features", ADMIN_ROUTE, async (req) => {
    const { key } = unwrap(parseWith(PlanParams, req.params));
    return toPlanDto(unwrap(await setPlanFeatures(deps, key, req.body)));
  });

  app.get("/admin/tenants/:tenantId/entitlements", ADMIN_ROUTE, async (req) => {
    const { tenantId } = unwrap(parseWith(TenantParams, req.params));
    // Lecture directe (sans cache) : la console doit voir la vérité courante.
    return toEntitlementsDto(await new PgEntitlementsReader(deps.db, deps.clock).getEntitlements(tenantId));
  });

  app.get("/admin/tenants/:tenantId/subscription", ADMIN_ROUTE, async (req) => {
    const { tenantId } = unwrap(parseWith(TenantParams, req.params));
    const sub = unwrap(await getSubscription(deps, adminCtx(req, tenantId)));
    return { subscription: sub ? toSubscriptionDto(sub) : null };
  });

  app.put("/admin/tenants/:tenantId/subscription", ADMIN_ROUTE, async (req) => {
    const { tenantId } = unwrap(parseWith(TenantParams, req.params));
    return toSubscriptionDto(unwrap(await setSubscription(deps, adminCtx(req, tenantId), req.body)));
  });

  app.get("/admin/tenants/:tenantId/overrides", ADMIN_ROUTE, async (req) => {
    const { tenantId } = unwrap(parseWith(TenantParams, req.params));
    return { items: unwrap(await listFeatureOverrides(deps, adminCtx(req, tenantId))).map(toOverrideDto) };
  });

  app.put("/admin/tenants/:tenantId/overrides/:featureKey", ADMIN_ROUTE, async (req) => {
    const { tenantId, featureKey } = unwrap(parseWith(OverrideParams, req.params));
    return toOverrideDto(unwrap(await setFeatureOverride(deps, adminCtx(req, tenantId), featureKey, req.body)));
  });

  app.delete("/admin/tenants/:tenantId/overrides/:featureKey", ADMIN_ROUTE, async (req, reply) => {
    const { tenantId, featureKey } = unwrap(parseWith(OverrideParams, req.params));
    unwrap(await removeFeatureOverride(deps, adminCtx(req, tenantId), featureKey));
    return reply.status(204).send();
  });

  app.get("/admin/tenants/:tenantId/usage", ADMIN_ROUTE, async (req) => {
    const { tenantId } = unwrap(parseWith(TenantParams, req.params));
    return { items: unwrap(await getUsage(deps, adminCtx(req, tenantId), req.query ?? {})).map(toUsageDto) };
  });
};

/**
 * Plugin du module. Non encapsulé pour la décoration (`app.entitlements`), mais
 * les routes vivent dans un contexte enfant (préfixe + gestionnaire d'erreurs propres).
 */
export const entitlementsPlugin: FastifyPluginAsync<EntitlementsPluginOptions> = async (app, opts) => {
  const service = createEntitlementsService(opts);
  app.decorate("entitlements", service);
  await app.register(routes, {
    ...opts,
    service,
    deps: buildEntitlementsDeps(opts, service),
    prefix: opts.prefix ?? ENTITLEMENTS_ROUTE_PREFIX,
  } as never);
};

/**
 * Construit le service de droits (lecteur mis en cache + garde `requireFeature`). Sépare la CRÉATION de la
 * décoration de l'instance : sous le registre de modules, la décoration se fait à la RACINE (`setup`), car un
 * décorateur posé dans le contexte encapsulé d'un module serait invisible de `finance` & co.
 */
export function createEntitlementsService(opts: EntitlementsPluginOptions): EntitlementsService {
  if (!opts?.db) throw new Error("entitlements: l'option `db` (TenantDb) est obligatoire.");
  const reader =
    opts.reader ??
    new CachedEntitlementsReader(new PgEntitlementsReader(opts.db, opts.clock), {
      ...(opts.cacheTtlMs !== undefined ? { ttlMs: opts.cacheTtlMs } : {}),
      ...(opts.clock ? { clock: opts.clock } : {}),
    });
  const resolveContext = opts.resolveContext ?? defaultContextResolver;
  return {
    reader,
    resolveContext,
    requireFeature: createRequireFeature(reader, resolveContext),
  };
}

/** Dépendances des use cases : le lecteur en cache sert d'invalidateur (invalidation immédiate dans le process). */
export function buildEntitlementsDeps(opts: EntitlementsPluginOptions, service: EntitlementsService): EntitlementsDeps {
  return {
    db: opts.db,
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.audit ? { audit: opts.audit } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(isInvalidator(service.reader) ? { cache: service.reader } : {}),
  };
}

/** Options communes de l'assemblage, dérivées du runtime. */
function optionsFromRuntime(runtime: ModuleRuntime): EntitlementsPluginOptions {
  return {
    db: runtime.tenantDb,
    clock: runtime.clock,
    audit: runtime.auditPort,
    logger: runtime.logger,
    requirePermission: permissionGuardFactory(runtime),
    resolveContext: (request) => runtime.resolveContext(request),
    superAdminAuthorizer: {
      authorize: async (request) => {
        const identity = await runtime.superAdminAuthorizer.authorize(request);
        return { actorId: identity.actorId };
      },
    },
  };
}

/**
 * Assemblage, étape 1 (instance RACINE) : décore `app.entitlements`, lu à la requête par `requireFeature(...)`
 * depuis n'importe quel module. Les routes (étape 2) réutilisent CE service : même lecteur en cache, donc
 * même invalidation.
 */
export function setup(app: FastifyInstance, runtime: ModuleRuntime): void {
  const options = optionsFromRuntime(runtime);
  const service = createEntitlementsService(options);
  app.decorate("entitlements", service);
}

/**
 * Assemblage, étape 2 : routes `/me`, `/admin/*` (le registre applique `/api/v1/entitlements`). Réutilise le
 * service décoré par `setup`.
 */
export default async function entitlementsModulePlugin(app: FastifyInstance, runtime: ModuleRuntime): Promise<void> {
  const options = optionsFromRuntime(runtime);
  const service = (app as unknown as { entitlements?: EntitlementsService }).entitlements;
  if (!service) throw new Error("entitlements : `setup` n'a pas été exécuté (app.entitlements absent).");
  await app.register(routes, {
    ...options,
    service,
    deps: buildEntitlementsDeps(options, service),
    prefix: "",
  } as never);
}

// Fastify : ne pas encapsuler ce plugin, pour que `app.entitlements` soit visible des autres modules.
(entitlementsPlugin as unknown as Record<symbol, unknown>)[Symbol.for("skip-override")] = true;
