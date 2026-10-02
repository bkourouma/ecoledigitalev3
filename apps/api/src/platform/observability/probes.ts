/**
 * Sondes de readiness spécifiques à la plateforme (API et worker) : schémas attendus, stockage d'objets (ADR-009).
 *
 * Ce fichier lit le DISQUE (dossiers `modules/<clé>/migrations`) mais n'importe aucun module : le contrôle des
 * migrations est structurel (voir `migrationsProbe`). Le stockage est résolu paresseusement par `platform/adapters/storage`
 * (mêmes variables `STORAGE_*` que l'API et le worker).
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

/**
 * Sonde du stockage d'objets : interroge l'existence d'une clé sentinelle (S3 : HEAD ; disque : stat). Une clé absente est
 * normale ; seule une erreur d'accès (réseau, droits, bucket inconnu) fait échouer la sonde. Aucun stockage configuré :
 * sonde ignorée.
 */
export function storageProbeFromEnv(env: Readonly<Record<string, string | undefined>>): Probe {
  let storage: { exists(key: string): Promise<boolean> } | null | undefined;
  return storageProbe(async () => {
    if (storage === undefined) {
      const { createObjectStorage } = await import("../adapters/storage");
      storage = createObjectStorage(env);
    }
    if (!storage) return "skipped";
    await storage.exists("healthcheck/sentinel");
  });
}
