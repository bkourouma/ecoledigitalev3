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
import { spawn } from "node:child_process";
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

/**
 * Délais : les barrières parcourent TOUT le dépôt (dependency-cruiser, tsc du projet v2, vitest enfant) ; leur durée croît avec
 * le nombre de modules et, sur une machine partagée ou une CI chargée, elle peut doubler. Les bases ci-dessous couvrent la
 * taille actuelle du dépôt ; `SCAFFOLD_GATES_TIMEOUT_FACTOR` (ex. 2) les multiplie sans modifier le test.
 */
const TIMEOUT_FACTOR = Math.max(1, Number(process.env.SCAFFOLD_GATES_TIMEOUT_FACTOR ?? "1") || 1);
const t = (baseMs: number): number => Math.round(baseMs * TIMEOUT_FACTOR);

function removeGeneratedModules(): void {
  for (const name of readdirSync(DEFAULT_MODULES_DIR)) {
    if (STALE.test(name)) rmSync(join(DEFAULT_MODULES_DIR, name), { recursive: true, force: true });
  }
}

// Filet de sécurité : si le worker est interrompu avant `afterAll` (délai dépassé, arrêt du processus), le module jetable
// ne doit pas rester dans l'arbre de travail. Un handler `exit` est synchrone, donc exécuté à la sortie du processus.
process.once("exit", () => {
  try {
    removeGeneratedModules();
  } catch {
    /* sortie du processus : rien de plus à faire */
  }
});

/** Environnement d'un vitest enfant : pas de variables du vitest courant. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(VITEST|VITE_|TEST$|NODE_V8_COVERAGE$)/.test(name)) env[name] = value;
  }
  return env;
}

/**
 * Lance un script Node enfant SANS bloquer la boucle d'événements du worker vitest : un `spawnSync` de plusieurs minutes
 * (tsc du projet complet) empêche le worker de répondre au processus principal (« Timeout calling onTaskUpdate »).
 */
function run(script: string, args: string[], cwd: string): Promise<{ status: number | null; out: string }> {
  return new Promise((resolveRun) => {
    let out = "";
    const child = spawn(process.execPath, [script, ...args], { cwd, env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    // Un enfant bloqué ne doit pas survivre au test (ni garder l'arbre de travail occupé).
    const timer = setTimeout(() => child.kill("SIGKILL"), t(900_000));
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ status: null, out: `${out}${String(error)}` });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveRun({ status, out });
    });
  });
}

describe("squelette généré : barrières de la plateforme", () => {
  beforeAll(() => {
    removeGeneratedModules();
    const result = scaffoldModule({ key: KEY, modulesDir: DEFAULT_MODULES_DIR, conventionsPath: null });
    expect(result.range.start).toBeGreaterThanOrEqual(1600);
  }, t(60_000));
  afterAll(() => removeGeneratedModules());

  it("pnpm check:boundaries : aucune violation de frontière", async () => {
    const bin = resolve(repoRoot, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");
    const { status, out } = await run(
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
  }, t(300_000));

  it("tsc (type-check:v2) : le module compile sans erreur", async () => {
    const tsc = require.resolve("typescript/bin/tsc");
    const { status, out } = await run(tsc, ["-p", "tsconfig.v2.json"], apiRoot);
    const own = out.split(/\r?\n/).filter((line) => line.includes(KEY));
    expect(own).toEqual([]);
    expect(status, out).toBe(0);
  }, t(600_000));

  it("ses tests unitaires et d'intégration passent (l'intégration tourne si TEST_DATABASE_URL est défini)", async () => {
    const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
    const { status, out } = await run(vitest, ["run", `src/modules/${KEY}`], apiRoot);
    expect(out, out).toMatch(/Test Files\s+.*passed/);
    expect(out).not.toMatch(/failed/);
    expect(status, out).toBe(0);
    if (!TEST_DATABASE_URL) expect(out).toMatch(/skipped/);
    else expect(out).not.toMatch(/skipped/);
  }, t(600_000));

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

  it("le CLI refuse sans clé (code 2) et une clé invalide (code 1) sans rien écrire", async () => {
    const tsx = require.resolve("tsx/cli");
    const before = readdirSync(DEFAULT_MODULES_DIR).sort();
    const none = await run(tsx, ["scripts/module-new.ts"], repoRoot);
    expect(none.status, none.out).toBe(2);
    expect(none.out).toMatch(/Usage/);
    const bad = await run(tsx, ["scripts/module-new.ts", "Bad-Key"], repoRoot);
    expect(bad.status, bad.out).toBe(1);
    expect(bad.out).toMatch(/Clé de module invalide/);
    expect(readdirSync(DEFAULT_MODULES_DIR).sort()).toEqual(before);
  }, t(120_000));
});

describeIntegration("squelette généré : test d'isolation global (pnpm test:isolation)", () => {
  beforeAll(() => {
    removeGeneratedModules();
    scaffoldModule({ key: KEY, modulesDir: DEFAULT_MODULES_DIR, conventionsPath: null });
  }, t(60_000));
  afterAll(() => removeGeneratedModules());

  it("migre et isole le module avec les autres modules réels (RLS forcée, test comportemental A/B)", async () => {
    const result = await assertGlobalIsolation({ adminUrl: TEST_DATABASE_URL as string });
    expect(result.modules).toContain(KEY);
    expect(result.report.behavioural).toContain(`${KEY}.items`);
    expect(result.violations).toEqual([]);
  }, t(300_000));
});
