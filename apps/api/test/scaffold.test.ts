import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveModuleOrder } from "@ecoledigitale/kernel";
import { discoverModuleExtensions } from "../../worker/src/discovery/discover";
import { discoverModules } from "../src/modules/registry-discovery";
import { loadIsolationAllowlist } from "../src/platform/isolation-allowlist-loader";
import {
  DEFAULT_CONVENTIONS_PATH,
  ScaffoldError,
  addRangeRow,
  nextFreeRangeStart,
  parseModuleNewArgs,
  parseRangeTable,
  renderModuleFiles,
  renderModulesRootFiles,
  scaffoldModule,
  validateModuleKey,
} from "../src/platform/module-scaffold";
import { planMigrationSteps } from "../src/platform/v2-migrations";

const here = dirname(fileURLToPath(import.meta.url));
// Dossier TEMPORAIRE dans l'arbre du dépôt (pour résoudre @ecoledigitale/*), jamais dans src/modules.
const sandbox = resolve(here, `.tmp-scaffold-${process.pid}`);
mkdirSync(sandbox, { recursive: true });
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

/** Sous-dossier vierge du bac à sable + copie du vrai tableau de plages (pour tester sa mise à jour). */
function freshSandbox(name: string): { modulesDir: string; conventionsPath: string } {
  const root = join(sandbox, name);
  const modulesDir = join(root, "modules");
  mkdirSync(modulesDir, { recursive: true });
  const conventionsPath = join(root, "module-conventions.md");
  copyFileSync(DEFAULT_CONVENTIONS_PATH, conventionsPath);
  return { modulesDir, conventionsPath };
}

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

describe("arguments de la ligne de commande", () => {
  it("lit la clé et --range (deux formes), ignore le séparateur --", () => {
    expect(parseModuleNewArgs(["finance"])).toEqual({ key: "finance" });
    expect(parseModuleNewArgs(["--", "demo", "--range", "1700"])).toEqual({ key: "demo", range: 1700 });
    expect(parseModuleNewArgs(["--range=1800", "demo"])).toEqual({ key: "demo", range: 1800 });
  });

  it("refuse l'absence de clé, une option inconnue, un --range invalide et un argument en trop", () => {
    expect(() => parseModuleNewArgs([])).toThrow(/Usage/);
    expect(() => parseModuleNewArgs(["demo", "--force"])).toThrow(/Option inconnue/);
    expect(() => parseModuleNewArgs(["demo", "--range"])).toThrow(/--range attend/);
    expect(() => parseModuleNewArgs(["demo", "--range", "abc"])).toThrow(/--range attend/);
    expect(() => parseModuleNewArgs(["demo", "autre"])).toThrow(/Argument en trop/);
  });
});

describe("contenu du squelette", () => {
  it("génère tous les fichiers exigés par les conventions et le contrat d'assemblage", () => {
    const files = Object.keys(renderModuleFiles("demo")).sort();
    expect(files).toEqual([
      "README.md",
      "application/items.ts",
      "application/ports.ts",
      "domain/events.ts",
      "domain/item.ts",
      "http/plugin.ts",
      "http/schemas.ts",
      "index.ts",
      "infrastructure/item-repository.ts",
      "jobs.ts",
      "manifest.ts",
      "migrations/1600_demo_init.sql",
      "subscribers.ts",
      "test/demo.integration.test.ts",
      "test/demo.test.ts",
      "test/support/db.ts",
      "test/support/fakes.ts",
    ]);
    expect(Object.keys(renderModulesRootFiles("demo"))).toEqual(["isolation-allowlist.demo.ts"]);
  });

  it("la migration suit la convention : plage, schéma, tenant_id -> kernel.tenants, RLS, droits app_user", () => {
    const sql = renderModuleFiles("demo", { rangeStart: 1700 })["migrations/1700_demo_init.sql"] as string;
    expect(sql).toMatch(/1700-1799/);
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS demo;/);
    expect(sql).toMatch(/tenant_id\s+uuid NOT NULL REFERENCES kernel\.tenants\(id\)/);
    expect(sql).toMatch(/SELECT kernel\.enable_tenant_rls\('demo\.items'\);/);
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON demo\.items TO app_user;/);
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT)\b/im);
    // enable_tenant_rls vient après la création de la table, les droits après la RLS
    expect(sql.indexOf("CREATE TABLE")).toBeLessThan(sql.indexOf("SELECT kernel.enable_tenant_rls"));
    expect(sql.indexOf("SELECT kernel.enable_tenant_rls")).toBeLessThan(sql.indexOf("GRANT SELECT"));
  });

  it("le plugin respecte le contrat (app, runtime) : permissions, audit et contexte via le runtime, routes sans préfixe", () => {
    const plugin = renderModuleFiles("demo")["http/plugin.ts"] as string;
    expect(plugin).toMatch(/export default async function modulePlugin\(app: FastifyInstance, runtime: ModuleRuntime\)/);
    expect(plugin).toMatch(/runtime\.requirePermission\("demo\.item\.read"\)/);
    expect(plugin).toMatch(/runtime\.requirePermission\("demo\.item\.create"\)/);
    expect(plugin).toMatch(/audit: runtime\.auditPort/);
    expect(plugin).toMatch(/runtime\.resolveContext\(request\)/);
    expect(plugin).toMatch(/tenantDb: runtime\.tenantDb/);
    // L'ancien contrat (instance fixe, préfixe posé par le module) est banni.
    expect(plugin).not.toMatch(/app\.v2\b|\bprefix\b\s*:/);
    expect(plugin).not.toMatch(/\.register\(/);
    // Les routes déclarées ne portent aucun préfixe (le registre applique /api/v1/<clé>).
    const routes = [...plugin.matchAll(/app\.(?:get|post|put|patch|delete)\("([^"]+)"/g)].map((m) => m[1]);
    expect(routes).toEqual(["/items", "/items"]);
  });

  it("le use case écrit l'événement d'outbox puis l'audit (en dernier) dans la même transaction", () => {
    const usecase = renderModuleFiles("demo")["application/items.ts"] as string;
    expect(usecase).toMatch(/new PgOutboxWriter\(tx\)\.append/);
    expect(usecase).toMatch(/deps\.audit\.record\(tx,/);
    expect(usecase.indexOf("PgOutboxWriter")).toBeLessThan(usecase.indexOf("deps.audit.record"));
    expect(usecase).toMatch(/payload/);
    expect(renderModuleFiles("demo")["domain/events.ts"]).toMatch(/"demo\.item\.created" as const/);
  });

  it("subscribers.ts et jobs.ts exportent un tableau vide valide avec un exemple commenté", () => {
    for (const file of ["subscribers.ts", "jobs.ts"]) {
      const content = renderModuleFiles("demo")[file] as string;
      expect(content).toMatch(/^export default \[\];$/m);
      expect(content).toMatch(/^\/\/ import \{ define(Subscriber|ScheduledJob)/m);
      expect(content).toMatch(/^\/\/\s+name: "demo\./m);
      // Aucun import actif (le fichier se charge sans le SDK du worker).
      expect(content).not.toMatch(/^import /m);
    }
  });

  it("le fichier d'allowlist est vide et documente comment justifier une table globale", () => {
    const allowlist = renderModulesRootFiles("demo")["isolation-allowlist.demo.ts"] as string;
    expect(allowlist).toMatch(/const entries: AllowlistEntry\[\] = \[\];/);
    expect(allowlist).toMatch(/export default entries;/);
    expect(allowlist).toMatch(/justification/i);
    expect(allowlist).toMatch(/20 caractères/);
  });

  it("n'écrit rien d'interdit : pas de pool direct hors tests, pas de new Date(), pas d'import legacy", () => {
    for (const [path, content] of Object.entries(renderModuleFiles("demo"))) {
      if (!path.endsWith(".ts")) continue;
      if (!path.startsWith("test/")) expect(content, path).not.toMatch(/from "pg"/);
      expect(content, path).not.toMatch(/new Date\(\)|Date\.now\(\)/);
      expect(content, path).not.toMatch(/\/(routes|services|middlewares?|plugins)\//);
    }
  });

  it("le README décrit le contrat et pointe vers le guide", () => {
    const readme = renderModuleFiles("demo", { rangeStart: 1900 })["README.md"] as string;
    expect(readme).toMatch(/^# Module `demo`/);
    expect(readme).toMatch(/1900-1999/);
    expect(readme).toMatch(/new-module-guide\.md/);
    expect(readme).toMatch(/runtime\.requirePermission/);
    expect(readme).not.toContain("¤");
  });
});

describe("écriture du squelette", () => {
  it("écrit le module, le fait découvrir par le registre, ses migrations par le plan, son allowlist et le worker", async () => {
    const { modulesDir } = freshSandbox("write");
    const result = scaffoldModule({ key: "gen_demo", modulesDir });
    expect(result.files).toContain("manifest.ts");
    expect(result.rootFiles).toEqual(["isolation-allowlist.gen_demo.ts"]);
    expect(result.range).toEqual({ start: 1600, end: 1699 });
    expect(result.conventionsUpdated).toBeNull();
    expect(existsSync(join(modulesDir, "gen_demo", "migrations", "1600_gen_demo_init.sql"))).toBe(true);
    expect(existsSync(join(modulesDir, "isolation-allowlist.gen_demo.ts"))).toBe(true);

    // Import RÉEL (importer par défaut) : le manifeste généré est valide.
    const found = await discoverModules({ modulesDir });
    expect(found.map((m) => m.key)).toEqual(["gen_demo"]);
    expect(found[0]?.pluginPath).toMatch(/plugin\.ts$/);
    expect(found[0]?.manifest.permissions.every((p) => p.key.startsWith("gen_demo."))).toBe(true);
    expect(found[0]?.manifest.events.publishes).toEqual(["gen_demo.item.created"]);
    expect(() => resolveModuleOrder(found.map((m) => m.manifest))).not.toThrow();
    expect(planMigrationSteps(found, undefined, null).map((s) => s.id)).toEqual(["baseline", "gen_demo"]);

    // Le chargeur du test d'isolation accepte le fichier vide, rattaché au bon module.
    const allowlist = await loadIsolationAllowlist({ modulesDir, knownModules: ["gen_demo"] });
    expect(allowlist.entries.map((e) => e.source)).toEqual(["isolation-allowlist.ts"]);

    // Le worker découvre le module (fichiers présents) sans abonné ni job.
    const extensions = await discoverModuleExtensions({ dirs: [modulesDir] });
    expect(extensions.modules).toEqual(["gen_demo"]);
    expect(extensions.subscribers).toEqual([]);
    expect(extensions.jobs).toEqual([]);
  });

  it("le domaine généré se comporte comme annoncé", async () => {
    const { modulesDir } = freshSandbox("domain");
    scaffoldModule({ key: "gen_logic", modulesDir });
    const domain = await import(/* @vite-ignore */ join(modulesDir, "gen_logic", "domain", "item.ts"));
    expect(domain.normalizeLabel("  Un   libellé ")).toEqual({ ok: true, value: "Un libellé" });
    expect(domain.normalizeLabel("").ok).toBe(false);
  });

  it("refuse d'écraser un module existant (ou son fichier d'allowlist) et n'écrit alors rien de plus", () => {
    const { modulesDir } = freshSandbox("overwrite");
    scaffoldModule({ key: "gen_once", modulesDir });
    const manifest = join(modulesDir, "gen_once", "manifest.ts");
    const before = readFileSync(manifest, "utf8");
    expect(() => scaffoldModule({ key: "gen_once", modulesDir })).toThrow(/existe déjà/);
    expect(readFileSync(manifest, "utf8")).toBe(before);

    writeFileSync(join(modulesDir, "isolation-allowlist.gen_orphan.ts"), "export default [];\n");
    expect(() => scaffoldModule({ key: "gen_orphan", modulesDir })).toThrow(/existe déjà/);
    expect(existsSync(join(modulesDir, "gen_orphan"))).toBe(false);
  });

  it("attribue automatiquement des plages distinctes quand plusieurs modules sont générés dans le même dossier", () => {
    const { modulesDir } = freshSandbox("auto-range");
    expect(scaffoldModule({ key: "gen_a", modulesDir }).range.start).toBe(1600);
    expect(scaffoldModule({ key: "gen_b", modulesDir }).range.start).toBe(1700);
    expect(scaffoldModule({ key: "gen_c", modulesDir, range: 1900 }).range.start).toBe(1900);
    expect(() => scaffoldModule({ key: "gen_d", modulesDir, range: 1700 })).toThrow(/migration 1700 existe déjà/);
  });
});

describe("tableau des plages de module-conventions.md", () => {
  const real = readFileSync(DEFAULT_CONVENTIONS_PATH, "utf8");

  it("le vrai tableau est lisible : plages bornées et ligne ouverte", () => {
    const rows = parseRangeTable(real);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.find((r) => r.owner.includes("tenancy"))).toMatchObject({ start: 100, end: 149 });
    const open = rows.filter((r) => r.end === null);
    expect(open).toHaveLength(1);
    expect(nextFreeRangeStart(rows)).toBe(open[0]?.start);
  });

  it("addRangeRow insère la ligne avant la ligne ouverte et décale celle-ci, sans toucher au reste", () => {
    const rows = parseRangeTable(real);
    const open = rows.find((r) => r.end === null) as { start: number };
    const next = addRangeRow(real, "gen_x", open.start);
    const after = parseRangeTable(next);
    expect(after.find((r) => r.owner.includes("gen_x"))).toMatchObject({ start: open.start, end: open.start + 99 });
    expect(after.find((r) => r.end === null)?.start).toBe(open.start + 100);
    expect(after).toHaveLength(rows.length + 1);
    // Une seule ligne ajoutée, une seule modifiée.
    const a = real.split("\n");
    const b = next.split("\n");
    expect(b.length).toBe(a.length + 1);
    expect(b.filter((line) => !a.includes(line))).toHaveLength(2);
  });

  it("conserve les fins de ligne CRLF et refuse une clé déjà inscrite", () => {
    const crlf = real.replace(/\r?\n/g, "\r\n");
    const next = addRangeRow(crlf, "gen_crlf", 1600);
    expect(next.includes("\r\n")).toBe(true);
    expect(next.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(() => addRangeRow(next, "gen_crlf", 1700)).toThrow(/figure déjà/);
    expect(() => addRangeRow("# pas de tableau\n", "x", 1600)).toThrow(/introuvable/);
  });

  it("scaffoldModule ajoute la ligne au tableau : plages successives, ligne ouverte décalée", () => {
    const { modulesDir, conventionsPath } = freshSandbox("table");
    const first = scaffoldModule({ key: "gen_first", modulesDir, conventionsPath });
    expect(first.range.start).toBe(1600);
    expect(first.conventionsUpdated).toBe(conventionsPath);
    const second = scaffoldModule({ key: "gen_second", modulesDir, conventionsPath });
    expect(second.range.start).toBe(1700);

    const rows = parseRangeTable(readFileSync(conventionsPath, "utf8"));
    expect(rows.find((r) => r.owner.includes("gen_first"))).toMatchObject({ start: 1600, end: 1699 });
    expect(rows.find((r) => r.owner.includes("gen_second"))).toMatchObject({ start: 1700, end: 1799 });
    expect(rows.find((r) => r.end === null)?.start).toBe(1800);
    // La migration du second module est bien dans sa plage.
    expect(readdirSync(join(modulesDir, "gen_second", "migrations"))).toEqual(["1700_gen_second_init.sql"]);
  });

  it("--range : accepte la prochaine plage, refuse une plage prise, mal alignée ou réservée, sans rien écrire", () => {
    const { modulesDir, conventionsPath } = freshSandbox("explicit");
    expect(scaffoldModule({ key: "gen_r1", modulesDir, conventionsPath, range: 1600 }).range.start).toBe(1600);
    const before = readFileSync(conventionsPath, "utf8");
    for (const [range, message] of [
      [1600, /déjà attribuée à `gen_r1`|déjà attribuée/],
      [1650, /Plage invalide/],
      [1500, /Plage invalide/],
      [300, /Plage invalide/],
    ] as const) {
      expect(() => scaffoldModule({ key: "gen_r2", modulesDir, conventionsPath, range }), String(range)).toThrow(message);
    }
    expect(existsSync(join(modulesDir, "gen_r2"))).toBe(false);
    expect(existsSync(join(modulesDir, "isolation-allowlist.gen_r2.ts"))).toBe(false);
    expect(readFileSync(conventionsPath, "utf8")).toBe(before);

    // Un saut de plage est accepté mais signalé.
    const skipped = scaffoldModule({ key: "gen_r3", modulesDir, conventionsPath, range: 2000 });
    expect(skipped.warnings.join(" ")).toMatch(/saute 1700-1999/);
  });

  it("sans conventionsPath explicite, un modulesDir de test ne touche JAMAIS au vrai tableau", () => {
    const { modulesDir } = freshSandbox("untouched");
    scaffoldModule({ key: "gen_safe", modulesDir });
    expect(readFileSync(DEFAULT_CONVENTIONS_PATH, "utf8")).toBe(real);
  });
});
