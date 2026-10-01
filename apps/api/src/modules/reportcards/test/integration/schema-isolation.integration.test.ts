import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTenantIsolation, checkTenantIsolation } from "@ecoledigitale/database";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { createBatch } from "../../application/issue";
import { getDownloadUrl, getReportCard, listReportCards } from "../../application/queries";
import { getBranding, listSignatories, previewTemplate, putBranding } from "../../application/reference";
import { publishReportCard } from "../../application/lifecycle";
import { renderReportCard } from "../../application/render";
import { verifyByCode } from "../../application/verify";
import { fixtures, reportcardsIsolationAllowlistTables, reportcardsTenantTables } from "../../../isolation-allowlist.reportcards";
import { adminOne, adminRows, createReportcardsTestDb, ctxFor, describeIntegration, type ReportcardsTestDb } from "../support/db";
import { makeWorld, seedSchool, type School, type TestWorld } from "../support/world";

describeIntegration("isolation multi-tenant et invariants de la base (Postgres réel)", () => {
  let db: ReportcardsTestDb;
  let world: TestWorld;
  let a: School;
  let b: School;
  let cardA: { id: string; code: string };

  beforeAll(async () => {
    db = await createReportcardsTestDb();
    world = makeWorld(db);
    a = await seedSchool(world, await db.createTenant(), { students: 2 });
    b = await seedSchool(world, await db.createTenant(), { students: 2 });
    for (const s of [a, b]) {
      unwrap(await createBatch(world.deps, s.admin.ctx, { classroomId: s.classroomId, academicPeriodId: s.periodId }));
    }
    const row = (await adminRows<any>(db, "SELECT id, verification_code FROM reportcards.report_cards WHERE tenant_id = $1 LIMIT 1", [a.tenantId]))[0];
    cardA = { id: row.id, code: row.verification_code };
    unwrap(await renderReportCard(world.deps, a.admin.ctx, { reportCardId: cardA.id }));
    unwrap(await publishReportCard(world.deps, a.admin.ctx, { reportCardId: cardA.id }));
  });
  afterAll(async () => {
    await db.drop();
  });

  it("test d'isolation générique : structure + comportement de chaque table du schéma reportcards, 4 tables globales justifiées", async () => {
    const options = { pool: db.appPool, schemas: ["reportcards"], allowlist: reportcardsIsolationAllowlistTables as string[], fixtures: fixtures as never };
    const report = await checkTenantIsolation(options);
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    expect([...report.allowlisted].sort()).toEqual([...reportcardsIsolationAllowlistTables].sort());
    const covered = new Set([...report.behavioural, ...report.structuralOnly.map((s) => s.table)]);
    expect([...covered].sort()).toEqual([...reportcardsTenantTables].sort());
    console.info(`[reportcards] isolation : ${report.behavioural.length} tables testées en comportement, ${report.structuralOnly.length} en structure (FK composites)`);
    await assertTenantIsolation(options);
  });

  it("aucune table du schéma n'échappe aux listes attendues ; RLS activée ET forcée partout, y compris les tables globales", async () => {
    const tables = await adminRows<{ t: string }>(db, "SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema = 'reportcards' AND table_type = 'BASE TABLE' ORDER BY 1");
    expect(tables.map((r) => r.t)).toEqual([...reportcardsTenantTables, ...reportcardsIsolationAllowlistTables].sort());
    const noRls = await adminRows(db, "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'reportcards' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)");
    expect(noRls).toEqual([]);
    // Aucune clé étrangère vers un autre schéma que kernel.tenants (conventions n°1).
    const fks = await adminRows<{ target: string }>(db, `SELECT confrelid::regclass::text AS target FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE c.contype = 'f' AND n.nspname = 'reportcards'`);
    for (const fk of fks) expect(fk.target).toMatch(/^(kernel\.tenants|tenants|reportcards\.[a-z_]+|[a-z_]+)$/);
    expect(fks.filter((f) => f.target.includes(".") && !f.target.startsWith("reportcards.") && f.target !== "kernel.tenants")).toEqual([]);
  });

  it("sous le tenant B, AUCUNE ligne du tenant A n'est visible ni modifiable dans aucune table de tenant", async () => {
    const ctxB = ctxFor(b.tenantId);
    for (const table of reportcardsTenantTables) {
      expect(await db.tenantDb.run(ctxB, (tx) => tx.many(`SELECT * FROM ${table} WHERE tenant_id = $1`, [a.tenantId])), table).toHaveLength(0);
    }
    const upd = await db.tenantDb.run(ctxB, (tx) => tx.query("UPDATE reportcards.report_cards SET render_status = 'FAILED' WHERE tenant_id = $1", [a.tenantId]));
    expect(upd.rowCount).toBe(0);
    expect(Number((await adminOne<any>(db, "SELECT count(*) AS n FROM reportcards.report_cards WHERE tenant_id = $1 AND render_status = 'FAILED'", [a.tenantId])).n)).toBe(0);
    // Sans contexte de tenant : rien n'est visible ni insérable (échec fermé).
    const client = await db.appPool.connect();
    try {
      expect((await client.query("SELECT count(*)::int AS n FROM reportcards.report_cards")).rows[0].n).toBe(0);
      expect((await client.query("SELECT count(*)::int AS n FROM reportcards.verification_index")).rows[0].n).toBe(0);
      await expect(client.query("INSERT INTO reportcards.settings (tenant_id) VALUES ($1)", [a.tenantId])).rejects.toMatchObject({ code: "42501" });
    } finally {
      client.release();
    }
  });

  it("cas d'usage : le tenant B ne lit, ne télécharge, ne publie ni ne prévisualise rien du tenant A", async () => {
    expect((await getReportCard(world.deps, b.admin.ctx, cardA.id)).ok).toBe(false);
    const list = unwrap(await listReportCards(world.deps, b.admin.ctx, { limit: 100 }));
    expect(list.items.every((v) => v.card.id !== cardA.id)).toBe(true);
    expect(list.items).toHaveLength(2);
    const dl = await getDownloadUrl(world.deps, b.admin.ctx, { reportCardId: cardA.id, manage: true });
    expect(dl.ok).toBe(false);
    if (!dl.ok) expect(dl.error.code).toBe("reportcards.not_found");
    expect((await publishReportCard(world.deps, b.admin.ctx, { reportCardId: cardA.id })).ok).toBe(false);
    // Identité et signataires : chaque tenant ne voit que les siens.
    unwrap(await putBranding(world.deps, b.admin.ctx, { legalName: "Établissement B" }));
    expect(unwrap(await getBranding(world.deps, a.admin.ctx, {}))[0]!.legalName).toBe("Établissement de Démonstration");
    expect(unwrap(await getBranding(world.deps, b.admin.ctx, {}))[0]!.legalName).toBe("Établissement B");
    expect(unwrap(await listSignatories(world.deps, b.admin.ctx)).every((s) => s.id !== a.signatoryId)).toBe(true);
    const preview = unwrap(await previewTemplate(world.deps, b.admin.ctx, { documentKind: "REPORT_CARD", pack: "SECONDARY" }));
    expect(preview.html).not.toContain("ELEVE");
  });

  it("la vérification publique (SystemDb) retrouve le bon tenant par le code ; un tenant ne peut pas lister l'index des autres", async () => {
    const v = unwrap(await verifyByCode(world.deps, { code: cardA.code }));
    expect(v).toMatchObject({ status: "AUTHENTIC", institutionName: "Établissement de Démonstration" });
    const ctxB = ctxFor(b.tenantId);
    expect(await db.tenantDb.run(ctxB, (tx) => tx.many("SELECT code FROM reportcards.verification_index"))).toHaveLength(2);
    expect(await db.tenantDb.run(ctxB, (tx) => tx.many("SELECT code FROM reportcards.verification_index WHERE code = $1", [cardA.code]))).toHaveLength(0);
    expect(await db.tenantDb.run(ctxB, (tx) => tx.many("SELECT pdf_hash FROM reportcards.file_hash_index"))).toHaveLength(0); // les empreintes de A sont invisibles de B
    expect(newId()).toBeTruthy();
  });
});
