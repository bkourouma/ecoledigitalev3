import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_ALLOWLIST } from "../src/modules/isolation-allowlist";
import { AllowlistError, loadIsolationAllowlist, validateEntries } from "../src/platform/isolation-allowlist-loader";
import { makeFakeModules, type FakeModules } from "./helpers/fixtures";

let fake: FakeModules | undefined;
afterEach(() => {
  fake?.cleanup();
  fake = undefined;
});

const REASON = "Référentiel commun à tous les tenants, sans aucune donnée de tenant.";

/** Écrit un fichier isolation-allowlist.<module>.ts factice et son contenu pour l'importer. */
function withAllowlistFiles(files: Record<string, unknown>) {
  fake = makeFakeModules({});
  const loaded = new Map<string, unknown>();
  for (const [name, content] of Object.entries(files)) {
    const path = join(fake.dir, name);
    writeFileSync(path, "// fake\n");
    loaded.set(path, content);
  }
  const importer = async (path: string) => {
    if (!loaded.has(path)) throw new Error(`inconnu : ${path}`);
    return loaded.get(path);
  };
  return { dir: fake.dir, importer };
}

describe("liste blanche centrale", () => {
  it("contient kernel.tenants avec une justification", () => {
    expect(CORE_ALLOWLIST.map((e) => e.table)).toEqual(["kernel.tenants"]);
    expect(CORE_ALLOWLIST[0]?.reason.length).toBeGreaterThanOrEqual(20);
  });

  it("sans fichier de module, ne charge que l'entrée centrale", async () => {
    const { dir, importer } = withAllowlistFiles({});
    const result = await loadIsolationAllowlist({ modulesDir: dir, importer, knownModules: [] });
    expect(result.tables).toEqual(["kernel.tenants"]);
  });
});

describe("un fichier isolation-allowlist.<module>.ts par module (découverte automatique)", () => {
  it("fusionne les fichiers de plusieurs modules sans fichier central à éditer", async () => {
    const { dir, importer } = withAllowlistFiles({
      "isolation-allowlist.finance.ts": { default: [{ table: "finance.currencies", reason: REASON }] },
      "isolation-allowlist.rbac.ts": {
        default: [{ table: "rbac.permissions", reason: REASON }],
        fixtures: { "rbac.permissions": { key: "x.y.z" } },
      },
    });
    const result = await loadIsolationAllowlist({ modulesDir: dir, importer, knownModules: ["finance", "rbac"] });
    expect(result.tables).toEqual(["kernel.tenants", "finance.currencies", "rbac.permissions"]);
    expect(result.entries.find((e) => e.table === "finance.currencies")?.source).toBe("isolation-allowlist.finance.ts");
    expect(result.fixtures["rbac.permissions"]).toEqual({ key: "x.y.z" });
    expect(Object.keys(result.fixtures)).toContain("kernel.domain_events"); // fixtures du kernel toujours présentes
  });

  it("refuse une entrée sans justification suffisante", async () => {
    for (const reason of [undefined, "", "todo", "pas isolée"]) {
      const { dir, importer } = withAllowlistFiles({ "isolation-allowlist.finance.ts": { default: [{ table: "finance.currencies", reason }] } });
      await expect(loadIsolationAllowlist({ modulesDir: dir, importer, knownModules: ["finance"] })).rejects.toThrow(/reason/);
      fake?.cleanup();
    }
  });

  it("refuse qu'un module allowliste une table d'un autre schéma", async () => {
    const { dir, importer } = withAllowlistFiles({
      "isolation-allowlist.finance.ts": { default: [{ table: "iam.users", reason: REASON }] },
    });
    await expect(loadIsolationAllowlist({ modulesDir: dir, importer, knownModules: ["finance", "iam"] })).rejects.toThrow(
      /n'appartient pas au schéma du module "finance"/,
    );
  });

  it("refuse qu'un module allowliste une table du kernel", async () => {
    const { dir, importer } = withAllowlistFiles({
      "isolation-allowlist.finance.ts": { default: [{ table: "kernel.domain_events", reason: REASON }] },
    });
    await expect(loadIsolationAllowlist({ modulesDir: dir, importer, knownModules: ["finance"] })).rejects.toThrow(AllowlistError);
  });

  it("refuse un doublon et un fichier orphelin", async () => {
    const dup = withAllowlistFiles({
      "isolation-allowlist.finance.ts": {
        default: [
          { table: "finance.currencies", reason: REASON },
          { table: "finance.currencies", reason: REASON },
        ],
      },
    });
    await expect(loadIsolationAllowlist({ modulesDir: dup.dir, importer: dup.importer, knownModules: ["finance"] })).rejects.toThrow(
      /deux fois/,
    );
    fake?.cleanup();

    const orphan = withAllowlistFiles({ "isolation-allowlist.ghost.ts": { default: [] } });
    await expect(loadIsolationAllowlist({ modulesDir: orphan.dir, importer: orphan.importer, knownModules: ["finance"] })).rejects.toThrow(
      /orphelin/,
    );
  });

  it("validateEntries rejette les formats invalides", () => {
    expect(() => validateEntries({}, "x.ts", "m")).toThrow(/tableau/);
    expect(() => validateEntries([{ table: "pas-qualifiée", reason: REASON }], "x.ts", "m")).toThrow(/schema\.table/);
    expect(() => validateEntries([null], "x.ts", "m")).toThrow(/objet/);
  });
});
