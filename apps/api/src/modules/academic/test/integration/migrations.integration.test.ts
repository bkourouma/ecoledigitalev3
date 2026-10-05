import { afterAll, beforeAll, expect, it } from "vitest";
import { academicIsolationAllowlist, academicTenantTables } from "../../../isolation-allowlist.academic";
import { adminRows, createAcademicTestDb, describeIntegration, type AcademicTestDb } from "../support/db";

describeIntegration("migrations 0700-0711 (Postgres réel)", () => {
  let db: AcademicTestDb;
  beforeAll(async () => {
    db = await createAcademicTestDb();
  });
  afterAll(async () => {
    await db.drop();
  });

  it("s'appliquent de zéro et créent exactement les tables attendues, toutes sous RLS forcée", async () => {
    const tables = await adminRows<{ t: string }>(
      db,
      "SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema = 'academic' AND table_type = 'BASE TABLE' ORDER BY 1",
    );
    expect(tables.map((r) => r.t)).toEqual([...academicTenantTables, ...academicIsolationAllowlist.map((e) => e.table)].sort());
    const noRls = await adminRows(
      db,
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'academic' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)",
    );
    expect(noRls).toEqual([]);
  });
});
