import { afterEach, describe, expect, it } from "vitest";
import { loadMigrations } from "@ecoledigitale/database";
import { discoverModules } from "../src/modules/registry-discovery";
import { BASELINE_MIGRATIONS_DIR, planMigrationSteps, redactUrl, trackingTableFor } from "../src/platform/v2-migrations";
import { makeFakeModules, type FakeModules } from "./helpers/fixtures";

let fake: FakeModules | undefined;
afterEach(() => {
  fake?.cleanup();
  fake = undefined;
});

const sql = (name: string) => ({ [name]: "SELECT 1;" });

describe("plan de migration v2", () => {
  it("applique la baseline d'abord, puis les modules dans l'ordre topologique des manifestes", async () => {
    fake = makeFakeModules({
      // ordre alphabétique : academic, finance, iam, tenancy ; ordre topologique imposé par dependsOn
      academic: { manifest: { dependsOn: ["tenancy"] }, migrations: sql("0001_init.sql") },
      finance: { manifest: { dependsOn: ["academic", "iam"] }, migrations: sql("0001_init.sql") },
      iam: { manifest: { dependsOn: ["tenancy"] }, migrations: sql("0001_init.sql") },
      tenancy: { migrations: sql("0001_init.sql") },
    });
    const modules = await discoverModules({ modulesDir: fake.dir, importer: fake.importer });
    const steps = planMigrationSteps(modules);

    // tenancy avant ses dépendants ; finance après academic ET iam
    const order = steps.map((s) => s.id);
    expect(order[0]).toBe("baseline");
    expect(order.indexOf("tenancy")).toBeLessThan(order.indexOf("academic"));
    expect(order.indexOf("tenancy")).toBeLessThan(order.indexOf("iam"));
    expect(order.indexOf("academic")).toBeLessThan(order.indexOf("finance"));
    expect(order.indexOf("iam")).toBeLessThan(order.indexOf("finance"));
  });

  it("utilise une table de suivi distincte par dossier (les versions 0001 de deux modules ne collisionnent pas)", async () => {
    fake = makeFakeModules({ a: { migrations: sql("0001_init.sql") }, b: { migrations: sql("0001_init.sql") } });
    const steps = planMigrationSteps(await discoverModules({ modulesDir: fake.dir, importer: fake.importer }));
    expect(steps.map((s) => s.table)).toEqual(["schema_migrations", "schema_migrations_a", "schema_migrations_b"]);
    expect(trackingTableFor("finance")).toBe("schema_migrations_finance");
    expect(new Set(steps.map((s) => s.table)).size).toBe(steps.length);
    // Le runner charge chaque dossier séparément sans conflit de numéro.
    for (const step of steps.filter((s) => s.kind === "module")) expect(() => loadMigrations([step.dir])).not.toThrow();
  });

  it("omet les modules sans fichier .sql, et sans module le plan se réduit à la baseline", async () => {
    fake = makeFakeModules({
      no_migrations: {},
      empty_dir: { migrations: { "README.md": "rien" } },
      real: { migrations: sql("0001_init.sql") },
    });
    const steps = planMigrationSteps(await discoverModules({ modulesDir: fake.dir, importer: fake.importer }));
    expect(steps.map((s) => s.id)).toEqual(["baseline", "real"]);

    expect(planMigrationSteps([]).map((s) => s.id)).toEqual(["baseline"]);
  });

  it("la baseline pointe sur packages/database/migrations (0001_roles, 0002_kernel, 0003_outbox)", () => {
    const files = loadMigrations([BASELINE_MIGRATIONS_DIR]).map((f) => f.filename);
    expect(files.slice(0, 3)).toEqual(["0001_roles.sql", "0002_kernel.sql", "0003_outbox.sql"]);
  });
});

describe("redactUrl", () => {
  it("masque le mot de passe", () => {
    const secret = ["s3", "cr3t"].join("");
    const url = redactUrl(`postgres://u:${secret}@localhost:5432/db_dev`);
    expect(url).not.toContain(secret);
    expect(url).toContain("***");
    expect(redactUrl("pas une url")).toBe("<url illisible>");
  });
});
