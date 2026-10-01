/**
 * Point d'entrée UNIQUE de la plateforme v2 pour `src/index.ts` :
 *
 *     await registerV2Platform(fastify, { legacyPool: fastify.pg });
 *
 * - `V2_DATABASE_URL` absent  -> avertissement, AUCUN effet : l'API legacy démarre comme avant,
 *   et les paquets v2 (kernel, database, pg v2) ne sont même pas chargés ;
 * - `V2_DATABASE_URL` présent -> assemblage complet, dans cet ordre :
 *
 *     1. manifestes découverts et validés (clés, dépendances, cycles, doublons) AVANT toute connexion ;
 *     2. pool v2 (rôle refusé s'il est superuser / BYPASSRLS) + `app.v2` + `request.ctx` (plugin v2-context) ;
 *     3. `kernel.tenants` alimentée depuis le legacy (`tenant-sync`) ;
 *     4. runtime des modules (`ModuleRuntime`, voir runtime.ts) + portée `ip/user-agent` de l'audit +
 *        relevé des routes publiques + authentification IAM v2 (hook `onRequest`) ;
 *     5. synchronisation du catalogue : permissions + rôles système (`syncRbac`), features (`syncFeatureCatalog`) ;
 *     6. plugins HTTP des modules, ordre topologique, `/api/v1/<clé>` (`setup` racine puis routes) ;
 *     6b. ADAPTATEURS de ports entre modules (`platform/adapters`) : résultats, bulletins, présences, paie, finance,
 *         enseignement supérieur… sans eux les modules échouent fermé (`*.port_unavailable`) ;
 *     7. invalidation des caches par les événements relayés par le worker (Redis, si `REDIS_URL`) ;
 *     8. RATTRAPAGE idempotent des tenants legacy (profil, établissement, rôles, abonnement — politique
 *        `V2_LEGACY_TENANT_DEFAULT_*`, voir legacy-catchup.ts) et hook de rattrapage à la création d'un tenant.
 *
 * Ce fichier n'importe v2 que dynamiquement pour garder le démarrage legacy indépendant.
 */
import type { FastifyInstance } from "fastify";
import type { LegacyPoolLike, TenantSyncConfig } from "./tenant-sync";
import type { BuildRuntimeOptions } from "./v2-runtime";
import type { CatchUpReport } from "./legacy-catchup";

export interface RegisterV2Options {
  /** Pool legacy (`fastify.pg`) : source de la synchronisation des tenants, liste noire et comptes opérateur. */
  legacyPool?: LegacyPoolLike;
  env?: NodeJS.ProcessEnv;
  modulesDir?: string;
  /** Surcharges d'assemblage (tests) : notifieur de comptes, limiteur, opérateurs, horloge. */
  runtime?: Pick<BuildRuntimeOptions, "accountNotifier" | "rateLimiter" | "superAdminAuthDeps" | "superAdminAuthorizer" | "clock">;
  /** Ignore le rattrapage des tenants legacy (tests ciblés). */
  skipLegacyCatchUp?: boolean;
  /** Ne branche PAS les adaptateurs de ports entre modules (tests d'un module isolé avec ses propres ports). */
  skipAdapters?: boolean;
}

export interface V2PlatformStatus {
  enabled: boolean;
  modules: string[];
  /** Les adaptateurs de ports entre modules sont branchés (`platform/adapters`). */
  adapters?: boolean;
  /** Rapport du rattrapage des tenants legacy (absent s'il a été ignoré). */
  catchUp?: CatchUpReport;
}

export async function registerV2Platform(app: FastifyInstance, options: RegisterV2Options = {}): Promise<V2PlatformStatus> {
  const env = options.env ?? process.env;
  const connectionString = env.V2_DATABASE_URL?.trim();

  if (!connectionString) {
    app.log.warn(
      "V2_DATABASE_URL n'est pas défini : plateforme et modules v2 NON chargés. L'API legacy démarre normalement.",
    );
    return { enabled: false, modules: [] };
  }

  const [
    { discoverModules },
    { registerModules },
    { v2ContextPlugin },
    tenantSync,
    { buildModuleRuntime },
    { installV2Authentication },
    { auditRequestMetaPlugin },
    { syncRbac, subscribeCacheInvalidation },
    { syncFeatureCatalog },
    { buildPlatformDeps },
    catchUp,
    fanout,
    { InMemoryEventBus },
  ] = await Promise.all([
    import("../modules/registry-discovery"),
    import("../modules/registry"),
    import("./v2-context"),
    import("./tenant-sync"),
    import("./v2-runtime"),
    import("./v2-auth"),
    import("../modules/audit"),
    import("../modules/rbac"),
    import("../modules/entitlements"),
    import("../modules/platform"),
    import("./legacy-catchup"),
    import("./event-fanout"),
    import("@ecoledigitale/kernel"),
  ]);

  // 1. Manifestes validés AVANT toute connexion. La politique de rattrapage aussi : une valeur invalide refuse le démarrage.
  const discovered = await discoverModules(options.modulesDir ? { modulesDir: options.modulesDir } : {});
  const manifests = discovered.map((d) => d.manifest);
  const catchUpPolicy = catchUp.readCatchUpPolicy(env);

  // 2. Pool v2 + TenantDb/SystemDb + request.ctx. Lève si le rôle est superuser/BYPASSRLS.
  await app.register(v2ContextPlugin, { connectionString, manifests });

  // 3. kernel.tenants doit exister (migrations v2 appliquées) puis être alimentée depuis le legacy.
  const probe = await app.v2.pool.query("SELECT to_regclass('kernel.tenants') IS NOT NULL AS ok");
  if (probe.rows[0]?.ok !== true) {
    throw new Error("V2_DATABASE_URL : le schéma kernel est absent. Appliquez les migrations avec `pnpm db:v2:migrate`.");
  }
  tenantSync.configureTenantSync({
    systemDb: app.v2.systemDb,
    logger: app.log as unknown as TenantSyncConfig["logger"],
    ...(options.legacyPool ? { legacyPool: options.legacyPool } : {}),
  });
  await tenantSync.syncAllTenantsToKernel();

  // 4. Runtime des modules et authentification.
  const built = await buildModuleRuntime(app, app.v2, {
    env,
    ...(options.runtime ?? {}),
    ...(options.legacyPool ? { legacyPool: options.legacyPool as never } : {}),
  });
  app.decorate("v2Runtime", built.runtime);
  app.addHook("onClose", async () => {
    await built.close();
    await fanout.closeEventFanoutPublisher();
  });
  await app.register(auditRequestMetaPlugin);
  installV2Authentication(app, { moduleKeys: new Set(discovered.map((d) => d.key)) });

  // 5. Catalogues : permissions + rôles système de chaque tenant, puis features. Chaque étape suppose son module
  //    (et ses tables) : un arbre de modules réduit (outillage, tests) ne les exécute pas.
  const has = (key: string): boolean => discovered.some((d) => d.key === key);
  if (has("rbac")) {
    const rbacSync = await syncRbac(app.v2.systemDb, manifests, { logger: app.v2.logger });
    app.log.info({ permissions: rbacSync.catalog.total, reconciled: rbacSync.reconciled, tenantsFailed: rbacSync.tenants.failed.length }, "rbac : catalogue synchronisé");
  }
  if (has("entitlements")) {
    const features = await syncFeatureCatalog({ db: app.v2.tenantDb, systemDb: app.v2.systemDb, logger: app.v2.logger }, manifests);
    if (!features.ok) throw features.error;
  }

  // 6. Plugins HTTP des modules.
  const loaded = await registerModules(app, { enabled: true, discovered, runtime: built.runtime });

  // 6b. Adaptateurs de ports entre modules : les registres de ports sont lus à la requête (ordre indifférent).
  if (!options.skipAdapters) {
    const { wireApiPorts } = await import("./adapters");
    wireApiPorts(app, built.runtime);
  }

  // 7. Caches : invalidation par les événements relayés par le worker (autres instances et worker compris).
  const redisUrl = env.REDIS_URL?.trim();
  if (redisUrl) {
    const bus = new InMemoryEventBus({ errorMode: "isolate", onError: (e) => app.log.warn({ err: String(e) }, "event-fanout : handler en échec") });
    const rbacRuntime = (app as unknown as { rbac?: { cache?: Parameters<typeof subscribeCacheInvalidation>[1] } }).rbac;
    if (rbacRuntime?.cache) subscribeCacheInvalidation(bus, rbacRuntime.cache);
    const reader = (app as unknown as { entitlements?: { reader: { handleEvent?: (e: { type: string; tenantId: string }) => boolean } } }).entitlements?.reader;
    if (reader?.handleEvent) bus.subscribeAll((event) => void reader.handleEvent?.(event));
    const subscription = await fanout.subscribeEventFanout({
      url: redisUrl,
      env,
      onEvent: (event) => bus.publish(event),
      logger: app.log as never,
    });
    app.addHook("onClose", async () => subscription.close());
  }

  // 8. Rattrapage des tenants legacy + hook de création.
  let report: CatchUpReport | undefined;
  const canCatchUp = ["tenancy", "rbac", "entitlements", "platform", "iam"].every(has);
  if (!options.skipLegacyCatchUp && canCatchUp) {
    const deps = buildPlatformDeps(app, built.runtime);
    report = await catchUp.catchUpLegacyTenants(deps, catchUpPolicy, app.log as never);
    tenantSync.configureTenantSync({
      systemDb: app.v2.systemDb,
      logger: app.log as unknown as TenantSyncConfig["logger"],
      ...(options.legacyPool ? { legacyPool: options.legacyPool } : {}),
      afterSync: async (tenantId) => {
        const one = await catchUp.catchUpTenant(deps, tenantId, catchUpPolicy);
        if (one.failed.length > 0) throw new Error(one.failed[0]?.error ?? "rattrapage en échec");
      },
    });
  }

  return { enabled: true, modules: loaded.map((m) => m.key), adapters: !options.skipAdapters, ...(report ? { catchUp: report } : {}) };
}
