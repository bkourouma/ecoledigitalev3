import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveModuleOrder } from "@ecoledigitale/kernel";
import { discoverModules } from "../src/modules/registry-discovery";
import { planMigrationSteps } from "../src/platform/v2-migrations";
import { ScaffoldError, renderModuleFiles, scaffoldModule, validateModuleKey } from "../src/platform/module-scaffold";

const here = dirname(fileURLToPath(import.meta.url));
// Dossier TEMPORAIRE dans l'arbre du dépôt (pour résoudre @ecoledigitale/*), jamais dans src/modules.
const sandbox = resolve(here, `.tmp-scaffold-${process.pid}`);
mkdirSync(sandbox, { recursive: true });
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

describe("validation de la clé", () => {
  it("accepte une clé minuscule snake_case", () => {
    for (const key of ["finance", "tenancy", "report_cards", "m2"]) expect(() => validateModuleKey(key)).not.toThrow();
  });

  it("refuse les clés invalides ou réservées", () => {
    for (const key of ["", "A", "1abc", "a-b", "a b", "x", "kernel", "public", "pg_catalog", "information_schema", "../evil", "a".repeat(31)]) {
      expect(() => validateModuleKey(key), key).toThrow(ScaffoldError);
    }
  });
});

describe("squelette de module", () => {
  it("génère tous les fichiers exigés par les conventions", () => {
    const files = Object.keys(renderModuleFiles("demo")).sort();
    expect(files).toEqual([
      "application/items.ts",
      "domain/item.ts",
      "http/plugin.ts",
      "index.ts",
      "infrastructure/item-repository.ts",
      "manifest.ts",
      "migrations/0001_init.sql",
      "test/demo.test.ts",
    ]);
  });

  it("la migration suit la convention : schéma, tenant_id -> kernel.tenants, RLS, droits app_user", () => {
    const sql = renderModuleFiles("demo")["migrations/0001_init.sql"] as string;
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS demo;/);
    expect(sql).toMatch(/tenant_id\s+uuid NOT NULL REFERENCES kernel\.tenants\(id\)/);
    expect(sql).toMatch(/SELECT kernel\.enable_tenant_rls\('demo\.items'\);/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON demo\.items TO app_user;/);
    expect(sql).not.toMatch(/BEGIN|COMMIT/i);
    // enable_tenant_rls vient après la création de la table, les droits après la RLS
    expect(sql.indexOf("CREATE TABLE")).toBeLessThan(sql.indexOf("SELECT kernel.enable_tenant_rls"));
    expect(sql.indexOf("SELECT kernel.enable_tenant_rls")).toBeLessThan(sql.indexOf("GRANT SELECT"));
  });

  it("n'écrit rien d'interdit : pas de pool direct, pas de new Date(), pas d'import legacy", () => {
    for (const [path, content] of Object.entries(renderModuleFiles("demo"))) {
      if (!path.endsWith(".ts")) continue;
      expect(content, path).not.toMatch(/from "pg"/);
      expect(content, path).not.toMatch(/new Date\(\)|Date\.now\(\)/);
      expect(content, path).not.toMatch(/\/(routes|services|middlewares?|plugins)\//);
    }
  });

  it("écrit le module, le fait découvrir par le registre et ses migrations par le plan", async () => {
    const result = scaffoldModule({ key: "gen_demo", modulesDir: sandbox });
    expect(result.files).toContain("manifest.ts");
    expect(existsSync(join(sandbox, "gen_demo", "migrations", "0001_init.sql"))).toBe(true);

    // Import RÉEL (importer par défaut) : le manifeste généré est valide.
    const found = await discoverModules({ modulesDir: sandbox });
    expect(found.map((m) => m.key)).toEqual(["gen_demo"]);
    expect(found[0]?.pluginPath).toMatch(/plugin\.ts$/);
    expect(found[0]?.manifest.permissions.every((p) => p.key.startsWith("gen_demo."))).toBe(true);
    expect(() => resolveModuleOrder(found.map((m) => m.manifest))).not.toThrow();

    expect(planMigrationSteps(found, undefined, null).map((s) => s.id)).toEqual(["baseline", "gen_demo"]);
  });

  it("le domaine généré se comporte comme annoncé", async () => {
    scaffoldModule({ key: "gen_logic", modulesDir: sandbox });
    const domain = await import(/* @vite-ignore */ join(sandbox, "gen_logic", "domain", "item.ts"));
    expect(domain.normalizeLabel("  Un   libellé ")).toEqual({ ok: true, value: "Un libellé" });
    expect(domain.normalizeLabel("").ok).toBe(false);
  });

  it("refuse d'écraser un module existant et n'écrit alors rien de plus", () => {
    scaffoldModule({ key: "gen_once", modulesDir: sandbox });
    const manifest = join(sandbox, "gen_once", "manifest.ts");
    const before = readFileSync(manifest, "utf8");
    expect(() => scaffoldModule({ key: "gen_once", modulesDir: sandbox })).toThrow(/existe déjà/);
    expect(readFileSync(manifest, "utf8")).toBe(before);
  });
});
