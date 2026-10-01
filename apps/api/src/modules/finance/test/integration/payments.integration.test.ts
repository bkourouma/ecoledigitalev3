import { afterAll, beforeAll, expect, it } from "vitest";
import { newId, unwrap } from "@ecoledigitale/kernel";
import { getInvoiceById } from "../../application/invoices";
import { allocatePayment, getPaymentView, recordManualPayment } from "../../application/payments";
import { nextSequence } from "../../infrastructure/payments-repository";
import { adminOne, adminRows, createFinanceTestDb, ctxFor, describeIntegration, makeWorld, type FinanceTestDb, type TestWorld } from "../support/db";
import { learnerId, nextKey, openCashier, pay, seedCatalog, simpleInvoice, tuitionInvoice, xof } from "../support/scenario";

describeIntegration("encaissements : imputation, reçus, idempotence (Postgres réel)", () => {
  let db: FinanceTestDb;
  let world: TestWorld;
  let tenantId: string;
  let ctx: ReturnType<typeof ctxFor>;

  beforeAll(async () => {
    db = await createFinanceTestDb(24);
    world = makeWorld(db);
    tenantId = await db.createTenant();
    ctx = ctxFor(tenantId);
    await seedCatalog(world.deps, ctx);
  });
  afterAll(async () => {
    await db.drop();
  });

  it("refuse un encaissement espèces sans session de caisse ouverte", async () => {
    const r = await pay(world.deps, ctx, learnerId(), 10_000, { method: "CASH", reference: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.cash_session_required");
  });

  it("imputation automatique : plus ancienne échéance d'abord, reçu REC-aaaa-nnnnnn, événements outbox, audit", async () => {
    const cashier = ctxFor(tenantId);
    await openCashier(world.deps, cashier, 20_000, "C-IMPUT");
    const learner = learnerId();
    const invoice = await tuitionInvoice(world.deps, cashier, learner);

    const view = unwrap(await pay(world.deps, cashier, learner, 150_000, { method: "CASH", reference: undefined }));
    expect(view.replayed).toBe(false);
    expect(view.payment.status).toBe("CONFIRMED");
    expect(view.payment.cashSessionId).not.toBeNull();
    expect(view.receipt?.number).toMatch(/^REC-2025-\d{6}$/);
    expect(view.allocations.map((a) => [a.amount.amount, a.net.amount])).toEqual([
      [100_000, 100_000],
      [50_000, 50_000],
    ]);
    expect(view.unallocated.amount).toBe(0);

    const after = unwrap(await getInvoiceById(world.deps, cashier, invoice.invoice.id));
    expect(after.invoice.status).toBe("PARTIALLY_PAID");
    expect(after.invoice.paid.amount).toBe(150_000);
    expect(after.balance.amount).toBe(350_000);
    expect(after.installments.map((i) => i.paid.amount)).toEqual([100_000, 50_000, 0, 0]);

    // Instantané du reçu
    const snap = view.receipt!.snapshot;
    expect(snap.allocations.map((a) => [a.label, a.amount])).toEqual([["Inscription", 100_000], ["1re tranche", 50_000]]);
    expect(snap.balanceAfter?.amount).toBe(350_000);

    const events = await adminRows<{ type: string }>(db, "SELECT type FROM kernel.domain_events WHERE aggregate_id = $1 OR payload->>'paymentId' = $1", [view.payment.id]);
    expect(events.map((e) => e.type).sort()).toEqual(
      ["finance.payment.allocated", "finance.payment.completed", "finance.receipt.issued"].sort(),
    );
    expect(world.audit.actions()).toContain("finance.payment.completed");
  });

  it("idempotence : même clé, même demande ⇒ même paiement et même reçu, rien d'écrit ; autre demande ⇒ conflit", async () => {
    const learner = learnerId();
    await simpleInvoice(world.deps, ctx, learner, 100_000);
    const key = nextKey("idem");
    const first = unwrap(await pay(world.deps, ctx, learner, 40_000, { idempotencyKey: key }));
    const again = unwrap(await pay(world.deps, ctx, learner, 40_000, { idempotencyKey: key }));
    expect(again.replayed).toBe(true);
    expect(again.payment.id).toBe(first.payment.id);
    expect(again.receipt?.id).toBe(first.receipt?.id);

    const { n } = await adminOne<{ n: number }>(db, "SELECT count(*)::int AS n FROM finance.payments WHERE idempotency_key = $1", [key]);
    expect(n).toBe(1);
    const { allocs } = await adminOne<{ allocs: number }>(db, "SELECT count(*)::int AS allocs FROM finance.payment_allocations WHERE payment_id = $1", [first.payment.id]);
    expect(allocs).toBe(1);

    const conflict = await pay(world.deps, ctx, learner, 41_000, { idempotencyKey: key });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe("finance.idempotency_key_reused");
  });

  it("un paiement supérieur au dû solde la facture et garde le surplus non imputé, imputable plus tard", async () => {
    const learner = learnerId();
    const inv = await simpleInvoice(world.deps, ctx, learner, 100_000);
    const view = unwrap(await pay(world.deps, ctx, learner, 130_000));
    expect(view.unallocated.amount).toBe(30_000);
    expect(unwrap(await getInvoiceById(world.deps, ctx, inv.invoice.id)).invoice.status).toBe("PAID");

    const second = await simpleInvoice(world.deps, ctx, learner, 50_000, "2026-02-01");
    const allocated = unwrap(await allocatePayment(world.deps, ctx, { paymentId: view.payment.id, allocation: { mode: "AUTO" } }));
    expect(allocated.unallocated.amount).toBe(0);
    expect(allocated.payment.allocated.amount).toBe(130_000);
    const after = unwrap(await getInvoiceById(world.deps, ctx, second.invoice.id));
    expect(after.invoice.paid.amount).toBe(30_000);
    expect(after.invoice.status).toBe("PARTIALLY_PAID");
  });

  it("imputation manuelle : échéance désignée, dépassements refusés", async () => {
    const learner = learnerId();
    const inv = await tuitionInvoice(world.deps, ctx, learner);
    const last = inv.installments[3]!; // 100 000, échéance 15/03/2026
    const ok1 = unwrap(
      await pay(world.deps, ctx, learner, 100_000, {
        allocation: { mode: "MANUAL", items: [{ installmentId: last.id, amount: xof(60_000), lineId: inv.lines[0]!.id }] },
      }),
    );
    expect(ok1.allocations).toHaveLength(1);
    expect(ok1.allocations[0]!.lineId).toBe(inv.lines[0]!.id);
    expect(ok1.unallocated.amount).toBe(40_000);

    const tooMuch = await pay(world.deps, ctx, learner, 100_000, {
      allocation: { mode: "MANUAL", items: [{ installmentId: last.id, amount: xof(60_000) }] },
    });
    expect(tooMuch.ok).toBe(false);
    if (!tooMuch.ok) expect(tooMuch.error.code).toBe("finance.allocation_exceeds_remaining");

    const beyondPayment = await pay(world.deps, ctx, learner, 10_000, {
      allocation: { mode: "MANUAL", items: [{ installmentId: inv.installments[0]!.id, amount: xof(10_001) }] },
    });
    expect(beyondPayment.ok).toBe(false);
    if (!beyondPayment.ok) expect(beyondPayment.error.code).toBe("finance.allocation_exceeds_payment");

    const foreign = await pay(world.deps, ctx, learnerId(), 10_000, {
      allocation: { mode: "MANUAL", items: [{ installmentId: inv.installments[0]!.id, amount: xof(10_000) }] },
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe("finance.allocation_invalid_target");
  });

  it("la somme fléchée sur une ligne ne dépasse pas son total", async () => {
    const learner = learnerId();
    const inv = await tuitionInvoice(world.deps, ctx, learner);
    const line = inv.lines[0]!.id;
    unwrap(
      await pay(world.deps, ctx, learner, 450_000, {
        allocation: {
          mode: "MANUAL",
          items: [
            { installmentId: inv.installments[0]!.id, amount: xof(100_000), lineId: line },
            { installmentId: inv.installments[1]!.id, amount: xof(150_000), lineId: line },
            { installmentId: inv.installments[2]!.id, amount: xof(150_000), lineId: line },
          ],
        },
      }),
    );
    const over = await pay(world.deps, ctx, learner, 200_000, {
      allocation: { mode: "MANUAL", items: [{ installmentId: inv.installments[3]!.id, amount: xof(100_000), lineId: line }, { installmentId: inv.installments[3]!.id, amount: xof(1), lineId: line }] },
    });
    expect(over.ok).toBe(false);
  });

  it("chèque et virement exigent une référence ; un mode inconnu ou en ligne est refusé", async () => {
    const learner = learnerId();
    expect((await pay(world.deps, ctx, learner, 1_000, { method: "CHEQUE", reference: undefined })).ok).toBe(false);
    expect((await pay(world.deps, ctx, learner, 1_000, { method: "CHEQUE", reference: "CHQ-0042" })).ok).toBe(true);
    expect((await pay(world.deps, ctx, learner, 1_000, { method: "ONLINE" })).ok).toBe(false);
    expect((await pay(world.deps, ctx, learner, 0)).ok).toBe(false);
  });

  it("paiement d'un financeur : n'impute que les factures du même financeur", async () => {
    const learner = learnerId();
    const familyInvoice = await simpleInvoice(world.deps, ctx, learner, 50_000);
    const view = unwrap(await pay(world.deps, ctx, learner, 50_000, { payerKind: "FUNDER", payerRef: "scholarship-xyz" }));
    expect(view.allocations).toHaveLength(0);
    expect(view.unallocated.amount).toBe(50_000);
    const after = unwrap(await getInvoiceById(world.deps, ctx, familyInvoice.invoice.id));
    expect(after.invoice.paid.amount).toBe(0);
    const noRef = await pay(world.deps, ctx, learner, 1_000, { payerKind: "FUNDER" });
    expect(noRef.ok).toBe(false);
  });

  it("50 paiements concurrents : reçus numérotés sans trou ni doublon", async () => {
    const tenant = await db.createTenant();
    const c = ctxFor(tenant);
    await seedCatalog(world.deps, c);
    const learners = Array.from({ length: 50 }, () => learnerId());
    for (const l of learners) await simpleInvoice(world.deps, c, l, 100_000);

    const results = await Promise.all(learners.map((l) => pay(world.deps, c, l, 25_000)));
    for (const r of results) expect(r.ok).toBe(true);

    const rows = await adminRows<{ number: string; seq: string }>(
      db,
      "SELECT number, number_seq::text AS seq FROM finance.receipts WHERE tenant_id = $1 ORDER BY number_seq",
      [tenant],
    );
    expect(rows).toHaveLength(50);
    expect(rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(rows.map((r) => r.number)).size).toBe(50);
    expect(rows[0]!.number).toBe("REC-2025-000001");
    expect(rows[49]!.number).toBe("REC-2025-000050");
    // et les 50 factures sont numérotées FAC-2025-000001..000050
    const inv = await adminRows<{ n: string }>(db, "SELECT number_seq::text AS n FROM finance.invoices WHERE tenant_id = $1 ORDER BY number_seq", [tenant]);
    expect(inv.map((r) => Number(r.n))).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("rejeux concurrents avec la même clé : un seul paiement, un seul reçu", async () => {
    const learner = learnerId();
    await simpleInvoice(world.deps, ctx, learner, 100_000);
    const key = nextKey("race");
    const results = await Promise.all(Array.from({ length: 12 }, () => pay(world.deps, ctx, learner, 10_000, { idempotencyKey: key })));
    for (const r of results) expect(r.ok).toBe(true);
    const views = results.map((r) => unwrap(r));
    expect(new Set(views.map((v) => v.payment.id)).size).toBe(1);
    expect(views.filter((v) => !v.replayed)).toHaveLength(1);
    const { n } = await adminOne<{ n: number }>(db, "SELECT count(*)::int AS n FROM finance.receipts WHERE payment_id = $1", [views[0]!.payment.id]);
    expect(n).toBe(1);
  });

  it("paiements concurrents sur la même facture : jamais plus que le dû imputé, surplus non imputé", async () => {
    const learner = learnerId();
    const inv = await simpleInvoice(world.deps, ctx, learner, 100_000);
    const results = await Promise.all(Array.from({ length: 20 }, () => pay(world.deps, ctx, learner, 10_000)));
    for (const r of results) expect(r.ok).toBe(true);
    const after = unwrap(await getInvoiceById(world.deps, ctx, inv.invoice.id));
    expect(after.invoice.status).toBe("PAID");
    expect(after.invoice.paid.amount).toBe(100_000);
    const [row] = await adminRows<{ allocated: string; payments: string; unallocated: string }>(
      db,
      `SELECT COALESCE(sum(allocated_amount),0)::text AS allocated, count(*)::text AS payments,
              COALESCE(sum(amount - allocated_amount - refunded_amount),0)::text AS unallocated
         FROM finance.payments WHERE learner_id = $1`,
      [learner],
    );
    expect(row!.payments).toBe("20");
    expect(row!.allocated).toBe("100000");
    expect(row!.unallocated).toBe("100000");
  });

  it("un échec de cas d'usage n'écrit rien (ni paiement, ni événement) et ne consomme aucun numéro", async () => {
    const tenant = await db.createTenant();
    const c = ctxFor(tenant);
    await seedCatalog(world.deps, c);
    const before = await adminRows<{ n: number }>(db, "SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1", [tenant]);

    const learner = learnerId();
    const inv = await tuitionInvoice(world.deps, c, learner);
    const bad = await pay(world.deps, c, learner, 10_000, {
      allocation: { mode: "MANUAL", items: [{ installmentId: inv.installments[0]!.id, amount: xof(20_000) }] },
    });
    expect(bad.ok).toBe(false);
    const { n } = await adminOne<{ n: number }>(db, "SELECT count(*)::int AS n FROM finance.payments WHERE tenant_id = $1", [tenant]);
    expect(n).toBe(0);
    const { r } = await adminOne<{ r: number }>(db, "SELECT count(*)::int AS r FROM finance.number_sequences WHERE tenant_id = $1 AND kind = 'RECEIPT'", [tenant]);
    expect(r).toBe(0);
    const after = await adminRows<{ n: number }>(db, "SELECT count(*)::int AS n FROM kernel.domain_events WHERE tenant_id = $1", [tenant]);
    // seule la facturation (invoice.issued) a publié
    expect(after[0]!.n - before[0]!.n).toBe(1);

    // le premier reçu valide porte bien le numéro 1
    const ok1 = unwrap(await pay(world.deps, c, learner, 10_000));
    expect(ok1.receipt!.number).toBe("REC-2025-000001");
  });

  it("numérotation : une transaction annulée rend son numéro (pas de trou)", async () => {
    const tenant = await db.createTenant();
    const c = ctxFor(tenant);
    await expect(
      world.deps.db.run(c, async (tx) => {
        expect(await nextSequence(tx, "RECEIPT", 2025)).toBe(1);
        throw new Error("annulation volontaire");
      }),
    ).rejects.toThrow("annulation volontaire");
    const seq = await world.deps.db.run(c, (tx) => nextSequence(tx, "RECEIPT", 2025));
    expect(seq).toBe(1);
    expect(await world.deps.db.run(c, (tx) => nextSequence(tx, "RECEIPT", 2025))).toBe(2);
    expect(await world.deps.db.run(c, (tx) => nextSequence(tx, "RECEIPT", 2026))).toBe(1); // par année
    expect(await world.deps.db.run(c, (tx) => nextSequence(tx, "INVOICE", 2025))).toBe(1); // par type
  });

  it("la numérotation repart à 1 chaque année", async () => {
    const tenant = await db.createTenant();
    const c = ctxFor(tenant);
    const w = makeWorld(db);
    await seedCatalog(w.deps, c);
    const l = learnerId();
    await simpleInvoice(w.deps, c, l, 100_000);
    const v1 = unwrap(await pay(w.deps, c, l, 1_000));
    expect(v1.receipt!.number).toBe("REC-2025-000001");
    w.clock.set("2026-01-02T10:00:00.000Z");
    const v2 = unwrap(await pay(w.deps, c, l, 1_000));
    expect(v2.receipt!.number).toBe("REC-2026-000001");
    const v3 = unwrap(await pay(w.deps, c, l, 1_000));
    expect(v3.receipt!.number).toBe("REC-2026-000002");
  });

  it("lecture d'un paiement inconnu : introuvable", async () => {
    const r = await getPaymentView(world.deps, ctx, newId());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("finance.payment_not_found");
    const rec = await recordManualPayment(world.deps, ctx, { idempotencyKey: "short", learnerId: learnerId(), amount: xof(1), method: "TRANSFER", reference: "x" });
    expect(rec.ok).toBe(false);
  });
});
