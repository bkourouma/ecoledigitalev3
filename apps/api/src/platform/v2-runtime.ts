/**
 * Construction du `ModuleRuntime` (voir `runtime.ts`) : tout ce que les `http/plugin.ts` des modules reçoivent.
 *
 * Ports fournis :
 *   tenantDb, systemDb, clock, logger, manifests   <- `app.v2` (plugin v2-context)
 *   requirePermission                              <- module rbac (résout `fastify.rbac` à la requête)
 *   auditPort                                      <- module audit (`audit.record` / `audit.recordPlatform`)
 *   entitlements                                   <- module entitlements (façade : `app.entitlements` est
 *                                                     posé par le `setup` du module, après la construction)
 *   resolveContext                                 <- `request.ctx` (IAM v2 ou dérivé du legacy)
 *   rateLimiter                                    <- Redis si `REDIS_URL`, sinon mémoire
 *   superAdminAuthorizer                           <- JWT super-admin legacy (platform/super-admin-authorizer.ts)
 *   accountNotifier                                <- SMTP si configuré, sinon journalisation sans jeton
 *   scopeTrees                                     <- module tenancy (hiérarchie établissements -> campus)
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ForbiddenError, UnauthorizedError, systemClock, type Clock, type RequestContext } from "@ecoledigitale/kernel";
import { audit, configureAuditFromEnv } from "../modules/audit";
import { requireFeature as entitlementsRequireFeature, type EntitlementsService } from "../modules/entitlements";
import { MemoryRateLimiter, RedisRateLimiter } from "../modules/iam";
import { requirePermission as rbacRequirePermission, type RequirePermissionOptions } from "../modules/rbac";
import { createTenancyScopeTreeProvider } from "../modules/tenancy";
import { accountNotifierFromEnv } from "./account-notifier";
import type {
  AccountNotifier,
  ModuleRuntime,
  RateLimiter,
  RuntimeAuditPort,
  RuntimeEntitlements,
  SuperAdminAuthorizer,
} from "./runtime";
import { createSuperAdminAuthorizer, legacySuperAdminAuthDeps, type LegacyQueryPool, type SuperAdminAuthDeps } from "./super-admin-authorizer";
import type { V2Services } from "./v2-context";

export interface BuildRuntimeOptions {
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;
  clock?: Clock;
  /** Surcharges (tests, câblage particulier). */
  rateLimiter?: RateLimiter;
  accountNotifier?: AccountNotifier;
  superAdminAuthorizer?: SuperAdminAuthorizer;
  /** Dépendances de l'autorisateur super-admin (tests) ; sinon branchées sur le legacy via `legacyPool`. */
  superAdminAuthDeps?: SuperAdminAuthDeps;
  /** Pool legacy (`fastify.pg`) : liste noire des jetons et comptes opérateur. */
  legacyPool?: LegacyQueryPool;
}

export interface BuiltRuntime {
  runtime: ModuleRuntime;
  /** Ferme les connexions ouvertes par le runtime (Redis du limiteur). */
  close(): Promise<void>;
}

const denyAllOperators: SuperAdminAuthorizer = {
  async authorize() {
    throw new ForbiddenError(
      "Administration plateforme indisponible : aucun autorisateur d'opérateur n'est configuré (pool legacy absent).",
      { code: "platform.operator_authorizer_missing" },
    );
  },
};

function entitlementsFacade(app: FastifyInstance): RuntimeEntitlements {
  const service = (): EntitlementsService => {
    const s = (app as unknown as { entitlements?: EntitlementsService }).entitlements;
    if (!s) throw new Error("entitlements : le module n'est pas chargé (app.entitlements absent).");
    return s;
  };
  return {
    reader: {
      getEntitlements: (tenantId) => service().reader.getEntitlements(tenantId),
      hasFeature: (tenantId, featureKey) => service().reader.hasFeature(tenantId, featureKey),
    },
    requireFeature: (featureKey) => entitlementsRequireFeature(featureKey) as unknown as ReturnType<RuntimeEntitlements["requireFeature"]>,
    isFeatureEnabled: (ctx, featureKey) => service().reader.hasFeature(ctx.tenantId, featureKey),
  };
}

export async function buildModuleRuntime(app: FastifyInstance, services: V2Services, options: BuildRuntimeOptions): Promise<BuiltRuntime> {
  const { env, logger } = { env: options.env, logger: services.logger };
  const clock = options.clock ?? systemClock;
  const closers: Array<() => Promise<void>> = [];

  // --- audit : le même HMAC dans l'API et dans le worker ---------------------------------------------------
  configureAuditFromEnv(audit, env, { logger, clock });
  const auditPort: RuntimeAuditPort = {
    record: (tx, entry) => audit.record(tx, entry as Parameters<typeof audit.record>[1]),
    recordPlatform: (tx, entry) => audit.recordPlatform(tx, entry as Parameters<typeof audit.recordPlatform>[1]),
  };

  // --- limiteur de débit -----------------------------------------------------------------------------------
  let rateLimiter = options.rateLimiter;
  if (!rateLimiter) {
    const redisUrl = env.REDIS_URL?.trim();
    if (redisUrl) {
      const { Redis } = await import("ioredis");
      const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true });
      redis.on("error", (err) => logger.warn({ err: err.message }, "rate limiter : erreur Redis"));
      closers.push(async () => {
        await redis.quit().catch(() => redis.disconnect());
      });
      // Préfixe partagé avec le worker (`WORKER_QUEUE_PREFIX`) : plusieurs environnements peuvent partager un Redis.
      rateLimiter = new RedisRateLimiter(redis, { clock, logger, prefix: `${env.WORKER_QUEUE_PREFIX?.trim() || "ed"}:iam:rl:` });
      logger.info({ rateLimiter: "redis" }, "iam : limiteur de débit Redis");
    } else {
      rateLimiter = new MemoryRateLimiter(clock);
      logger.warn(
        { rateLimiter: "memory" },
        "REDIS_URL absent : limiteur de débit EN MÉMOIRE (valable pour une seule instance de l'API ; définissez REDIS_URL en production).",
      );
    }
  }

  // --- opérateurs plateforme -------------------------------------------------------------------------------
  let superAdminAuthorizer = options.superAdminAuthorizer;
  if (!superAdminAuthorizer) {
    if (options.superAdminAuthDeps) superAdminAuthorizer = createSuperAdminAuthorizer(options.superAdminAuthDeps);
    else if (options.legacyPool) superAdminAuthorizer = createSuperAdminAuthorizer(await legacySuperAdminAuthDeps(options.legacyPool));
    else {
      superAdminAuthorizer = denyAllOperators;
      logger.warn({}, "Aucun pool legacy : console plateforme et impersonation REFUSÉES (échec fermé).");
    }
  }

  const accountNotifier = options.accountNotifier ?? (await accountNotifierFromEnv(env, logger));

  const runtime: ModuleRuntime = Object.freeze({
    tenantDb: services.tenantDb,
    systemDb: services.systemDb,
    clock,
    logger,
    manifests: services.manifests,
    env,
    requirePermission: (permission: string, opts?: { scope?: unknown }) => rbacRequirePermission(permission, opts as RequirePermissionOptions),
    auditPort,
    entitlements: entitlementsFacade(app),
    scopeTrees: createTenancyScopeTreeProvider(services.tenantDb, { clock }),
    resolveContext: (request: FastifyRequest): RequestContext => {
      if (!request.ctx) throw new UnauthorizedError("Authentification requise.");
      return request.ctx;
    },
    rateLimiter,
    superAdminAuthorizer,
    accountNotifier,
  });

  return {
    runtime,
    async close() {
      await Promise.allSettled(closers.map((c) => c()));
    },
  };
}
