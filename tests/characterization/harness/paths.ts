import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** tests/characterization */
export const characterizationRoot = resolve(here, "..");
/** Racine du dépôt. */
export const repoRoot = resolve(here, "..", "..", "..");
export const legacySqlMigrationsDir = resolve(repoRoot, "infra", "scripts", "migrations");
export const legacyPrismaMigrationsDir = resolve(repoRoot, "apps", "api", "prisma", "migrations");
export const legacyApiSrc = resolve(repoRoot, "apps", "api", "src");
export const snapshotsDir = resolve(characterizationRoot, "snapshots");
export const scenariosDir = resolve(characterizationRoot, "scenarios");
