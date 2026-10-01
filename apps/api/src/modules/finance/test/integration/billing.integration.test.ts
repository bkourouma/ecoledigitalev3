import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { unwrap } from "@ecoledigitale/kernel";
import { issueInvoiceFromSchedule } from "../../application/invoices";
import { adminRows, ctxFor, createFinanceTestDb, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, seedCatalog, xof, YEAR, type Catalog } from "../support/scenario";

describeIntegration("facturation depuis les barèmes (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantId: string;
  let catalog: Catalog;

  beforeAll(async () => {
    db = await createFinanceTestDb();
    world = makeWorld(db);
    tenantId = await db.createTenant();
    catalog = await seedCatalog(world.deps, ctxFor(tenantId));
  });
  afterAll(async () => {
    await db.drop();
  });

  it("émet une facture numérotée avec l'échéancier du PRD (500 000 = 100 000 + 150 000 + 150 000 + 100 000)", async () => {
    const ctx = ctxFor(tenantId);
    const learner = learnerId();
    const result = unwrap(
      await issueInvoiceFromSchedule(world.deps, ctx, {
        learnerId: learner,
        academicYear: YEAR,
        items: [{ feeCode: "SCOL" }],
        idempotencyKey: "inv-smoke-0001",
      }),
    );
    expect(result.invoices).toHaveLength(1);
    const { invoice, installments, lines } = result.invoices[0]!;
    expect(invoice.number).toBe("FAC-2025-000001");
    expect(invoice.status).toBe("ISSUED");
    expect(invoice.total.amount).toBe(500_000);
    expect(lines.map((l) => l.total.amount)).toEqual([500_000]);
    expect(installments.map((i) => [i.dueDate, i.amount.amount])).toEqual([
      ["2025-09-01", 100_000],
      ["2025-10-15", 150_000],
      ["2026-01-15", 150_000],
      ["2026-03-15", 100_000],
    ]);
    const rows = await adminRows(db, "SELECT count(*)::int AS n FROM kernel.domain_events WHERE type = 'finance.invoice.issued'");
    expect(rows[0]!.n).toBe(1);
    void catalog;
    void xof;
  });
});
