/**
 * Point d'entrée UNIQUE de la plateforme v2 pour `src/index.ts` :
 *
 *     await registerV2Platform(fastify, { legacyPool: fastify.pg });
 *
 * - `V2_DATABASE_URL` absent  -> avertissement, AUCUN effet : l'API legacy démarre comme avant,
 *   et les paquets v2 (kernel, database, pg v2) ne sont même pas chargés ;
 * - `V2_DATABASE_URL` présent -> découverte et validation des manifestes, pool v2 (rôle
 *   refusé s'il est superuser / BYPASSRLS), `app.v2` + `request.ctx`, synchronisation
 *   `public.tenants` -> `kernel.tenants`, chargement des plugins de modules.
 *
 * Ce fichier n'importe v2 que dynamiquement pour garder le démarrage legacy indépendant.
 */
import type { FastifyInstance } from "fastify";
import type { LegacyPoolLike, TenantSyncConfig } from "./tenant-sync";

export interface RegisterV2Options {
  /** Pool legacy (`fastify.pg`) : source de la synchronisation des tenants. */
  legacyPool?: LegacyPoolLike;
  env?: NodeJS.ProcessEnv;
  modulesDir?: string;
}

export interface V2PlatformStatus {
  enabled: boolean;
  modules: string[];
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

  const [{ discoverModules }, { registerModules }, { v2ContextPlugin }, tenantSync] = await Promise.all([
    import("../modules/registry-discovery"),
    import("../modules/registry"),
    import("./v2-context"),
    import("./tenant-sync"),
  ]);

  // 1. Manifestes validés (clés, dépendances, cycles, doublons) AVANT toute connexion.
  const discovered = await discoverModules(options.modulesDir ? { modulesDir: options.modulesDir } : {});

  // 2. Pool v2 + TenantDb/SystemDb + request.ctx. Lève si le rôle est superuser/BYPASSRLS.
  await app.register(v2ContextPlugin, {
    connectionString,
    manifests: discovered.map((d) => d.manifest),
  });

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

  // 4. Plugins HTTP des modules, ordre topologique, /api/v1/<key>.
  const loaded = await registerModules(app, { enabled: true, discovered });
  return { enabled: true, modules: loaded.map((m) => m.key) };
}
