/**
 * `pnpm test:isolation` : test d'isolation GLOBAL sur l'arbre réel des modules, plus des
 * modules factices qui prouvent que le test ÉCHOUE quand une table n'est pas isolée.
 */
import { afterEach, describe, expect, it } from "vitest";
import { assertGlobalIsolation, GlobalIsolationError, runGlobalIsolationCheck } from "../../src/platform/isolation-check";
import { TEST_DATABASE_URL, describeIntegration, makeFakeModules, type FakeModules } from "../helpers/fixtures";

let fake: FakeModules | undefined;
afterEach(() => {
  fake?.cleanup();
  fake = undefined;
});

const REASON = "Référentiel commun à tous les tenants, sans aucune donnée de tenant.";
const adminUrl = (): string => TEST_DATABASE_URL as string;

const SCHEMA = (key: string) =>
  `CREATE SCHEMA ${key};\nGRANT USAGE ON SCHEMA ${key} TO app_user;\n`;

describeIntegration("isolation globale — arbre réel", () => {
  it("passe sur les modules réellement présents (trivialement s'il n'y en a aucun)", async () => {
    const result = await assertGlobalIsolation({ adminUrl: adminUrl() });
    expect(result.violations).toEqual([]);
    expect(result.schemas[0]).toBe("kernel");
    // La baseline est auditée : kernel.domain_events est une table de tenant isolée, kernel.tenants est allowlistée.
    expect(result.report.allowlisted).toContain("kernel.tenants");
    expect(result.report.behavioural).toContain("kernel.domain_events");
    console.info(
      `[isolation] base ${result.database} : modules=[${result.modules.join(", ")}] ; ` +
        `testées=${result.report.behavioural.length} ; structure seule=${result.report.structuralOnly.length} ; ` +
        `allowlist=${result.allowlist.tables.length}`,
    );
    for (const s of result.report.structuralOnly) console.info(`[isolation] structure seule : ${s.table} — ${s.reason}`);
  });
});

describeIntegration("isolation globale — le test doit ÉCHOUER sur un module qui viole les règles", () => {
  it("détecte table sans RLS, table sans tenant_id, schéma étranger et table dans public", async () => {
    fake = makeFakeModules({
      no_rls: {
        migrations: {
          "0001_init.sql":
            SCHEMA("no_rls") +
            "CREATE TABLE no_rls.items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES kernel.tenants(id));\n" +
            "GRANT SELECT, INSERT ON no_rls.items TO app_user;\n",
        },
      },
      no_tenant: {
        migrations: {
          "0001_init.sql":
            SCHEMA("no_tenant") +
            "CREATE TABLE no_tenant.codes (code text PRIMARY KEY);\nGRANT SELECT ON no_tenant.codes TO app_user;\n",
        },
      },
      stray: {
        migrations: {
          "0001_init.sql": "CREATE SCHEMA not_a_module;\nCREATE TABLE not_a_module.t (id int);\n",
        },
      },
      in_public: {
        migrations: {
          "0001_init.sql": "-- no-role\nCREATE TABLE public.leaked_table (id int);\n",
        },
      },
    });

    const result = await runGlobalIsolationCheck({ adminUrl: adminUrl(), modulesDir: fake.dir, importer: fake.importer });
    const problemsOf = (table: string) => result.violations.filter((v) => v.table === table).map((v) => v.problem);

    expect(problemsOf("no_rls.items").join(" | ")).toMatch(/ROW LEVEL SECURITY non activée/);
    expect(problemsOf("no_tenant.codes").join(" | ")).toMatch(/colonne tenant_id absente/);
    expect(problemsOf("not_a_module.*").join(" | ")).toMatch(/ne correspond à aucun module/);
    expect(problemsOf("public.leaked_table").join(" | ")).toMatch(/schéma public/);

    await expect(assertGlobalIsolation({ adminUrl: adminUrl(), modulesDir: fake.dir, importer: fake.importer })).rejects.toBeInstanceOf(
      GlobalIsolationError,
    );
  });

  it("accepte une table globale justifiée dans isolation-allowlist.<module>.ts, sans éditer de fichier central", async () => {
    fake = makeFakeModules({
      refs: {
        migrations: {
          "0001_init.sql":
            SCHEMA("refs") + "CREATE TABLE refs.currencies (code text PRIMARY KEY);\nGRANT SELECT ON refs.currencies TO app_user;\n",
        },
      },
    });
    fake.register("isolation-allowlist.refs.ts", { default: [{ table: "refs.currencies", reason: REASON }] });

    const result = await assertGlobalIsolation({ adminUrl: adminUrl(), modulesDir: fake.dir, importer: fake.importer });
    expect(result.report.allowlisted).toEqual(expect.arrayContaining(["kernel.tenants", "refs.currencies"]));
    expect(result.violations).toEqual([]);
  });

  it("échoue sur une entrée de liste blanche périmée (aucune table correspondante)", async () => {
    fake = makeFakeModules({
      refs: { migrations: { "0001_init.sql": SCHEMA("refs") } },
    });
    fake.register("isolation-allowlist.refs.ts", { default: [{ table: "refs.ghost", reason: REASON }] });
    const result = await runGlobalIsolationCheck({ adminUrl: adminUrl(), modulesDir: fake.dir, importer: fake.importer });
    expect(result.violations.map((v) => v.table)).toContain("refs.ghost");
  });

  it("une table de tenant correctement déclarée (RLS forcée) passe, y compris le test comportemental", async () => {
    fake = makeFakeModules({
      clean: {
        migrations: {
          "0001_init.sql":
            SCHEMA("clean") +
            "CREATE TABLE clean.items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES kernel.tenants(id), label text NOT NULL DEFAULT 'x');\n" +
            "SELECT kernel.enable_tenant_rls('clean.items');\n" +
            "GRANT SELECT, INSERT, UPDATE, DELETE ON clean.items TO app_user;\n",
        },
      },
    });
    const result = await assertGlobalIsolation({ adminUrl: adminUrl(), modulesDir: fake.dir, importer: fake.importer });
    expect(result.report.behavioural).toContain("clean.items");
  });
});
