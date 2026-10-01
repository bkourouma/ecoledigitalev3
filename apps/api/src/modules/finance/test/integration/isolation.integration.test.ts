import { afterAll, beforeAll, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { assertTenantIsolation, checkTenantIsolation } from "@ecoledigitale/database";
import { financeIsolationAllowlistTables, financeTenantTables } from "../../../isolation-allowlist.finance";
import { getInvoiceById, issueCreditNote } from "../../application/invoices";
import { allocatePayment, getPaymentView, getReceiptById } from "../../application/payments";
import { approveRefund, requestRefund } from "../../application/refunds";
import { getAgedBalance, getFinanceSummary, getReceivablesByGroup } from "../../application/reports";
import { listFeeCatalog } from "../../application/catalog";
import { adminOne, adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, openCashier, pay, seedCatalog, simpleInvoice, tuitionInvoice, xof } from "../support/scenario";

describeIntegration("isolation multi-tenant du schéma finance (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantA: string;
  let tenantB: string;
  let a: ReturnType<typeof ctxFor>;
  let b: ReturnType<typeof ctxFor>;
  let invoiceA: string;
  let paymentA: string;
  let receiptA: string;

  beforeAll(async () => {
    db = await createFinanceTestDb();
    world = makeWorld(db);
    tenantA = await db.createTenant("tenant-a");
    tenantB = await db.createTenant("tenant-b");
    a = ctxFor(tenantA);
    b = ctxFor(tenantB);
    // Données COMPLÈTES chez A : catalogue, facture, caisse, paiement, reçu, remboursement, avoir, webhook.
    await seedCatalog(world.deps, a);
    await seedCatalog(world.deps, b); // mêmes codes de frais chez B : autorisé (unicité par tenant)
    await openCashier(world.deps, a, 5_000, "ISO");
    const learner = learnerId();
    const inv = await tuitionInvoice(world.deps, a, learner, { groupKey: "CLASSE-A", groupLabel: "Classe A" });
    invoiceA = inv.invoice.id;
    const view = unwrap(await pay(world.deps, a, learner, 120_000, { method: "CASH", reference: undefined }));
    paymentA = view.payment.id;
    receiptA = view.receipt!.id;
    const refund = unwrap(await requestRefund(world.deps, a, { paymentId: paymentA, amount: xof(10_000), reason: "Erreur de saisie" }));
    const approver = ctxFor(tenantA);
    await openCashier(world.deps, approver, 0, "ISO2"); // le remboursement espèces sort de la caisse de l'approbateur
    unwrap(await approveRefund(world.deps, approver, { refundId: refund.id }));
    const other = await simpleInvoice(world.deps, a, learnerId(), 20_000);
    unwrap(await issueCreditNote(world.deps, a, { invoiceId: other.invoice.id, amount: xof(5_000), reason: "Remise exceptionnelle" }));
    await db.admin.query(
      "INSERT INTO finance.webhook_events (id, tenant_id, provider, event_id, payload, received_at) VALUES ($1,$2,'sandbox','evt-iso','{}'::jsonb, now())",
      [newId(), tenantA],
    );
  });
  afterAll(async () => {
    await db.drop();
  });

  it("test d'isolation générique : structure + comportement de chaque table du schéma finance", async () => {
    const report = await checkTenantIsolation({
      pool: db.appPool,
      schemas: ["finance"],
      allowlist: financeIsolationAllowlistTables,
    });
    expect(report.violations).toEqual([]);
    expect(report.staleAllowlist).toEqual([]);
    expect(report.allowlisted).toEqual([]);
    const covered = new Set([...report.behavioural, ...report.structuralOnly.map((s) => s.table)]);
    expect([...covered].sort()).toEqual([...financeTenantTables].sort());
    // La version bloquante de la CI :
    await assertTenantIsolation({ pool: db.appPool, schemas: ["finance"], allowlist: financeIsolationAllowlistTables });
  });

  it("aucune table du schéma n'échappe à la liste attendue (une table ajoutée sans RLS ferait échouer la CI)", async () => {
    const tables = await adminRows<{ t: string }>(
      db,
      "SELECT table_schema || '.' || table_name AS t FROM information_schema.tables WHERE table_schema = 'finance' AND table_type = 'BASE TABLE' ORDER BY 1",
    );
    expect(tables.map((r) => r.t)).toEqual([...financeTenantTables].sort());
    const noRls = await adminRows(db, "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'finance' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)");
    expect(noRls).toEqual([]);
  });

  it("sous le tenant B, AUCUNE ligne du tenant A n'est visible dans aucune table", async () => {
    for (const table of financeTenantTables) {
      const rows = await world.deps.db.run(b, (tx) => tx.many(`SELECT * FROM ${table} WHERE tenant_id = $1`, [tenantA]));
      expect(rows, table).toHaveLength(0);
    }
    // et A voit bien ses propres données
    const own = await world.deps.db.run(a, (tx) => tx.many("SELECT id FROM finance.invoices"));
    expect(own.length).toBeGreaterThan(0);
  });

  it("sous le tenant B, UPDATE/DELETE ne touchent aucune ligne de A", async () => {
    const upd = await world.deps.db.run(b, (tx) => tx.query("UPDATE finance.fees SET name = 'piraté' WHERE tenant_id = $1", [tenantA]));
    expect(upd.rowCount).toBe(0);
    const upd2 = await world.deps.db.run(b, (tx) => tx.query("UPDATE finance.invoices SET status = status WHERE id = $1", [invoiceA]));
    expect(upd2.rowCount).toBe(0);
    const del = await world.deps.db.run(b, (tx) => tx.query("DELETE FROM finance.installments WHERE invoice_id = $1", [invoiceA]));
    expect(del.rowCount).toBe(0);
    const { n } = await adminOne<{ n: number }>(db, "SELECT count(*)::int AS n FROM finance.fees WHERE name = 'piraté'");
    expect(n).toBe(0);
  });

  it("cas d'usage : B ne lit, n'impute, ne rembourse ni n'émet d'avoir sur les objets de A", async () => {
    const inv = await getInvoiceById(world.deps, b, invoiceA);
    expect(inv.ok).toBe(false);
    if (!inv.ok) expect(inv.error.code).toBe("finance.invoice_not_found");
    expect((await getPaymentView(world.deps, b, paymentA)).ok).toBe(false);
    expect((await getReceiptById(world.deps, b, receiptA)).ok).toBe(false);
    expect((await requestRefund(world.deps, b, { paymentId: paymentA, amount: xof(1_000), reason: "Tentative inter-tenant" })).ok).toBe(false);
    expect((await issueCreditNote(world.deps, b, { invoiceId: invoiceA, amount: xof(1_000), reason: "Tentative inter-tenant" })).ok).toBe(false);
    expect(
      (await allocatePayment(world.deps, b, { paymentId: paymentA, allocation: { mode: "AUTO" } })).ok,
    ).toBe(false);
    // les montants de A restent intacts (120 000 encaissés − 10 000 remboursés légitimement chez A)
    const after = unwrap(await getInvoiceById(world.deps, a, invoiceA));
    expect(after.invoice.paid.amount).toBe(110_000);
  });

  it("imputation manuelle vers une échéance d'un autre tenant : introuvable", async () => {
    const detail = unwrap(await getInvoiceById(world.deps, a, invoiceA));
    const learnerB = learnerId();
    await simpleInvoice(world.deps, b, learnerB, 10_000);
    const r = await pay(world.deps, b, learnerB, 5_000, {
      allocation: { mode: "MANUAL", items: [{ installmentId: detail.installments[3]!.id, amount: xof(1_000) }] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.allocation_invalid_target");
  });

  it("catalogue et rapports : chaque tenant ne voit et ne totalise que lui-même", async () => {
    const feesA = unwrap(await listFeeCatalog(world.deps, a));
    const feesB = unwrap(await listFeeCatalog(world.deps, b));
    expect(feesA).toHaveLength(3);
    expect(feesB).toHaveLength(3);
    expect(new Set([...feesA, ...feesB].map((f) => f.id)).size).toBe(6); // identifiants distincts malgré les mêmes codes

    const sumA = unwrap(await getFinanceSummary(world.deps, a, { academicYear: "2025-2026" }));
    const sumB = unwrap(await getFinanceSummary(world.deps, b, { academicYear: "2025-2026" }));
    expect(sumA.invoiceCount).toBe(2);
    expect(sumA.collected.amount).toBe(110_000); // 120 000 − 10 000 remboursés
    // B n'a que sa propre facture de 10 000 (créée plus haut) : rien de A n'est compté
    expect(sumB.invoiceCount).toBe(1);
    expect(sumB.billed.amount).toBe(10_000);
    expect(sumB.collected.amount).toBe(0);
    expect(unwrap(await getReceivablesByGroup(world.deps, b)).every((g) => g.key !== "CLASSE-A")).toBe(true);
    expect(unwrap(await getAgedBalance(world.deps, b)).total.amount).toBe(10_000);
  });

  it("sans contexte de tenant valide, aucune ligne n'est visible ni insérable", async () => {
    const client = await db.appPool.connect();
    try {
      const res = await client.query("SELECT count(*)::int AS n FROM finance.invoices");
      expect(res.rows[0].n).toBe(0); // aucun app.tenant_id posé
      await expect(
        client.query("INSERT INTO finance.fees (id, tenant_id, code, name, category) VALUES ($1,$2,'Z','z','TUITION')", [newId(), tenantA]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      client.release();
    }
  });
});
