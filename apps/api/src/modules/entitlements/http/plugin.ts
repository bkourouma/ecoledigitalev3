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
import {
  toEntitlementsDto,
  toFeatureDto,
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

  app.get("/me/usage", { preHandler: READ }, async (req) =>
    ({ items: unwrap(await getUsage(deps, ctxOf(req), req.query ?? {})).map(toUsageDto) }),
  );

  // ---- Administration plateforme ---------------------------------------------
  app.get("/admin/catalog", { preHandler: ADMIN }, async () => {
    const catalog = unwrap(await getCatalog(deps));
    return { plans: catalog.plans.map(toPlanDto), packs: catalog.packs.map(toPackDto), features: catalog.features.map(toFeatureDto) };
  });

  app.put("/admin/plans/:key", { preHandler: ADMIN }, async (req) => {
    const { key } = unwrap(parseWith(PlanParams, req.params));
    return toPlanDto(unwrap(await upsertPlan(deps, key, req.body)));
  });

  app.put("/admin/plans/:key/features", { preHandler: ADMIN }, async (req) => {
    const { key } = unwrap(parseWith(PlanParams, req.params));
    return toPlanDto(unwrap(await setPlanFeatures(deps, key, req.body)));
  });

  app.get("/admin/tenants/:tenantId/entitlements", { preHandler: ADMIN }, async (req) => {
    const { tenantId } = unwrap(parseWith(TenantParams, req.params));
    // Lecture directe (sans cache) : la console doit voir la vérité courante.
    return toEntitlementsDto(await new PgEntitlementsReader(deps.db, deps.clock).getEntitlements(tenantId));
  });

  app.get("/admin/tenants/:tenantId/subscription", { preHandler: ADMIN }, async (req) => {
    const { tenantId } = unwrap(parseWith(TenantParams, req.params));
    const sub = unwrap(await getSubscription(deps, adminCtx(req, tenantId)));
    return { subscription: sub ? toSubscriptionDto(sub) : null };
  });

  app.put("/admin/tenants/:tenantId/subscription", { preHandler: ADMIN }, async (req) => {
    const { tenantId } = unwrap(parseWith(TenantParams, req.params));
    return toSubscriptionDto(unwrap(await setSubscription(deps, adminCtx(req, tenantId), req.body)));
  });

  app.get("/admin/tenants/:tenantId/overrides", { preHandler: ADMIN }, async (req) => {
    const { tenantId } = unwrap(parseWith(TenantParams, req.params));
    return { items: unwrap(await listFeatureOverrides(deps, adminCtx(req, tenantId))).map(toOverrideDto) };
  });

  app.put("/admin/tenants/:tenantId/overrides/:featureKey", { preHandler: ADMIN }, async (req) => {
    const { tenantId, featureKey } = unwrap(parseWith(OverrideParams, req.params));
    return toOverrideDto(unwrap(await setFeatureOverride(deps, adminCtx(req, tenantId), featureKey, req.body)));
  });

  app.delete("/admin/tenants/:tenantId/overrides/:featureKey", { preHandler: ADMIN }, async (req, reply) => {
    const { tenantId, featureKey } = unwrap(parseWith(OverrideParams, req.params));
    unwrap(await removeFeatureOverride(deps, adminCtx(req, tenantId), featureKey));
    return reply.status(204).send();
  });

  app.get("/admin/tenants/:tenantId/usage", { preHandler: ADMIN }, async (req) => {
    const { tenantId } = unwrap(parseWith(TenantParams, req.params));
    return { items: unwrap(await getUsage(deps, adminCtx(req, tenantId), req.query ?? {})).map(toUsageDto) };
  });
};

/**
 * Plugin du module. Non encapsulé pour la décoration (`app.entitlements`), mais
 * les routes vivent dans un contexte enfant (préfixe + gestionnaire d'erreurs propres).
 */
export const entitlementsPlugin: FastifyPluginAsync<EntitlementsPluginOptions> = async (app, opts) => {
  if (!opts?.db) throw new Error("entitlements: l'option `db` (TenantDb) est obligatoire.");

  const reader =
    opts.reader ??
    new CachedEntitlementsReader(new PgEntitlementsReader(opts.db, opts.clock), {
      ...(opts.cacheTtlMs !== undefined ? { ttlMs: opts.cacheTtlMs } : {}),
      ...(opts.clock ? { clock: opts.clock } : {}),
    });
  const resolveContext = opts.resolveContext ?? defaultContextResolver;

  const service: EntitlementsService = {
    reader,
    resolveContext,
    requireFeature: createRequireFeature(reader, resolveContext),
  };
  const deps: EntitlementsDeps = {
    db: opts.db,
    ...(opts.clock ? { clock: opts.clock } : {}),
    ...(opts.audit ? { audit: opts.audit } : {}),
    ...(opts.logger ? { logger: opts.logger } : {}),
    ...(isInvalidator(reader) ? { cache: reader } : {}),
  };

  app.decorate("entitlements", service);
  await app.register(routes, { ...opts, service, deps, prefix: ENTITLEMENTS_ROUTE_PREFIX } as never);
};

// Fastify : ne pas encapsuler ce plugin, pour que `app.entitlements` soit visible des autres modules.
(entitlementsPlugin as unknown as Record<symbol, unknown>)[Symbol.for("skip-override")] = true;

export default entitlementsPlugin;
