/**
 * Découverte automatique des extensions des modules, SANS fichier central :
 *
 *   <modulesDir>/<key>/subscribers.ts   export default [defineSubscriber({...}), ...]
 *   <modulesDir>/<key>/jobs.ts          export default [defineScheduledJob({...}), ...]
 *
 * Même principe que le registre de modules (`modules/* /manifest.ts`) : ajouter un
 * module = ajouter un dossier. Un export invalide fait ÉCHOUER le démarrage (jamais
 * d'abonné silencieusement absent).
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineScheduledJob, defineSubscriber, type ScheduledJobDefinition, type SubscriberDefinition } from "../sdk";

export interface BundledModule {
  module: string;
  /** Export par défaut de `subscribers.ts` (tableau ou objet unique) ; absent si le fichier n'existe pas. */
  subscribers?: unknown;
  jobs?: unknown;
  /** Le module possède un schéma (dossier `migrations/` avec du SQL) : sa présence est contrôlée par `/ready` (ADR-009). */
  hasSchema?: boolean;
}

export interface DiscoveredExtensions {
  modules: string[];
  /** Modules découverts qui possèdent un schéma Postgres (même nom que la clé du module). */
  schemas: string[];
  subscribers: Array<{ module: string; definition: SubscriberDefinition }>;
  jobs: Array<{ module: string; definition: ScheduledJobDefinition }>;
}

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

const EXTENSIONS = [".ts", ".mts", ".js", ".mjs", ".cjs"];

function findFile(dir: string, base: string): string | null {
  for (const ext of EXTENSIONS) {
    const file = join(dir, `${base}${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

/** `migrations/` contient au moins un fichier SQL. */
export function hasMigrations(moduleDir: string): boolean {
  const dir = join(moduleDir, "migrations");
  return existsSync(dir) && readdirSync(dir).some((f) => f.toLowerCase().endsWith(".sql"));
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.flat() : [value];
}

async function importDefault(file: string, module: string): Promise<unknown> {
  try {
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
    let value = mod.default;
    // Interop CJS/ESM (tsx) : `default` peut encapsuler un second `default`.
    if (value && !Array.isArray(value) && typeof value === "object" && "default" in value) {
      value = (value as { default?: unknown }).default;
    }
    return value;
  } catch (err) {
    throw new DiscoveryError(
      `Module "${module}" : impossible de charger ${file} (${err instanceof Error ? err.message : String(err)}). ` +
        "Hors développement, le worker doit être construit avec `pnpm --filter @ecoledigitale/worker build` (les modules y sont embarqués).",
    );
  }
}

export function normalizeSubscribers(module: string, value: unknown, source: string): SubscriberDefinition[] {
  return asArray(value).map((item, i) => {
    try {
      return defineSubscriber(item as SubscriberDefinition);
    } catch (err) {
      throw new DiscoveryError(`Module "${module}" (${source}) : abonné #${i + 1} invalide — ${(err as Error).message}`);
    }
  });
}

export function normalizeJobs(module: string, value: unknown, source: string): ScheduledJobDefinition[] {
  return asArray(value).map((item, i) => {
    try {
      return defineScheduledJob(item as ScheduledJobDefinition);
    } catch (err) {
      throw new DiscoveryError(`Module "${module}" (${source}) : job #${i + 1} invalide — ${(err as Error).message}`);
    }
  });
}

export interface DiscoverOptions {
  /** Dossiers contenant un sous-dossier par module. Les dossiers inexistants sont ignorés. */
  dirs: readonly string[];
  /** Fourni par le bundle de production : remplace le scan du disque. */
  bundled?: readonly BundledModule[] | undefined;
}

export async function discoverModuleExtensions(options: DiscoverOptions): Promise<DiscoveredExtensions> {
  const out: DiscoveredExtensions = { modules: [], schemas: [], subscribers: [], jobs: [] };

  if (options.bundled) {
    for (const m of options.bundled) {
      out.modules.push(m.module);
      if (m.hasSchema) out.schemas.push(m.module);
      for (const definition of normalizeSubscribers(m.module, m.subscribers, "bundle")) out.subscribers.push({ module: m.module, definition });
      for (const definition of normalizeJobs(m.module, m.jobs, "bundle")) out.jobs.push({ module: m.module, definition });
    }
    return out;
  }

  for (const dir of options.dirs) {
    const root = resolve(dir);
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    for (const entry of readdirSync(root).sort()) {
      const moduleDir = join(root, entry);
      if (!statSync(moduleDir).isDirectory()) continue;
      const subscribersFile = findFile(moduleDir, "subscribers");
      const jobsFile = findFile(moduleDir, "jobs");
      if (!subscribersFile && !jobsFile) continue;
      out.modules.push(entry);
      if (hasMigrations(moduleDir)) out.schemas.push(entry);
      if (subscribersFile) {
        const value = await importDefault(subscribersFile, entry);
        for (const definition of normalizeSubscribers(entry, value, subscribersFile)) out.subscribers.push({ module: entry, definition });
      }
      if (jobsFile) {
        const value = await importDefault(jobsFile, entry);
        for (const definition of normalizeJobs(entry, value, jobsFile)) out.jobs.push({ module: entry, definition });
      }
    }
  }
  return out;
}

/** Dossiers de modules par défaut : `apps/api/src/modules` (conventions) et `modules/` à la racine (plan §3). */
export function defaultModuleDirs(workerRoot: string): string[] {
  const repoRoot = resolve(workerRoot, "..", "..");
  return [join(repoRoot, "apps", "api", "src", "modules"), join(repoRoot, "modules")];
}
