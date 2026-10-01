/**
 * Chargeur de la liste blanche du test d'isolation : fichier central
 * (`modules/isolation-allowlist.ts`) + un fichier par module
 * (`modules/isolation-allowlist.<module>.ts`), découverts automatiquement.
 * Le format « un fichier par module » évite les conflits de fusion entre équipes.
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CORE_ALLOWLIST, CORE_FIXTURES, type AllowlistEntry } from "../modules/isolation-allowlist";
import { DEFAULT_MODULES_DIR, type FileImporter } from "../modules/registry-discovery";

export const ALLOWLIST_FILE_RE = /^isolation-allowlist\.([a-z][a-z0-9_]*)\.(ts|js)$/;
export const MIN_REASON_LENGTH = 20;
const TABLE_RE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

export class AllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllowlistError";
  }
}

export interface LoadedAllowlist {
  entries: Array<AllowlistEntry & { source: string }>;
  /** `schema.table`, prêt pour `assertTenantIsolation({ allowlist })`. */
  tables: string[];
  fixtures: Record<string, Record<string, unknown>>;
}

const defaultImporter: FileImporter = (absolutePath) => import(pathToFileURL(absolutePath).href);

function unwrapDefault(mod: unknown): unknown {
  let current = mod;
  for (let i = 0; i < 4 && current && typeof current === "object" && !Array.isArray(current) && "default" in current; i += 1) {
    current = (current as { default: unknown }).default;
  }
  return current;
}

/** Valide une liste d'entrées. `schema` : schéma imposé (module), `null` = fichier central. */
export function validateEntries(entries: unknown, source: string, schema: string | null): AllowlistEntry[] {
  if (!Array.isArray(entries)) {
    throw new AllowlistError(`${source} : l'export par défaut doit être un tableau d'entrées { table, reason }.`);
  }
  return entries.map((raw, index) => {
    const where = `${source} [entrée ${index}]`;
    if (!raw || typeof raw !== "object") throw new AllowlistError(`${where} : objet { table, reason } attendu.`);
    const { table, reason } = raw as Partial<AllowlistEntry>;
    if (typeof table !== "string" || !TABLE_RE.test(table)) {
      throw new AllowlistError(`${where} : "table" doit être de la forme schema.table (minuscules).`);
    }
    if (schema !== null && table.split(".")[0] !== schema) {
      throw new AllowlistError(
        `${where} : la table "${table}" n'appartient pas au schéma du module "${schema}" ` +
          `(un module ne peut allowlister que ses propres tables).`,
      );
    }
    if (typeof reason !== "string" || reason.trim().length < MIN_REASON_LENGTH) {
      throw new AllowlistError(
        `${where} : "reason" obligatoire (>= ${MIN_REASON_LENGTH} caractères) : expliquez pourquoi "${table}" n'est pas isolée par tenant.`,
      );
    }
    return { table, reason: reason.trim() };
  });
}

/** Charge la liste centrale et tous les fichiers `isolation-allowlist.<module>.(ts|js)`. */
export async function loadIsolationAllowlist(
  options: { modulesDir?: string; importer?: FileImporter; knownModules?: readonly string[] } = {},
): Promise<LoadedAllowlist> {
  const modulesDir = resolve(options.modulesDir ?? DEFAULT_MODULES_DIR);
  const importer = options.importer ?? defaultImporter;
  const known = options.knownModules ? new Set(options.knownModules) : null;

  const out: LoadedAllowlist = { entries: [], tables: [], fixtures: { ...CORE_FIXTURES } };
  const seen = new Map<string, string>();

  const add = (entries: AllowlistEntry[], source: string): void => {
    for (const entry of entries) {
      const previous = seen.get(entry.table);
      if (previous) {
        throw new AllowlistError(`Table "${entry.table}" déclarée deux fois dans la liste blanche (${previous} et ${source}).`);
      }
      seen.set(entry.table, source);
      out.entries.push({ ...entry, source });
      out.tables.push(entry.table);
    }
  };

  add(validateEntries([...CORE_ALLOWLIST], "isolation-allowlist.ts", null), "isolation-allowlist.ts");

  const files = readdirSync(modulesDir).filter((f) => ALLOWLIST_FILE_RE.test(f)).sort();
  for (const file of files) {
    const moduleKey = (ALLOWLIST_FILE_RE.exec(file) as RegExpExecArray)[1] as string;
    if (known && !known.has(moduleKey)) {
      throw new AllowlistError(`${file} : aucun module "${moduleKey}" n'existe (fichier orphelin).`);
    }
    const loaded = await importer(join(modulesDir, file));
    add(validateEntries(unwrapDefault(loaded), file, moduleKey), file);

    const fixtures = (loaded as { fixtures?: unknown }).fixtures;
    if (fixtures !== undefined) {
      if (!fixtures || typeof fixtures !== "object" || Array.isArray(fixtures)) {
        throw new AllowlistError(`${file} : "fixtures" doit être un objet { "schema.table": { colonne: valeur } }.`);
      }
      for (const [table, values] of Object.entries(fixtures as Record<string, Record<string, unknown>>)) {
        if (table.split(".")[0] !== moduleKey) {
          throw new AllowlistError(`${file} : fixtures pour "${table}" hors du schéma du module "${moduleKey}".`);
        }
        out.fixtures[table] = values;
      }
    }
  }
  return out;
}
