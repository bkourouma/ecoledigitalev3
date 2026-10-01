/**
 * Aides de test : arborescences de modules factices, Postgres éphémère.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe } from "vitest";
import { Client } from "pg";
import type { FileImporter } from "../../src/modules/registry-discovery";

// ---------------------------------------------------------------------------
// Modules factices
// ---------------------------------------------------------------------------

export interface FakeModuleSpec {
  /** Objet passé à defineModule (clé par défaut = nom du dossier). */
  manifest?: Record<string, unknown> | null;
  /** Crée http/plugin.ts ; la valeur est le plugin renvoyé par l'importer factice. */
  plugin?: ((app: any, opts: any) => Promise<void> | void) | boolean;
  /** Crée migrations/ avec ces fichiers (nom -> contenu SQL). */
  migrations?: Record<string, string>;
}

export interface FakeModules {
  dir: string;
  importer: FileImporter;
  /** Écrit un fichier factice (chemin relatif à `dir`) dont l'« import » renverra `content`. */
  register(relativePath: string, content: unknown): void;
  cleanup(): void;
}

/**
 * Écrit des fichiers vides aux emplacements d'un vrai module et fournit un `importer` qui
 * « charge » les manifestes/plugins depuis les specs : on teste la logique du registre sans
 * dépendre de la résolution TypeScript du runner de tests.
 */
export function makeFakeModules(specs: Record<string, FakeModuleSpec>): FakeModules {
  const dir = mkdtempSync(join(tmpdir(), "ed-modules-"));
  const byPath = new Map<string, unknown>();

  for (const [key, spec] of Object.entries(specs)) {
    const moduleDir = join(dir, key);
    mkdirSync(moduleDir, { recursive: true });

    if (spec.manifest !== null) {
      const manifestPath = join(moduleDir, "manifest.ts");
      writeFileSync(manifestPath, "// fake\n");
      byPath.set(manifestPath, { default: { key, title: key, packs: ["CORE"], ...(spec.manifest ?? {}) } });
    }
    if (spec.plugin) {
      const pluginPath = join(moduleDir, "http", "plugin.ts");
      mkdirSync(dirname(pluginPath), { recursive: true });
      writeFileSync(pluginPath, "// fake\n");
      byPath.set(pluginPath, { default: typeof spec.plugin === "function" ? spec.plugin : async () => undefined });
    }
    if (spec.migrations) {
      const migrationsDir = join(moduleDir, "migrations");
      mkdirSync(migrationsDir, { recursive: true });
      for (const [name, sql] of Object.entries(spec.migrations)) writeFileSync(join(migrationsDir, name), sql);
    }
  }

  const importer: FileImporter = async (path) => {
    if (!byPath.has(path)) throw new Error(`importer factice : ${path} inconnu`);
    return byPath.get(path);
  };
  return {
    dir,
    importer,
    register(relativePath, content) {
      const full = join(dir, relativePath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, "// fake\n");
      byPath.set(full, content);
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function makeTmpDir(prefix = "ed-tmp-"): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// Postgres éphémère (TEST_DATABASE_URL)
// ---------------------------------------------------------------------------

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);

if (!hasDb) {
  console.warn(
    "[api/v2] TEST_DATABASE_URL absente : les tests d'intégration sont IGNORÉS. " +
      "Lancez `pnpm test:isolation` (Postgres jetable dans Docker) ou définissez TEST_DATABASE_URL vers une instance JETABLE.",
  );
}

export const describeIntegration: typeof describe = describe.skipIf(!hasDb) as unknown as typeof describe;

export const randomSuffix = (): string => randomBytes(4).toString("hex");

export function urlForDatabase(database: string, user?: string, password?: string): string {
  const u = new URL(TEST_DATABASE_URL as string);
  u.pathname = `/${database}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export interface EphemeralDb {
  name: string;
  /** URL d'administration (TEST_DATABASE_URL, sur cette base). */
  adminUrl: string;
  admin: Client;
  drop(): Promise<void>;
}

/** Crée une base vide `ed_api_<aléa>_<suffix>` ; `drop()` la supprime (et les rôles listés). */
export async function createEphemeralDb(suffix = "test", roles: string[] = []): Promise<EphemeralDb> {
  const name = `ed_api_${randomSuffix()}_${suffix}`;
  const maintenance = new Client({ connectionString: TEST_DATABASE_URL });
  await maintenance.connect();
  await maintenance.query(`CREATE DATABASE "${name}"`);
  const adminUrl = urlForDatabase(name);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  return {
    name,
    adminUrl,
    admin,
    async drop() {
      await admin.end().catch(() => undefined);
      try {
        await maintenance.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        for (const role of roles) await maintenance.query(`DROP ROLE IF EXISTS "${role}"`);
      } finally {
        await maintenance.end().catch(() => undefined);
      }
    },
  };
}
