/**
 * Sondes de readiness spécifiques à la plateforme (API et worker) : schémas attendus, stockage d'objets (ADR-009).
 *
 * Ce fichier lit le DISQUE (dossiers `modules/<clé>/migrations`) mais n'importe aucun module : le contrôle des
 * migrations est structurel (voir `migrationsProbe`). Le stockage est résolu par `platform/adapters/storage` (mêmes variables
 * `STORAGE_*` que l'API et le worker) ; son chargement, lourd (il tire le module reportcards), démarre en arrière-plan dès la
 * création de la sonde pour ne jamais être payé dans le délai d'une requête `/ready`.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { KERNEL_EXPECTED_TABLES, storageProbe, type ExpectedSchema, type Probe } from "./core/health";

/** `apps/api/src/modules` (ce fichier est dans `apps/api/src/platform/observability`). */
export const DEFAULT_MODULES_DIR = resolve(__dirname, "..", "..", "modules");

/**
 * Schémas que les migrations doivent avoir créés : un schéma par module qui possède des migrations SQL (convention
 * « un module = un schéma du même nom », ADR-006) et les tables du noyau.
 */
export function expectedSchemaFromModules(modulesDir: string = DEFAULT_MODULES_DIR): ExpectedSchema {
  const schemas: string[] = [];
  if (existsSync(modulesDir)) {
    for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_") || entry.name === "node_modules") continue;
      const migrations = join(modulesDir, entry.name, "migrations");
      if (existsSync(migrations) && readdirSync(migrations).some((f) => f.toLowerCase().endsWith(".sql"))) schemas.push(entry.name);
    }
  }
  return { schemas: ["kernel", ...schemas.sort()], tables: [...KERNEL_EXPECTED_TABLES] };
}

interface Existence {
  exists(key: string): Promise<boolean>;
}

/**
 * Sonde du stockage d'objets : interroge l'existence d'une clé sentinelle (S3 : HEAD ; disque : stat). Une clé absente est
 * normale ; seule une erreur d'accès (réseau, droits, bucket inconnu) fait échouer la sonde. Aucun stockage configuré :
 * sonde ignorée.
 */
export function storageProbeFromEnv(env: Readonly<Record<string, string | undefined>>): Probe {
  let storage: Promise<Existence | null> | undefined;
  const load = (): Promise<Existence | null> => {
    storage ??= import("../adapters/storage").then((m) => m.createObjectStorage(env));
    return storage;
  };
  // Précharge en arrière-plan ; une erreur de chargement sera rapportée par la première vérification.
  void load().catch(() => undefined);
  return storageProbe(async () => {
    const s = await load();
    if (!s) return "skipped";
    await s.exists("healthcheck/sentinel");
  });
}
