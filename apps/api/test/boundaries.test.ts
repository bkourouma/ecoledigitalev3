/**
 * Valide que `.dependency-cruiser.cjs` ÉCHOUE quand les règles sont violées (et passe sinon).
 * Les modules « jouets » vivent dans un dossier temporaire reproduisant l'arborescence du dépôt ;
 * aucun module n'est commité ni écrit dans apps/api/src/modules.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderModuleFiles, renderModulesRootFiles } from "../src/platform/module-scaffold";
import { makeTmpDir } from "./helpers/fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG = resolve(here, "../../../.dependency-cruiser.cjs");
// dependency-cruiser est une devDependency de la RACINE du monorepo.
const DEPCRUISE_BIN = resolve(here, "../../../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");

interface Violation {
  rule: string;
  from: string;
  to: string;
}

function write(root: string, path: string, content: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function cruise(root: string): { status: number | null; violations: Violation[]; stderr: string } {
  const targets = ["apps", "packages"].filter((t) => existsSync(join(root, t)));
  const run = (type: string) =>
    spawnSync(process.execPath, [DEPCRUISE_BIN, "--config", CONFIG, "--output-type", type, ...targets], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    });
  // Le rapport JSON donne le détail ; le type `err` rend le code de sortie (= nombre d'erreurs), comme `pnpm check:boundaries`.
  const detail = run("json");
  const exit = run("err");
  const json = JSON.parse(detail.stdout || "{}");
  const violations = (json.summary?.violations ?? []).map((v: any): Violation => ({
    rule: v.rule.name,
    from: v.from,
    to: v.to,
  }));
  return { status: exit.status, violations, stderr: detail.stderr };
}

function stubPackages(root: string): void {
  for (const name of ["pg", "fastify"]) {
    write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version: "0.0.0", main: "index.js" }));
    write(root, `node_modules/${name}/index.js`, "module.exports = {};\n");
  }
}

const M = "apps/api/src/modules";

describe("règles de frontières (dependency-cruiser)", () => {
  const tmp = makeTmpDir("ed-boundaries-");
  let violations: Violation[] = [];
  let status: number | null = null;

  beforeAll(() => {
    const r = tmp.dir;
    stubPackages(r);

    // --- code legacy ---
    write(r, "apps/api/src/routes/legacy-route.ts", "export const legacyRoute = 1;\n");
    write(r, "apps/api/src/services/legacy-svc.ts", "export const legacySvc = 1;\n");
    write(r, "apps/api/src/platform/platform-ok.ts", "export const platformOk = 1;\n");

    // --- module alpha : propre, avec une API publique ---
    write(r, `${M}/alpha/index.ts`, 'export { secret } from "./internal/secret";\n');
    write(r, `${M}/alpha/internal/secret.ts`, "export const secret = 1;\n");
    write(r, `${M}/alpha/infrastructure/repo.ts`, 'import "pg";\nexport const repo = 1;\n');
    write(r, `${M}/alpha/domain/rule.ts`, "export const rule = 1;\n");
    write(r, `${M}/alpha/application/use-case.ts`, 'import { rule } from "../domain/rule";\nimport { repo } from "../infrastructure/repo";\nimport { platformOk } from "../../../platform/platform-ok";\nexport const useCase = [rule, repo, platformOk];\n');
    write(r, `${M}/alpha/http/plugin.ts`, 'import "fastify";\nimport { useCase } from "../application/use-case";\nexport default useCase;\n');
    write(r, `${M}/alpha/test/alpha.test.ts`, 'import "pg";\nimport { useCase } from "../application/use-case";\nexport const t = useCase;\n');

    // --- module beta : cumule les violations ---
    write(r, `${M}/beta/index.ts`, "export const beta = 1;\n");
    write(r, `${M}/beta/application/ok-public-api.ts`, 'import { secret } from "../../alpha/index";\nexport const ok = secret;\n');
    write(r, `${M}/beta/application/uses-internals.ts`, 'import { secret } from "../../alpha/internal/secret";\nexport const bad1 = secret;\n');
    write(r, `${M}/beta/infrastructure/repo.ts`, "export const repo = 1;\n");
    write(r, `${M}/beta/domain/imports-infra.ts`, 'import { repo } from "../infrastructure/repo";\nexport const bad2 = repo;\n');
    write(r, `${M}/beta/domain/imports-pg.ts`, 'import "pg";\nexport const bad3 = 1;\n');
    write(r, `${M}/beta/domain/imports-fastify.ts`, 'import "fastify";\nexport const bad4 = 1;\n');
    write(r, `${M}/beta/application/imports-http.ts`, 'import plugin from "../http/plugin";\nexport const bad5 = plugin;\n');
    write(r, `${M}/beta/http/plugin.ts`, "export default 1;\n");
    write(r, `${M}/beta/http/uses-pg.ts`, 'import "pg";\nexport const bad6 = 1;\n');
    write(r, `${M}/beta/application/imports-legacy-route.ts`, 'import { legacyRoute } from "../../../routes/legacy-route";\nexport const bad7 = legacyRoute;\n');
    write(r, `${M}/beta/application/imports-legacy-service.ts`, 'import { legacySvc } from "../../../services/legacy-svc";\nexport const bad8 = legacySvc;\n');
    write(r, `${M}/isolation-allowlist.beta.ts`, 'import { repo } from "./beta/infrastructure/repo";\nexport default [repo];\n');

    // --- adaptateurs de plateforme : seuls à connaître plusieurs modules, par leur index.ts uniquement ---
    write(r, "apps/api/src/platform/adapters/ok-adapter.ts", 'import { secret } from "../../modules/alpha/index";\nimport { beta } from "../../modules/beta/index";\nexport const okAdapter = [secret, beta];\n');
    write(r, "apps/api/src/platform/adapters/bad-internals.ts", 'import { secret } from "../../modules/alpha/internal/secret";\nexport const badAdapter1 = secret;\n');
    write(r, "apps/api/src/platform/adapters/bad-legacy.ts", 'import { legacySvc } from "../../services/legacy-svc";\nexport const badAdapter2 = legacySvc;\n');
    write(r, "apps/api/src/platform/adapters/bad-pg.ts", 'import "pg";\nexport const badAdapter3 = 1;\n');
    write(r, `${M}/beta/application/imports-adapter.ts`, 'import { okAdapter } from "../../../platform/adapters/ok-adapter";\nexport const bad11 = okAdapter;\n');
    write(r, "apps/api/src/platform/not-an-adapter.ts", 'import { secret } from "../modules/alpha/internal/secret";\nexport const notAdapter = secret;\n');

    // --- packages ---
    write(r, "packages/rules-engine/src/bad.ts", 'import "pg";\nimport { readFileSync } from "node:fs";\nexport const bad9 = readFileSync;\n');
    write(r, "packages/kernel/src/bad.ts", 'import { platformOk } from "../../../apps/api/src/platform/platform-ok";\nexport const bad10 = platformOk;\n');

    ({ violations, status } = cruise(r));
  }, 120_000);

  afterAll(() => tmp.cleanup());

  const has = (rule: string, from: string, to?: string) =>
    violations.some((v) => v.rule === rule && v.from.endsWith(from) && (to === undefined || v.to.endsWith(to)));

  it("échoue (code de sortie non nul) quand une règle est violée", () => {
    expect(status).not.toBe(0);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("interdit d'importer autre chose que l'index.ts d'un autre module", () => {
    expect(has("modules-only-via-index", "beta/application/uses-internals.ts", "alpha/internal/secret.ts")).toBe(true);
    expect(has("modules-root-only-via-index", "isolation-allowlist.beta.ts", "beta/infrastructure/repo.ts")).toBe(true);
  });

  it("autorise l'import de l'index.ts public d'un autre module", () => {
    expect(violations.some((v) => v.from.endsWith("beta/application/ok-public-api.ts"))).toBe(false);
  });

  it("garde domain/ pur : ni infrastructure, ni pg, ni fastify", () => {
    expect(has("domain-is-pure", "beta/domain/imports-infra.ts", "beta/infrastructure/repo.ts")).toBe(true);
    expect(has("domain-is-pure", "beta/domain/imports-pg.ts")).toBe(true);
    expect(has("domain-is-pure", "beta/domain/imports-fastify.ts")).toBe(true);
  });

  it("interdit à application/ d'importer http/", () => {
    expect(has("application-no-http", "beta/application/imports-http.ts", "beta/http/plugin.ts")).toBe(true);
  });

  it("interdit pg hors de infrastructure/ (mais l'autorise dans infrastructure/ et les tests)", () => {
    expect(has("no-pg-outside-infrastructure", "beta/http/uses-pg.ts")).toBe(true);
    expect(violations.some((v) => v.rule === "no-pg-outside-infrastructure" && v.from.includes("alpha/infrastructure"))).toBe(false);
    expect(violations.some((v) => v.rule === "no-pg-outside-infrastructure" && v.from.includes("alpha/test"))).toBe(false);
  });

  it("interdit à un module d'importer le code legacy (routes, services…), pas platform/", () => {
    expect(has("no-legacy-in-modules", "beta/application/imports-legacy-route.ts", "routes/legacy-route.ts")).toBe(true);
    expect(has("no-legacy-in-modules", "beta/application/imports-legacy-service.ts", "services/legacy-svc.ts")).toBe(true);
    expect(violations.some((v) => v.rule === "no-legacy-in-modules" && v.from.includes("alpha/application"))).toBe(false);
  });

  it("platform/adapters : l'index.ts des modules seulement, ni legacy ni pg, et jamais importé par un module", () => {
    expect(violations.some((v) => v.from.endsWith("platform/adapters/ok-adapter.ts"))).toBe(false);
    expect(has("platform-adapters-only-via-index", "platform/adapters/bad-internals.ts", "alpha/internal/secret.ts")).toBe(true);
    expect(has("platform-adapters-no-legacy-no-pg", "platform/adapters/bad-legacy.ts", "services/legacy-svc.ts")).toBe(true);
    expect(has("platform-adapters-no-legacy-no-pg", "platform/adapters/bad-pg.ts")).toBe(true);
    expect(has("modules-not-adapters", "beta/application/imports-adapter.ts", "platform/adapters/ok-adapter.ts")).toBe(true);
    // Le reste de platform/ n'est pas concerné par la règle des adaptateurs (aucune exception créée).
    expect(violations.some((v) => v.rule.startsWith("platform-adapters") && v.from.endsWith("platform/not-an-adapter.ts"))).toBe(false);
  });

  it("garde les packages purs (rules-engine sans pg / node:fs, kernel sans code d'app)", () => {
    expect(has("rules-engine-pure", "rules-engine/src/bad.ts")).toBe(true);
    expect(has("rules-engine-no-node-io", "rules-engine/src/bad.ts")).toBe(true);
    expect(has("kernel-pure", "kernel/src/bad.ts")).toBe(true);
    expect(has("packages-no-apps", "kernel/src/bad.ts")).toBe(true);
  });

  it("ne signale rien sur le module propre alpha", () => {
    expect(violations.filter((v) => v.from.includes("modules/alpha/"))).toEqual([]);
  });
});

describe("squelette généré par module:new", () => {
  const tmp = makeTmpDir("ed-boundaries-scaffold-");
  afterAll(() => tmp.cleanup());

  it("respecte toutes les règles de frontières", () => {
    stubPackages(tmp.dir);
    // Fichiers que le squelette importe en dehors de son dossier : plateforme (types du runtime), registre (test),
    // liste blanche centrale (type). Sans eux, l'import ne serait pas résolu donc pas contrôlé par les règles.
    write(tmp.dir, "apps/api/src/platform/runtime.ts", "export interface ModuleRuntime { readonly tenantDb: unknown }\n");
    write(
      tmp.dir,
      "apps/api/src/modules/registry.ts",
      "export const registerModules = 1;\nexport const resetRegistryForTests = 1;\nexport type DiscoveredModule = unknown;\n",
    );
    write(tmp.dir, "apps/api/src/modules/isolation-allowlist.ts", "export interface AllowlistEntry { table: string; reason: string }\n");
    for (const [index, key] of ["gen_one", "gen_two"].entries()) {
      for (const [relative, content] of Object.entries(renderModuleFiles(key, { rangeStart: 1600 + index * 100 }))) {
        if (relative.endsWith(".sql") || relative.endsWith(".md")) continue;
        write(tmp.dir, `${M}/${key}/${relative}`, content);
      }
      for (const [relative, content] of Object.entries(renderModulesRootFiles(key))) write(tmp.dir, `${M}/${relative}`, content);
    }
    const result = cruise(tmp.dir);
    expect(result.violations).toEqual([]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  }, 120_000);
});

describe("dépôt réel", () => {
  it("n'a aucune violation (pnpm check:boundaries)", () => {
    const root = resolve(here, "../../..");
    const run = spawnSync(
      process.execPath,
      [
        DEPCRUISE_BIN,
        "--config",
        CONFIG,
        "--output-type",
        "json",
        "apps/api/src/modules",
        "apps/api/src/platform",
        "packages/kernel/src",
        "packages/rules-engine/src",
        "packages/database/src",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 },
    );
    const json = JSON.parse(run.stdout);
    const errors = json.summary.violations.filter((v: any) => v.rule.severity === "error");
    expect(errors).toEqual([]);
    expect(run.status).toBe(0);
  }, 120_000);
});
