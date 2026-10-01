/**
 * Registre des modules v2.
 *
 *  1. découvre `modules/*\/manifest.(ts|js)` (aucun fichier central à éditer) ;
 *  2. valide l'ensemble par `resolveModuleOrder` (clés, dépendances, cycles, doublons) ;
 *  3. charge `modules/<key>/http/plugin.ts` dans l'ordre topologique, sous `/api/v1/<key>`, avec le contrat
 *     uniforme `setup?(app, runtime)` (racine) puis `default(app, runtime)` (contexte encapsulé, routes sans
 *     préfixe) — voir `platform/runtime.ts` ;
 *  4. expose `getLoadedManifests()` aux modules rbac / entitlements / navigation.
 *
 * Les modules v2 ne se chargent que si `V2_DATABASE_URL` est défini : sinon un avertissement
 * est journalisé et l'API legacy démarre normalement (voir `platform/v2-bootstrap.ts`).
 *
 * Chaque plugin de module est enregistré dans un contexte Fastify ENCAPSULÉ qui ajoute :
 *  - un gestionnaire d'erreurs au format kernel (`toErrorBody`) — il ne s'applique qu'au module ;
 *  - la garde « contexte présent » (401 sinon, sauf route `config: { public: true }`).
 * Les routes legacy ne sont donc pas affectées.
 */
import type { FastifyInstance } from "fastify";
import type { Logger, ModuleManifest } from "@ecoledigitale/kernel";
import { trackPublicRoutes } from "../platform/public-routes";
import type { ModulePlugin, ModuleRuntime, ModuleSetup } from "../platform/runtime";
import { requireContextHook, v2ErrorHandler } from "../platform/v2-http";
import {
  MODULE_HTTP_PREFIX,
  ModuleRegistryError,
  defaultImporter,
  discoverModules,
  type DiscoveredModule,
  type FileImporter,
} from "./registry-discovery";

export { discoverModules, ModuleRegistryError, MODULE_HTTP_PREFIX } from "./registry-discovery";
export type { DiscoveredModule, FileImporter } from "./registry-discovery";

export interface LoadedModule {
  key: string;
  manifest: Readonly<ModuleManifest>;
  /** `/api/v1/<key>` */
  prefix: string;
  /** `false` si le module n'a pas de `http/plugin.ts` (module purement applicatif). */
  hasPlugin: boolean;
  dir: string;
}

export interface RegisterModulesOptions {
  /** Défaut : `Boolean(process.env.V2_DATABASE_URL)`. */
  enabled?: boolean;
  /** Modules déjà découverts (évite de relire le disque) ; sinon découverte dans `modulesDir`. */
  discovered?: readonly DiscoveredModule[];
  modulesDir?: string;
  /** Charge manifestes ET plugins (tests : modules factices sans fichier réel). */
  importer?: FileImporter;
  logger?: Pick<Logger, "info" | "warn" | "error">;
  /** Runtime passé à chaque `http/plugin.ts` ; défaut : `app.v2Runtime` (posé par `registerV2Platform`). */
  runtime?: ModuleRuntime;
}

let loaded: readonly LoadedModule[] = [];

/** Manifestes des modules chargés, en ordre topologique. Vide tant que `registerModules` n'a pas tourné. */
export function getLoadedManifests(): readonly Readonly<ModuleManifest>[] {
  return loaded.map((m) => m.manifest);
}

export function getLoadedModules(): readonly LoadedModule[] {
  return loaded;
}

/** Réinitialise l'état global (tests). */
export function resetRegistryForTests(): void {
  loaded = [];
}

export function isV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.V2_DATABASE_URL?.trim());
}

function extractPlugin(imported: unknown): ModulePlugin {
  let current: unknown = imported;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    current = (current as { default?: unknown }).default;
  }
  if (typeof current !== "function") {
    throw new ModuleRegistryError("http/plugin doit exporter par défaut un plugin Fastify (fonction).");
  }
  return current as ModulePlugin;
}

/**
 * `export function setup(app, runtime)` facultatif de `http/plugin.ts` : décorations de l'instance RACINE
 * (`app.rbac`, `app.entitlements`, `app.iam`). Cherché sur le module importé et, pour l'interop CJS/ESM, sur son
 * `default` imbriqué.
 */
function extractSetup(imported: unknown): ModuleSetup | undefined {
  let current: unknown = imported;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = (current as { setup?: unknown }).setup;
    if (typeof candidate === "function") return candidate as ModuleSetup;
    current = (current as { default?: unknown }).default;
  }
  return undefined;
}

/**
 * Enregistre les plugins HTTP de tous les modules. `app.v2` (plugin `v2-context`) doit être
 * déjà enregistré. Retourne les modules chargés (ordre topologique).
 */
export async function registerModules(
  app: FastifyInstance,
  options: RegisterModulesOptions = {},
): Promise<readonly LoadedModule[]> {
  const logger = options.logger ?? (app.log as unknown as Pick<Logger, "info" | "warn" | "error">);
  const enabled = options.enabled ?? isV2Enabled();

  if (!enabled) {
    loaded = [];
    logger.warn(
      { v2: "disabled" },
      "V2_DATABASE_URL n'est pas défini : les modules v2 ne sont PAS chargés (l'API legacy démarre normalement).",
    );
    return loaded;
  }
  if (!app.hasDecorator("v2")) {
    throw new ModuleRegistryError("registerModules : enregistrez d'abord le plugin v2-context (app.v2 absent).");
  }

  const importer = options.importer ?? defaultImporter;
  const discovered =
    options.discovered ??
    (await discoverModules({
      importer,
      ...(options.modulesDir ? { modulesDir: options.modulesDir } : {}),
    }));

  // Contrat uniforme : chaque `http/plugin.ts` reçoit `(app, runtime)`. Le runtime est fourni explicitement ou
  // décoré par la plateforme (`app.v2Runtime`) ; les modules d'assemblage le valident eux-mêmes.
  const runtime = (options.runtime ?? (app.hasDecorator("v2Runtime") ? app.v2Runtime : undefined)) as ModuleRuntime;

  // Les routes `config.public` sont relevées pour le middleware legacy (voir platform/public-routes.ts).
  trackPublicRoutes(app);

  const result: LoadedModule[] = [];
  for (const mod of discovered) {
    const prefix = `${MODULE_HTTP_PREFIX}/${mod.key}`;

    if (mod.pluginPath) {
      let plugin: ModulePlugin;
      let setup: ModuleSetup | undefined;
      try {
        const imported = await importer(mod.pluginPath);
        plugin = extractPlugin(imported);
        setup = extractSetup(imported);
      } catch (e) {
        throw new ModuleRegistryError(
          `Module "${mod.key}" : chargement de ${mod.pluginPath} impossible : ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      // Étape 1 — instance RACINE : décorations partagées entre modules (visibles de tous les contextes).
      if (setup) await setup(app, runtime);

      // Étape 2 — contexte encapsulé par module : préfixe, erreurs, garde de contexte. Le plugin déclare ses
      // routes SANS préfixe : le registre est le seul à appliquer `/api/v1/<key>` (plus de double préfixe).
      await app.register(
        async (scope) => {
          scope.setErrorHandler(v2ErrorHandler);
          scope.addHook("preHandler", requireContextHook);
          await plugin(scope, runtime);
        },
        { prefix },
      );
    }

    result.push({ key: mod.key, manifest: mod.manifest, prefix, hasPlugin: mod.pluginPath !== null, dir: mod.dir });
    logger.info(
      { module: mod.key, prefix, packs: mod.manifest.packs, plugin: mod.pluginPath !== null },
      `Module v2 chargé : ${mod.key}`,
    );
  }

  loaded = Object.freeze(result);
  logger.info({ count: loaded.length, modules: loaded.map((m) => m.key) }, `${loaded.length} module(s) v2 chargé(s)`);
  return loaded;
}
