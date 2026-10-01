/**
 * Le squelette produit par `pnpm module:new` doit passer SANS modification toutes les barrières de la plateforme :
 *
 *   pnpm check:boundaries · tsc (type-check:v2) · ses propres tests (unitaires + intégration) ·
 *   pnpm test:isolation (via assertGlobalIsolation) · chargement par le registre et découverte par le worker.
 *
 * Les barrières lisent l'arbre réel (`apps/api/src/modules`, chemins relatifs du dépôt, plugin à `../../../platform`) :
 * le module est donc généré sous une clé jetable `zz_gate_<aléa>` dans ce dossier, puis SUPPRIMÉ (afterAll, et
 * nettoyage préalable des restes d'une exécution interrompue). Le tableau de `module-conventions.md` n'est pas touché
 * (voir scaffold.test.ts pour sa mise à jour, sur une copie). L'isolation requiert TEST_DATABASE_URL
 * (`pnpm test:isolation` fournit un Postgres éphémère).
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveModuleOrder } from "@ecoledigitale/kernel";
import { DEFAULT_MODULES_DIR, discoverModules } from "../src/modules/registry-discovery";
import { assertGlobalIsolation } from "../src/platform/isolation-check";
import { scaffoldModule } from "../src/platform/module-scaffold";
import { TEST_DATABASE_URL, describeIntegration } from "./helpers/fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "..", "..");
const require = createRequire(import.meta.url);
const KEY = `zz_gate_${randomBytes(3).toString("hex")}`;
const STALE = /^(?:isolation-allowlist\.)?zz_gate_[0-9a-f]{6}(?:\.ts)?$/;

function removeGeneratedModules(): void {
  for (const name of readdirSync(DEFAULT_MODULES_DIR)) {
    if (STALE.test(name)) rmSync(join(DEFAULT_MODULES_DIR, name), { recursive: true, force: true });
  }
}

/** Environnement d'un vitest enfant : pas de variables du vitest courant. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(VITEST|VITE_|TEST$|NODE_V8_COVERAGE$)/.test(name)) env[name] = value;
  }
  return env;
}

function run(script: string, args: string[], cwd: string): { status: number | null; out: string } {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 26,
    env: cleanEnv(),
  });
  return { status: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("squelette généré : barrières de la plateforme", () => {
  beforeAll(() => {
    removeGeneratedModules();
    const result = scaffoldModule({ key: KEY, modulesDir: DEFAULT_MODULES_DIR, conventionsPath: null });
    expect(result.range.start).toBeGreaterThanOrEqual(1600);
  }, 60_000);
  afterAll(() => removeGeneratedModules());

  it("pnpm check:boundaries : aucune violation de frontière", () => {
    const bin = resolve(repoRoot, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");
    const { status, out } = run(
      bin,
      [
        "apps/api/src/modules",
        "apps/api/src/platform",
        "packages/kernel/src",
        "packages/rules-engine/src",
        "packages/database/src",
        "--config",
        ".dependency-cruiser.cjs",
        "--output-type",
        "err",
      ],
      repoRoot,
    );
    expect(out).not.toMatch(new RegExp(KEY));
    expect(status, out).toBe(0);
  }, 240_000);

  it("tsc (type-check:v2) : le module compile sans erreur", () => {
    const tsc = require.resolve("typescript/bin/tsc");
    const { status, out } = run(tsc, ["-p", "tsconfig.v2.json"], apiRoot);
    const own = out.split(/\r?\n/).filter((line) => line.includes(KEY));
    expect(own).toEqual([]);
    expect(status, out).toBe(0);
  }, 300_000);

  it("ses tests unitaires et d'intégration passent (l'intégration tourne si TEST_DATABASE_URL est défini)", () => {
    const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
    const { status, out } = run(vitest, ["run", `src/modules/${KEY}`], apiRoot);
    expect(out, out).toMatch(/Test Files\s+.*passed/);
    expect(out).not.toMatch(/failed/);
    expect(status, out).toBe(0);
    if (!TEST_DATABASE_URL) expect(out).toMatch(/skipped/);
    else expect(out).not.toMatch(/skipped/);
  }, 300_000);

  it("le registre découvre le module dans l'arbre réel et l'ensemble reste valide (clés, permissions, ordre)", async () => {
    const found = await discoverModules();
    const mine = found.find((m) => m.key === KEY);
    expect(mine).toBeDefined();
    expect(mine?.pluginPath).toMatch(/plugin\.ts$/);
    expect(mine?.migrationsDir).toMatch(/migrations$/);
    expect(mine?.manifest.permissions.map((p) => p.key)).toEqual([`${KEY}.item.read`, `${KEY}.item.create`]);
    expect(() => resolveModuleOrder(found.map((m) => m.manifest))).not.toThrow();
    expect(existsSync(join(DEFAULT_MODULES_DIR, `isolation-allowlist.${KEY}.ts`))).toBe(true);
  });

  it("le CLI refuse sans clé (code 2) et une clé invalide (code 1) sans rien écrire", () => {
    const tsx = require.resolve("tsx/cli");
    const before = readdirSync(DEFAULT_MODULES_DIR).sort();
    const none = run(tsx, ["scripts/module-new.ts"], repoRoot);
    expect(none.status, none.out).toBe(2);
    expect(none.out).toMatch(/Usage/);
    const bad = run(tsx, ["scripts/module-new.ts", "Bad-Key"], repoRoot);
    expect(bad.status, bad.out).toBe(1);
    expect(bad.out).toMatch(/Clé de module invalide/);
    expect(readdirSync(DEFAULT_MODULES_DIR).sort()).toEqual(before);
  }, 120_000);
});

describeIntegration("squelette généré : test d'isolation global (pnpm test:isolation)", () => {
  beforeAll(() => {
    removeGeneratedModules();
    scaffoldModule({ key: KEY, modulesDir: DEFAULT_MODULES_DIR, conventionsPath: null });
  });
  afterAll(() => removeGeneratedModules());

  it("migre et isole le module avec les autres modules réels (RLS forcée, test comportemental A/B)", async () => {
    const result = await assertGlobalIsolation({ adminUrl: TEST_DATABASE_URL as string });
    expect(result.modules).toContain(KEY);
    expect(result.report.behavioural).toContain(`${KEY}.items`);
    expect(result.violations).toEqual([]);
  }, 180_000);
});
