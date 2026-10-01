/**
 * Découverte AUTOMATIQUE des modules v2 (ADR-001, conventions de modules).
 *
 * Tout dossier `modules/<key>/` contenant un `manifest.ts` (ou `manifest.js`) est un
 * module : aucun fichier central n'est à éditer pour en ajouter un. Les manifestes
 * sont chargés, normalisés par `defineModule`, puis validés ensemble par
 * `resolveModuleOrder` (clés uniques, dépendances existantes, pas de cycle,
 * permissions et features uniques) qui fournit l'ordre topologique.
 *
 * Ce fichier ne dépend ni de Fastify ni de pg : il sert aussi aux scripts
 * (migrations, test d'isolation, générateur).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineModule, resolveModuleOrder, type ModuleManifest } from "@ecoledigitale/kernel";

/** Dossier `apps/api/src/modules` (le dossier de ce fichier). */
export const DEFAULT_MODULES_DIR = resolve(__dirname);

/** Préfixe HTTP de tous les modules v2. */
export const MODULE_HTTP_PREFIX = "/api/v1";

const MANIFEST_BASENAMES = ["manifest.ts", "manifest.js"] as const;
const PLUGIN_CANDIDATES = [join("http", "plugin.ts"), join("http", "plugin.js")] as const;

export class ModuleRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleRegistryError";
  }
}

export interface DiscoveredModule {
  key: string;
  /** Dossier du module (absolu). */
  dir: string;
  manifestPath: string;
  manifest: Readonly<ModuleManifest>;
  /** `http/plugin.(ts|js)` si présent. */
  pluginPath: string | null;
  /** `migrations/` si présent (même vide). */
  migrationsDir: string | null;
}

/** Charge un fichier de code et renvoie l'objet module (`import()` en production). */
export type FileImporter = (absolutePath: string) => Promise<unknown>;

export const defaultImporter: FileImporter = (absolutePath) => import(pathToFileURL(absolutePath).href);

export interface DiscoverOptions {
  modulesDir?: string;
  importer?: FileImporter;
}

/** Un dossier est candidat s'il n'est ni caché, ni préfixé par `_` (gabarits, fixtures), ni `node_modules`. */
export function isModuleDirName(name: string): boolean {
  return !name.startsWith(".") && !name.startsWith("_") && name !== "node_modules";
}

/**
 * Récupère le manifeste exporté par défaut, y compris à travers l'interop CJS/ESM
 * (`{ default: { default: manifest } }`).
 */
export function extractManifest(imported: unknown): unknown {
  let current: unknown = imported;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current && typeof current === "object" && "key" in current && "packs" in current) return current;
    if (current && typeof current === "object" && "default" in current) {
      current = (current as { default: unknown }).default;
      continue;
    }
    break;
  }
  return current;
}

function findFirst(dir: string, candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    const full = join(dir, candidate);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}

/** Noms des dossiers candidats, triés (ordre déterministe). */
export function listModuleDirs(modulesDir: string): string[] {
  if (!existsSync(modulesDir)) {
    throw new ModuleRegistryError(`Dossier des modules introuvable : ${modulesDir}.`);
  }
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && isModuleDirName(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Découvre, charge et valide tous les modules. Retourne la liste en ORDRE TOPOLOGIQUE
 * (les dépendances d'abord). Lève `ModuleRegistryError` (ou l'erreur de
 * `resolveModuleOrder`) au moindre défaut : un module mal déclaré ne démarre pas.
 */
export async function discoverModules(options: DiscoverOptions = {}): Promise<DiscoveredModule[]> {
  const modulesDir = resolve(options.modulesDir ?? DEFAULT_MODULES_DIR);
  const importer = options.importer ?? defaultImporter;

  const discovered = new Map<string, DiscoveredModule>();

  for (const name of listModuleDirs(modulesDir)) {
    const dir = join(modulesDir, name);
    const manifestPath = findFirst(dir, MANIFEST_BASENAMES);
    if (!manifestPath) {
      throw new ModuleRegistryError(
        `Le dossier modules/${name}/ n'a pas de manifest.ts : ajoutez-le (pnpm module:new) ou, ` +
          `pour un dossier qui n'est pas un module, préfixez son nom par "_".`,
      );
    }

    let raw: unknown;
    try {
      raw = extractManifest(await importer(manifestPath));
    } catch (e) {
      throw new ModuleRegistryError(
        `Impossible de charger ${manifestPath} : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!raw || typeof raw !== "object") {
      throw new ModuleRegistryError(`${manifestPath} doit exporter par défaut le résultat de defineModule({...}).`);
    }

    let manifest: Readonly<ModuleManifest>;
    try {
      manifest = defineModule(raw as Parameters<typeof defineModule>[0]);
    } catch (e) {
      throw new ModuleRegistryError(`Manifeste invalide (${manifestPath}) : ${e instanceof Error ? e.message : String(e)}`);
    }
    if (manifest.key !== name) {
      throw new ModuleRegistryError(
        `Le manifeste de modules/${name}/ déclare la clé "${manifest.key}" : la clé doit être égale au nom du dossier ` +
          `(c'est aussi le nom du schéma Postgres).`,
      );
    }

    const migrationsPath = join(dir, "migrations");
    discovered.set(name, {
      key: name,
      dir,
      manifestPath,
      manifest,
      pluginPath: findFirst(dir, PLUGIN_CANDIDATES),
      migrationsDir: existsSync(migrationsPath) && statSync(migrationsPath).isDirectory() ? migrationsPath : null,
    });
  }

  // Validation croisée + ordre topologique (lève avec un message explicite).
  const ordered = resolveModuleOrder([...discovered.values()].map((d) => d.manifest as ModuleManifest));
  return ordered.map((m) => discovered.get(m.key) as DiscoveredModule);
}
