import type { TestProject } from "vitest/node";
import { createTemplateDatabase, dropDatabase } from "./db";
import type { MigrationOutcome } from "./migrations";

declare module "vitest" {
  export interface ProvidedContext {
    /** Nom de la base modèle (schéma legacy complet), ou null si aucun Postgres n'est disponible. */
    templateDb: string | null;
    migrationOutcomes: MigrationOutcome[];
  }
}

/**
 * Construit UNE FOIS le schéma legacy dans une base modèle ; chaque fichier de test en reçoit une copie
 * (CREATE DATABASE ... TEMPLATE), ce qui coûte ~100 ms au lieu de rejouer 180 migrations.
 */
export default async function setup(project: TestProject) {
  if (!process.env.TEST_DATABASE_URL) {
    project.provide("templateDb", null);
    project.provide("migrationOutcomes", []);
    return;
  }
  const started = Date.now();
  const { name, outcomes } = await createTemplateDatabase();
  console.log(`[characterization] schéma legacy construit en ${((Date.now() - started) / 1000).toFixed(1)} s (${name})`);
  project.provide("templateDb", name);
  project.provide("migrationOutcomes", outcomes);
  return async () => {
    await dropDatabase(name);
  };
}
